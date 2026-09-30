import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
  Notification,
} from "electron";
import { TaskManager } from "./tasks";
import { openTaskTerminal } from "./task-terminal";
import {
  defaultAgents,
  validateAgents,
  validatePalette,
} from "../shared/preferences";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type * as pty from "node-pty";
import chokidar, { type FSWatcher } from "chokidar";
import * as service from "./services";
import {
  RemoteClient,
  sshArgs,
  remoteTerminalCommand,
  validateRemote,
  kerberosStatus,
} from "./remote";
import {
  normalizeTerminalShortcut,
  shortcutFromKey,
} from "../shared/shortcuts";
import type {
  GitStatus,
  Settings,
  TerminalSession,
  RemoteConnection,
} from "../shared/types";

if (process.env.GROVE_USER_DATA)
  app.setPath("userData", process.env.GROVE_USER_DATA);
let win: BrowserWindow;
const pendingOpenFiles: string[] = [];
app.on("open-file", (event, file) => {
  event.preventDefault();
  pendingOpenFiles.push(file);
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    send("openFiles", null);
  }
});
let settings: Settings = service.defaults();
let tasks: TaskManager;
let taskLoadError: unknown;
let dirty = false;
let quitting = false;
let shellEnvironment: Promise<void> = Promise.resolve();
let pendingQuit:
  { id: string; timer: ReturnType<typeof setTimeout> } | undefined;
const watchers = new Map<string, FSWatcher>();
const remoteClients = new Map<string, RemoteClient>();
function remoteConnection(id: string) {
  const connection = settings.remotes?.find((item) => item.id === id);
  if (!connection) throw new Error("远端连接配置不存在");
  return connection;
}
function remoteClient(id: string) {
  let client = remoteClients.get(id);
  if (!client) {
    client = new RemoteClient(remoteConnection(id), undefined, (event) => {
      for (const p of settings.projects.filter(
        (p) => p.remoteId === id && p.path === event.root,
      )) {
        gitSnapshots.delete(p.id);
        send("fileChange", {
          projectId: p.id,
          path: event.path,
          type: event.type,
        });
      }
    });
    remoteClients.set(id, client);
  }
  return client;
}
function projectCall<T = any>(
  id: string,
  method: string,
  ...args: unknown[]
): Promise<T> {
  const p = project(id);
  if (p.remoteId)
    return remoteClient(p.remoteId).call<T>(method, p.path, ...args);
  return (service as any)[method](p.path, ...args);
}
const terminals = new Map<
  string,
  {
    info: TerminalSession;
    process: pty.IPty;
    buffer: string;
    input?: () => void;
  }
>();
const locks = new Map<string, Promise<unknown>>();
const settingsFile = () => path.join(app.getPath("userData"), "workspace.json");
const send = (channel: string, payload: unknown) => {
  if (win && !win.isDestroyed())
    win.webContents.send(`grove:${channel}`, payload);
};
const project = (id: string) => {
  const item = settings.projects.find((p) => p.id === id);
  if (!item) throw new Error("项目不存在");
  return item;
};
async function persist() {
  // Serialize snapshots so rapid UI updates cannot reorder writes.
  const snapshot = JSON.stringify(settings, null, 2);
  return locked("settings", async () => {
    await fs.mkdir(app.getPath("userData"), { recursive: true });
    const temp = settingsFile() + ".tmp";
    await fs.writeFile(temp, snapshot);
    await fs.rename(temp, settingsFile());
  });
}
async function locked<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(fn);
  locks.set(key, next);
  try {
    return await next;
  } finally {
    if (locks.get(key) === next) locks.delete(key);
  }
}
const gitSnapshots = new Map<
  string,
  { pending: boolean; time: number; value: Promise<GitStatus> }
>();
const gitStatusRequests = new Map<string, Promise<GitStatus>>();
function readGitStatus(id: string, refresh = false): Promise<GitStatus> {
  const root = project(id).path;
  const requestKey = `${id}:${root}`;
  const pending = gitStatusRequests.get(requestKey);
  if (pending)
    return pending.then((status) =>
      gitSnapshots.get(id)?.value === pending
        ? status
        : readGitStatus(id, refresh),
    );
  const cached = gitSnapshots.get(id);
  if (
    cached &&
    (cached.pending || (!refresh && Date.now() - cached.time < 30000))
  )
    return cached.value;
  const entry = {
    pending: true,
    time: Date.now(),
    value: projectCall<GitStatus>(id, "gitStatus"),
  };
  gitStatusRequests.set(requestKey, entry.value);
  gitSnapshots.set(id, entry);
  void entry.value.then(
    () => {
      gitStatusRequests.delete(requestKey);
      entry.pending = false;
      entry.time = Date.now();
    },
    () => {
      gitStatusRequests.delete(requestKey);
      if (gitSnapshots.get(id) === entry) gitSnapshots.delete(id);
    },
  );
  return entry.value;
}
function watch(id: string) {
  if (project(id).remoteId) return;
  if (watchers.has(id)) return;
  const root = project(id).path;
  const watcher = chokidar.watch(root, {
    ignoreInitial: true,
    ignored: (file) =>
      /(^|[/\\])(node_modules|dist|build|vendor|\.grove-save-[^/]+)([/\\]|$)/.test(
        file,
      ) || /[/\\]\.git[/\\](objects|logs)([/\\]|$)/.test(file),
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
  });
  watcher.on("all", (type, file) => {
    if (/[\\/]\.git[\\/].*\.lock$/.test(file)) return;
    gitSnapshots.delete(id);
    send("fileChange", {
      projectId: id,
      path: path.relative(root, file),
      type,
    });
  });
  watcher.on("error", (error) => console.error("Watcher:", error));
  watchers.set(id, watcher);
}
async function chooseDirectory() {
  const result = await dialog.showOpenDialog(win, {
    title: "添加本地项目",
    properties: ["openDirectory"],
  });
  return result.canceled ? null : fs.realpath(result.filePaths[0]);
}
function terminal(id: string) {
  const t = terminals.get(id);
  if (!t) throw new Error("终端已关闭");
  return t;
}
function setupIPC() {
  const handlers: Record<string, (...args: any[]) => any> = {
    settings: () => settings,
    tasks: () => {
      if (taskLoadError) throw taskLoadError;
      return tasks.list();
    },
    continueTask: (id, prompt) =>
      locked("create-task", () => tasks.continue(id, prompt)),
    createTask: (input) =>
      locked("create-task", async () => {
        if (taskLoadError) throw taskLoadError;
        await shellEnvironment;
        const target = project(input.projectId);
        const agent = (settings.agents || defaultAgents).find(
          (item) => item.id === input.agentId,
        );
        if (!agent) throw new Error("请选择有效的 Agent");
        return tasks.create(
          input,
          target,
          agent,
          target.remoteId ? remoteConnection(target.remoteId) : undefined,
        );
      }),
    takeOpenFiles: () =>
      locked("open-files", async () => {
        const requests = pendingOpenFiles.splice(0);
        const results = [];
        for (const file of requests) {
          try {
            const target = await fs.realpath(file);
            const stat = await fs.stat(target);
            const root = stat.isDirectory() ? target : path.dirname(target);
            let item = settings.projects
              .filter(
                (p) =>
                  !p.remoteId &&
                  (target === p.path || target.startsWith(p.path + path.sep)),
              )
              .sort((a, b) => b.path.length - a.path.length)[0];
            if (!item) {
              item = {
                id: randomUUID(),
                name: path.basename(root),
                path: root,
              };
              settings.projects.push(item);
            }
            results.push({
              project: item,
              path: stat.isDirectory()
                ? undefined
                : path.relative(item.path, target),
            });
          } catch (error) {
            results.push({ error: `无法打开 ${file}: ${String(error)}` });
          }
        }
        if (requests.length) await persist();
        return results;
      }),
    saveSettings: async (value: Partial<Settings>) => {
      const palette =
        value.palette === undefined
          ? undefined
          : validatePalette(value.palette);
      const agents =
        value.agents === undefined ? undefined : validateAgents(value.agents);
      const shortcut =
        value.terminalShortcut === undefined
          ? settings.terminalShortcut
          : normalizeTerminalShortcut(value.terminalShortcut);
      const shortcutChanged = shortcut !== settings.terminalShortcut;
      settings.terminalShortcut = shortcut;
      if (value.terminalDock === "bottom" || value.terminalDock === "right")
        settings.terminalDock = value.terminalDock;
      if (
        typeof value.terminalWidth === "number" &&
        Number.isFinite(value.terminalWidth)
      )
        settings.terminalWidth = Math.max(
          240,
          Math.min(1600, value.terminalWidth),
        );
      if (
        value.theme &&
        ["dark", "light", "nord", "catppuccin"].includes(value.theme)
      )
        settings.theme = value.theme;
      if (
        "activeProject" in value &&
        (value.activeProject === undefined ||
          settings.projects.some((p) => p.id === value.activeProject))
      )
        settings.activeProject = value.activeProject;
      if (Array.isArray(value.widths) && value.widths.length === 3)
        settings.widths = value.widths.map((v, i) =>
          Math.max(i === 0 ? 140 : 180, Math.min(700, Number(v) || 240)),
        );
      if (Array.isArray(value.collapsed) && value.collapsed.length === 3)
        settings.collapsed = value.collapsed.map(Boolean);
      if (
        typeof value.terminalHeight === "number" &&
        Number.isFinite(value.terminalHeight)
      )
        settings.terminalHeight = Math.max(
          140,
          Math.min(1600, value.terminalHeight),
        );
      if (typeof value.terminalMaximized === "boolean")
        settings.terminalMaximized = value.terminalMaximized;
      if (
        typeof value.terminalFontSize === "number" &&
        Number.isFinite(value.terminalFontSize)
      )
        settings.terminalFontSize = Math.max(
          9,
          Math.min(24, Math.round(value.terminalFontSize)),
        );
      if (value.workspaces && typeof value.workspaces === "object")
        settings.workspaces = value.workspaces;
      if (palette) settings.palette = palette;
      if (agents) settings.agents = agents;
      for (const key of [
        "tasksVisible",
        "taskSound",
        "taskNotifications",
      ] as const)
        if (typeof value[key] === "boolean") settings[key] = value[key];
      await persist();
      if (shortcutChanged) configureMenu();
    },
    addProject: async () => {
      const root = await chooseDirectory();
      if (!root) return null;
      const existing = settings.projects.find(
        (p) => !p.remoteId && p.path === root,
      );
      if (existing) return existing;
      const item = { id: randomUUID(), name: path.basename(root), path: root };
      settings.projects.push(item);
      settings.activeProject = item.id;
      await persist();
      watch(item.id);
      return item;
    },
    saveRemote: async (value: RemoteConnection) => {
      const connection = validateRemote(value);
      const existing =
        connection.id && settings.remotes?.find((r) => r.id === connection.id);
      if (connection.id && !existing) throw new Error("连接配置不存在");
      if (existing && settings.projects.some((p) => p.remoteId === existing.id))
        throw new Error(
          "此连接已被项目使用。请先移除相关项目，再修改连接，或创建新连接",
        );
      connection.id = existing ? existing.id : randomUUID();
      settings.remotes = [
        ...(settings.remotes || []).filter((r) => r.id !== connection.id),
        connection,
      ];
      remoteClients.get(connection.id)?.close();
      remoteClients.delete(connection.id);
      await persist();
      return connection;
    },
    removeRemote: async (id) => {
      remoteConnection(id);
      if (settings.projects.some((p) => p.remoteId === id))
        throw new Error("请先移除此连接下的项目");
      remoteClients.get(id)?.close();
      remoteClients.delete(id);
      settings.remotes = settings.remotes?.filter((r) => r.id !== id);
      await persist();
    },
    testRemote: (id) => remoteClient(id).call("info", ""),
    kerberosStatus: () => kerberosStatus(),
    addRemoteProject: async (id, value) => {
      if (typeof value !== "string" || !value.trim() || value.includes("\0"))
        throw new Error("请输入远端项目路径");
      const root = await remoteClient(id).call<string>("resolve", value.trim());
      return locked("remote-projects", async () => {
        const existing = settings.projects.find(
          (p) => p.remoteId === id && p.path === root,
        );
        if (existing) return existing;
        const item = {
          id: randomUUID(),
          name: path.posix.basename(root) || root,
          path: root,
          remoteId: id,
        };
        settings.projects.push(item);
        settings.activeProject = item.id;
        await persist();
        return item;
      });
    },
    relocateRemoteProject: async (id, value) => {
      const p = project(id);
      if (!p.remoteId) throw new Error("请选择远端项目");
      if (
        [...terminals.values()].some(
          (t) => t.info.projectId === id && !t.info.exited,
        )
      )
        throw new Error("请先关闭此项目的终端");
      const root = await remoteClient(p.remoteId).call<string>(
        "resolve",
        value,
      );
      if (
        settings.projects.some(
          (other) =>
            other.id !== id &&
            other.remoteId === p.remoteId &&
            other.path === root,
        )
      )
        throw new Error("此目录已添加");
      p.path = root;
      gitSnapshots.delete(id);
      await persist();
      return p;
    },
    updateProject: async (id, name) => {
      if (typeof name !== "string" || !name.trim())
        throw new Error("项目名称不能为空");
      const p = project(id);
      p.name = name.trim();
      await persist();
      return p;
    },
    relocateProject: async (id) => {
      const p = project(id);
      if (p.remoteId) throw new Error("请使用远端路径重新定位");
      if (
        [...terminals.values()].some(
          (t) => t.info.projectId === id && !t.info.exited,
        )
      )
        throw new Error("请先关闭此项目的终端");
      const root = await chooseDirectory();
      if (!root) return null;
      if (
        settings.projects.some(
          (other) => other.id !== id && !other.remoteId && other.path === root,
        )
      )
        throw new Error("此目录已添加");
      await watchers.get(id)?.close();
      watchers.delete(id);
      gitSnapshots.delete(id);
      p.path = root;
      await persist();
      watch(id);
      return p;
    },
    removeProject: async (id) => {
      const removed = project(id);
      if (
        [...terminals.values()].some(
          (t) => t.info.projectId === id && !t.info.exited,
        )
      )
        throw new Error("请先关闭此项目的终端");
      await watchers.get(id)?.close();
      watchers.delete(id);
      gitSnapshots.delete(id);
      settings.projects = settings.projects.filter((p) => p.id !== id);
      if (
        removed.remoteId &&
        !settings.projects.some((p) => p.remoteId === removed.remoteId)
      ) {
        remoteClients.get(removed.remoteId)?.close();
        remoteClients.delete(removed.remoteId);
      }
      delete settings.workspaces[id];
      if (settings.activeProject === id)
        settings.activeProject = settings.projects[0]?.id;
      await persist();
    },
    reorderProjects: async (ids) => {
      if (
        !Array.isArray(ids) ||
        new Set(ids).size !== settings.projects.length ||
        ids.length !== settings.projects.length
      )
        throw new Error("项目排序无效");
      settings.projects = ids.map(project);
      await persist();
    },
    listFiles: (id, relative) => {
      watch(id);
      return projectCall(id, "listFiles", relative);
    },
    readFile: (id, relative) => projectCall(id, "readFile", relative),
    writeFile: (id, relative, content, hash) =>
      locked(`file:${id}:${relative}`, () =>
        projectCall(id, "writeFile", relative, content, hash),
      ),
    createFile: (id, relative, directory) =>
      projectCall(id, "createFile", relative, directory),
    moveFile: (id, from, to) => projectCall(id, "moveFile", from, to),
    revealInFinder: async (id, relative) => {
      if (project(id).remoteId)
        throw new Error("远端文件不能在本机 Finder 中显示");
      const target = await service.safePath(project(id).path, relative, true);
      await fs.access(target);
      shell.showItemInFolder(target);
    },
    trashFile: async (id, relative) => {
      if (project(id).remoteId) {
        const result = await dialog.showMessageBox(win, {
          type: "warning",
          message: `将远端「${relative}」移到回收目录？`,
          detail: "文件将保存在远端 ~/.grove-trash，可手动恢复。",
          buttons: ["取消", "移到远端回收目录"],
          defaultId: 0,
          cancelId: 0,
        });
        if (result.response !== 1) return false;
        await projectCall(id, "trashFile", relative);
        gitSnapshots.delete(id);
        send("fileChange", { projectId: id, path: relative, type: "unlink" });
        return true;
      }
      const root = project(id).path;
      await service.safePath(root, relative);
      const target = path.join(
        await service.safePath(root, path.dirname(relative), true),
        path.basename(relative),
      );
      const result = await dialog.showMessageBox(win, {
        type: "warning",
        message: `将「${relative}」移到废纸篓？`,
        detail: "目录中的内容也会一起移入废纸篓。",
        buttons: ["取消", "移到废纸篓"],
        defaultId: 0,
        cancelId: 0,
      });
      if (result.response !== 1) return false;
      await shell.trashItem(target);
      return true;
    },
    search: (id, query, filenames) =>
      project(id).remoteId
        ? projectCall(id, "search", query, filenames)
        : service.search(
            project(id).path,
            query,
            filenames,
            app.isPackaged
              ? path.join(process.resourcesPath, "bin", "rg")
              : path.join(__dirname, `../resources/${process.arch}/rg`),
          ),
    gitHistory: (id, skip) => projectCall(id, "gitHistory", skip),
    gitCommitFiles: (id, hash) => projectCall(id, "gitCommitFiles", hash),
    gitCommitDiff: (id, hash, relative) =>
      projectCall(id, "gitCommitDiff", hash, relative),
    gitCommitDetail: (id, hash) => projectCall(id, "gitCommitDetail", hash),
    gitStatus: (id) => readGitStatus(id, true),
    gitDiff: async (id, relative, staged) => {
      const change = (await readGitStatus(id)).changes.find(
        (c) => c.path === relative,
      );
      if (!change) throw new Error("此文件没有 Git 变更，请刷新");
      return projectCall(id, "gitDiff", relative, staged, change);
    },
    gitDiscard: (id, relative) =>
      locked(`git:${id}`, () =>
        locked(`file:${id}:${relative}`, async () => {
          await shellEnvironment;
          try {
            await projectCall(id, "gitDiscard", relative);
          } finally {
            gitSnapshots.delete(id);
          }
        }),
      ),
    gitStage: (id, relative, stage) =>
      locked(`git:${id}`, async () => {
        await shellEnvironment;
        try {
          return await projectCall(id, "gitStage", relative, stage);
        } finally {
          gitSnapshots.delete(id);
        }
      }),
    gitCommit: (id, message) =>
      locked(`git:${id}`, async () => {
        await shellEnvironment;
        if (project(id).remoteId) {
          try {
            return await projectCall(id, "gitCommit", message);
          } finally {
            gitSnapshots.delete(id);
          }
        }
        if (typeof message !== "string" || !message.trim())
          throw new Error("请填写提交信息");
        const root = project(id).path;
        const status = await service.gitStatus(root);
        if (status.changes.some((c) => c.conflict))
          throw new Error("请先解决合并冲突");
        if (!status.changes.some((c) => c.index !== " " && c.index !== "?"))
          throw new Error("暂存区为空");
        // Commit scope includes the entire repository index; reject hidden staged files outside a nested project.
        const repo = (
          await service.git(root, ["rev-parse", "--show-toplevel"])
        ).trim();
        const all = await service.gitStatus(repo);
        if (
          all.changes.filter((c) => c.index !== " " && c.index !== "?")
            .length !==
          status.changes.filter((c) => c.index !== " " && c.index !== "?")
            .length
        )
          throw new Error(
            "仓库中有此项目目录之外的暂存文件，请打开仓库根目录后提交",
          );
        try {
          return await service.git(root, ["commit", "-m", message]);
        } finally {
          gitSnapshots.delete(id);
        }
      }),
    openExternal: async (value) => {
      if (typeof value !== "string" || value.length > 8192)
        throw new Error("链接无效");
      const url = new URL(value);
      if (!["https:", "http:"].includes(url.protocol))
        throw new Error("仅支持打开 HTTP 或 HTTPS 链接");
      await shell.openExternal(url.href);
    },
    terminalCreate: async (id) => {
      await shellEnvironment;
      const p = project(id);
      if (p.remoteId) await remoteClient(p.remoteId).call("resolve", p.path);
      else await fs.access(p.path);
      const shellPath = process.env.SHELL || "/bin/zsh";
      const processEnv = Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
      delete processEnv.ELECTRON_RUN_AS_NODE;
      const { spawn } = await import("node-pty");
      const child = spawn(
        p.remoteId ? "/usr/bin/ssh" : shellPath,
        p.remoteId
          ? [
              ...sshArgs(remoteConnection(p.remoteId), true),
              remoteTerminalCommand(p.path),
            ]
          : ["-l"],
        {
          name: "xterm-256color",
          cols: 80,
          rows: 24,
          cwd: p.remoteId ? app.getPath("home") : p.path,
          env: {
            ...processEnv,
            TERM: "xterm-256color",
            COLORTERM: "truecolor",
          },
        },
      );
      const info: TerminalSession = {
        id: randomUUID(),
        projectId: id,
        title: `${p.remoteId ? "SSH" : "Shell"} ${[...terminals.values()].filter((t) => t.info.projectId === id).length + 1}`,
      };
      const entry = { info, process: child, buffer: "" };
      terminals.set(info.id, entry);
      child.onData((data) => {
        entry.buffer = (entry.buffer + data).slice(-200000);
        send("terminalData", { id: info.id, data });
      });
      child.onExit(({ exitCode }) => {
        info.exited = true;
        send("terminalExit", { id: info.id, exitCode });
      });
      return info;
    },
    terminalList: () => [...terminals.values()].map((t) => t.info),
    terminalAttach: (id) => terminal(id).buffer,
    terminalWrite: (id, data) => {
      const t = terminal(id);
      if (!t.info.exited && typeof data === "string") {
        t.input?.();
        t.process.write(data);
      }
    },
    terminalResize: (id, cols, rows) => {
      const t = terminal(id);
      if (!t.info.exited)
        t.process.resize(
          Math.max(2, Math.min(500, Math.floor(cols) || 80)),
          Math.max(1, Math.min(300, Math.floor(rows) || 24)),
        );
    },
    terminalClose: async (id) => {
      const t = terminal(id);
      if (!t.info.exited) {
        const result = await dialog.showMessageBox(win, {
          type: "warning",
          message: "关闭此终端？",
          detail: "此终端中运行的任务将被中断。",
          buttons: ["取消", "关闭终端"],
          defaultId: 0,
          cancelId: 0,
        });
        if (result.response !== 1) return false;
        t.process.kill();
      }
      terminals.delete(id);
      return true;
    },
  };
  for (const [name, handler] of Object.entries(handlers))
    ipcMain.handle(`grove:${name}`, (event, ...args) => {
      if (
        event.sender !== win.webContents ||
        event.senderFrame !== win.webContents.mainFrame
      )
        throw new Error("无效来源");
      return handler(...args);
    });
  ipcMain.on("grove:finishQuit", (event, id, success) => {
    if (
      event.sender !== win.webContents ||
      !pendingQuit ||
      pendingQuit.id !== id
    )
      return;
    clearTimeout(pendingQuit.timer);
    pendingQuit = undefined;
    if (success === true) {
      quitting = true;
      app.quit();
    }
  });
  ipcMain.on("grove:dirty", (event, value) => {
    if (event.sender === win.webContents) dirty = Boolean(value);
  });
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1000,
    minHeight: 640,
    title: "Grove",
    backgroundColor: "#111916",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 19 },
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || input.isAutoRepeat || input.isComposing)
      return;
    const shortcut = shortcutFromKey({
      code: input.code,
      metaKey: input.meta,
      ctrlKey: input.control,
      altKey: input.alt,
      shiftKey: input.shift,
    });
    if (!shortcut) return;
    try {
      if (normalizeTerminalShortcut(shortcut) === settings.terminalShortcut) {
        event.preventDefault();
        send("menu", "terminal");
      }
    } catch {
      /* Other application and editing keys retain their usual behavior. */
    }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  win.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    if (pendingQuit) return;
    const running = [...terminals.values()].some((t) => !t.info.exited);
    let save = false;
    if (dirty || running) {
      const response = dialog.showMessageBoxSync(win, {
        type: "warning",
        message: "退出 Grove？",
        detail: [
          dirty ? "请选择保存所有文件，或放弃未保存的修改。" : "",
          running ? "退出后运行中的终端任务将被中断。" : "",
        ]
          .filter(Boolean)
          .join("\n"),
        buttons: dirty
          ? ["取消", "保存并退出", "不保存并退出"]
          : ["取消", "退出"],
        defaultId: 0,
        cancelId: 0,
      });
      if (response === 0) return;
      save = dirty && response === 1;
    }
    const id = randomUUID();
    pendingQuit = {
      id,
      timer: setTimeout(() => {
        pendingQuit = undefined;
        if (!win.isDestroyed())
          dialog.showMessageBoxSync(win, {
            type: "error",
            message: "退出尚未完成",
            detail: "工作区未能及时完成保存。应用已保持打开，请检查后重试。",
          });
      }, 30000),
    };
    send("prepareQuit", { id, save, discard: dirty && !save });
  });
  if (!app.isPackaged && process.env.GROVE_DEV_URL === "http://127.0.0.1:5178")
    await win.loadURL(process.env.GROVE_DEV_URL);
  else await win.loadFile(path.join(__dirname, "../dist/index.html"));
}
function configureMenu() {
  const action = (name: string) => () => send("menu", name);
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Grove",
        submenu: [
          { role: "about" },
          {
            label: "设置…",
            accelerator: "CmdOrCtrl+,",
            click: action("settings"),
          },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      {
        label: "文件",
        submenu: [
          {
            label: "新建文件…",
            accelerator: "CmdOrCtrl+N",
            click: action("new-file"),
          },
          {
            label: "新建文件夹…",
            accelerator: "CmdOrCtrl+Shift+N",
            click: action("new-folder"),
          },
          {
            label: "添加项目…",
            accelerator: "CmdOrCtrl+O",
            click: action("add-project"),
          },
          { label: "保存", accelerator: "CmdOrCtrl+S", click: action("save") },
          {
            label: "全部保存",
            accelerator: "CmdOrCtrl+Alt+S",
            click: action("save-all"),
          },
          {
            label: "关闭标签",
            accelerator: "CmdOrCtrl+W",
            click: action("close-tab"),
          },
        ],
      },
      {
        label: "编辑",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      {
        label: "视图",
        submenu: [
          {
            label: "快速打开",
            accelerator: "CmdOrCtrl+P",
            click: action("quick-open"),
          },
          {
            label: "项目搜索",
            accelerator: "CmdOrCtrl+Shift+F",
            click: action("search"),
          },
          {
            label: "切换侧栏",
            accelerator: "CmdOrCtrl+B",
            click: action("sidebar"),
          },
          {
            id: "toggle-terminal",
            label: "切换终端",
            accelerator: settings.terminalShortcut,
            click: action("terminal"),
          },
          { role: "togglefullscreen" },
          { role: "toggleDevTools" },
        ],
      },
      {
        label: "终端",
        submenu: [
          {
            label: "新建终端",
            accelerator: "Ctrl+Shift+`",
            click: action("new-terminal"),
          },
        ],
      },
      { role: "windowMenu" },
    ]),
  );
}
app.whenReady().then(async () => {
  // Resolve the Finder login PATH without blocking the first window or file IPC.
  // Terminal creation waits for it; file browsing does not need the shell.
  shellEnvironment = (async () => {
    try {
      const { stdout } = await promisify(execFile)(
        process.env.SHELL || "/bin/zsh",
        ["-ilc", 'printf "\\n__GROVE_PATH__%s" "$PATH"'],
        { encoding: "utf8", timeout: 5000 },
      );
      const marker = stdout.lastIndexOf("__GROVE_PATH__");
      if (marker >= 0) process.env.PATH = stdout.slice(marker + 14).trim();
    } catch {
      process.env.PATH = `${process.env.PATH || ""}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`;
    }
  })();
  try {
    settings = {
      ...service.defaults(),
      ...JSON.parse(await fs.readFile(settingsFile(), "utf8")),
    };
  } catch (error: any) {
    if (error.code !== "ENOENT") {
      await fs
        .copyFile(settingsFile(), settingsFile() + `.backup-${Date.now()}`)
        .catch(() => {});
    }
  }
  if (process.env.GROVE_TEST_PROJECT && !settings.projects.length) {
    settings.projects = [
      {
        id: "test-project",
        name: "Test project",
        path: await fs.realpath(process.env.GROVE_TEST_PROJECT),
      },
    ];
    settings.activeProject = "test-project";
  }
  tasks = new TaskManager(
    path.join(app.getPath("userData"), "tasks.json"),
    (task) => send("taskChange", task),
    (task) => {
      if (settings.taskSound !== false) shell.beep();
      if (settings.taskNotifications !== false && Notification.isSupported()) {
        const notification = new Notification({
          title: task.status === "succeeded" ? "任务执行完成" : "任务执行失败",
          body: `${task.title} · ${task.agentName} · ${task.projectName}`,
          silent: true,
        });
        notification.on("click", () => {
          if (win && !win.isDestroyed()) {
            if (win.isMinimized()) win.restore();
            win.show();
            win.focus();
            send("menu", "tasks");
          }
        });
        notification.show();
      }
    },
    async (task, project, remote, events) => {
      let entry:
        | {
            info: TerminalSession;
            process: pty.IPty;
            buffer: string;
            input?: () => void;
          }
        | undefined;
      let buffer = "";
      let exited = false;
      const session = await openTaskTerminal(project, remote, {
        output(data) {
          buffer = (buffer + data).slice(-200000);
          if (entry) {
            entry.buffer = buffer;
            send("terminalData", { id: entry.info.id, data });
          }
          events.output(data);
        },
        complete: events.complete,
        exit(code) {
          exited = true;
          if (entry) {
            entry.info.exited = true;
            send("terminalExit", { id: entry.info.id, exitCode: code });
          }
          events.exit(code);
        },
      });
      entry = {
        info: {
          id: session.id,
          projectId: project.id,
          taskId: task.id,
          title: `${task.agentName} · ${task.title}`,
          exited,
        },
        process: session.process,
        buffer,
        input: session.input,
      };
      terminals.set(session.id, entry);
      send("terminalCreated", entry.info);
      return session;
    },
  );
  try {
    await tasks.load();
  } catch (error) {
    taskLoadError = error;
  }
  setupIPC();
  configureMenu();
  await createWindow();
});
app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => {
  tasks?.close();
  for (const client of remoteClients.values()) client.close();
  for (const t of terminals.values())
    if (!t.info.exited && !t.info.taskId) t.process.kill();
  for (const w of watchers.values()) void w.close();
});

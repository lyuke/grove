import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import * as pty from "node-pty";
import chokidar, { type FSWatcher } from "chokidar";
import * as service from "./services";
import type { Settings, TerminalSession } from "../shared/types";

if (process.env.GROVE_USER_DATA)
  app.setPath("userData", process.env.GROVE_USER_DATA);
let win: BrowserWindow;
let settings: Settings = service.defaults();
let dirty = false;
let quitting = false;
let pendingQuit:
  { id: string; timer: ReturnType<typeof setTimeout> } | undefined;
const watchers = new Map<string, FSWatcher>();
const terminals = new Map<
  string,
  { info: TerminalSession; process: pty.IPty; buffer: string }
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
function watch(id: string) {
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
  watcher.on("all", (type, file) =>
    send("fileChange", {
      projectId: id,
      path: path.relative(root, file),
      type,
    }),
  );
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
    saveSettings: async (value: Partial<Settings>) => {
      if (value.theme === "dark" || value.theme === "light")
        settings.theme = value.theme;
      if (
        value.activeProject === undefined ||
        settings.projects.some((p) => p.id === value.activeProject)
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
      await persist();
    },
    addProject: async () => {
      const root = await chooseDirectory();
      if (!root) return null;
      const existing = settings.projects.find((p) => p.path === root);
      if (existing) return existing;
      const item = { id: randomUUID(), name: path.basename(root), path: root };
      settings.projects.push(item);
      settings.activeProject = item.id;
      await persist();
      watch(item.id);
      return item;
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
          (other) => other.id !== id && other.path === root,
        )
      )
        throw new Error("此目录已添加");
      await watchers.get(id)?.close();
      watchers.delete(id);
      p.path = root;
      await persist();
      watch(id);
      return p;
    },
    removeProject: async (id) => {
      project(id);
      if (
        [...terminals.values()].some(
          (t) => t.info.projectId === id && !t.info.exited,
        )
      )
        throw new Error("请先关闭此项目的终端");
      await watchers.get(id)?.close();
      watchers.delete(id);
      settings.projects = settings.projects.filter((p) => p.id !== id);
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
      return service.listFiles(project(id).path, relative);
    },
    readFile: (id, relative) => service.readFile(project(id).path, relative),
    writeFile: (id, relative, content, hash) =>
      locked(`file:${id}:${relative}`, () =>
        service.writeFile(project(id).path, relative, content, hash),
      ),
    createFile: (id, relative, directory) =>
      service.createFile(project(id).path, relative, directory),
    moveFile: (id, from, to) => service.moveFile(project(id).path, from, to),
    trashFile: async (id, relative) => {
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
      service.search(
        project(id).path,
        query,
        filenames,
        app.isPackaged
          ? path.join(process.resourcesPath, "bin", "rg")
          : path.join(__dirname, `../resources/${process.arch}/rg`),
      ),
    gitStatus: (id) => service.gitStatus(project(id).path),
    gitDiff: (id, relative, staged) =>
      service.gitDiff(project(id).path, relative, staged),
    gitStage: (id, relative, stage) =>
      locked(`git:${id}`, () =>
        service.gitStage(project(id).path, relative, stage),
      ),
    gitCommit: (id, message) =>
      locked(`git:${id}`, async () => {
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
        return service.git(root, ["commit", "-m", message]);
      }),
    terminalCreate: async (id) => {
      const p = project(id);
      await fs.access(p.path);
      const shellPath = process.env.SHELL || "/bin/zsh";
      const processEnv = Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
      delete processEnv.ELECTRON_RUN_AS_NODE;
      const child = pty.spawn(shellPath, ["-l"], {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: p.path,
        env: { ...processEnv, TERM: "xterm-256color", COLORTERM: "truecolor" },
      });
      const info: TerminalSession = {
        id: randomUUID(),
        projectId: id,
        title: `Shell ${[...terminals.values()].filter((t) => t.info.projectId === id).length + 1}`,
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
      if (!t.info.exited && typeof data === "string") t.process.write(data);
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
app.whenReady().then(async () => {
  // Finder launches do not inherit the shell's PATH. Load it once using the login shell.
  try {
    const result = execFileSync(
      process.env.SHELL || "/bin/zsh",
      ["-ilc", 'printf "\\n__GROVE_PATH__%s" "$PATH"'],
      { encoding: "utf8", timeout: 5000 },
    );
    const marker = result.lastIndexOf("__GROVE_PATH__");
    if (marker >= 0) process.env.PATH = result.slice(marker + 14).trim();
  } catch {
    process.env.PATH = `${process.env.PATH || ""}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`;
  }
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
  setupIPC();
  const action = (name: string) => () => send("menu", name);
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Grove",
        submenu: [
          { role: "about" },
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
            label: "切换终端",
            accelerator: "Ctrl+`",
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
  await createWindow();
});
app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => {
  for (const t of terminals.values()) if (!t.info.exited) t.process.kill();
  for (const w of watchers.values()) void w.close();
});

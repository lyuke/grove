import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronsLeftRight,
  FileCode2,
  Files,
  FolderOpen,
  GitBranch,
  Leaf,
  MoreHorizontal,
  PanelLeftClose,
  PanelBottomClose,
  Plus,
  Search,
  Settings2,
  Sun,
  Moon,
  X,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import type {
  Change,
  FileEntry,
  GitDiff,
  GitStatus,
  Project,
  Settings,
  TerminalSession,
} from "../shared/types";
import type { OpenDocument } from "./components/Editor";
import FileTree from "./components/FileTree";
import GitPanel from "./components/GitPanel";
import SearchPanel from "./components/SearchPanel";
import TerminalPane from "./components/TerminalPane";

const loadEditor = () => import("./components/Editor");
const Editor = lazy(loadEditor);
const DiffView = lazy(() =>
  loadEditor().then((m) => ({ default: m.DiffView })),
);
const api = window.grove;
const basename = (path: string) => path.split("/").pop() || path;
const cleanError = (error: unknown) =>
  String(error instanceof Error ? error.message : error).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    "",
  );
// Keep expensive child props stable while callbacks still see the latest workspace.
function useEvent<T extends (...args: any[]) => void>(callback: T): T {
  const ref = useRef(callback);
  ref.current = callback;
  return useCallback(((...args) => ref.current(...args)) as T, []);
}
type DialogRequest = {
  title: string;
  description?: string;
  value?: string;
  placeholder?: string;
  choices?: { label: string; value: string; danger?: boolean }[];
  resolve(value: string | null): void;
};
type DiffState = {
  projectId: string;
  path: string;
  staged: boolean;
  data: GitDiff;
};

function Dialog({
  request,
  dismiss,
}: {
  request: DialogRequest;
  dismiss(value: string | null): void;
}) {
  const [value, setValue] = useState(request.value || "");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const focusables = () => [
      ...(ref.current?.querySelectorAll<HTMLElement>("input,button") || []),
    ];
    focusables()[0]?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        dismiss(null);
      }
      if (event.key === "Tab") {
        const items = focusables();
        const index = items.indexOf(document.activeElement as HTMLElement);
        event.preventDefault();
        items[
          (index + (event.shiftKey ? -1 : 1) + items.length) % items.length
        ]?.focus();
      }
    };
    document.addEventListener("keydown", listener, true);
    return () => {
      document.removeEventListener("keydown", listener, true);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) dismiss(null);
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        ref={ref}
      >
        <div className="dialog-heading">
          <h2 id="dialog-title">{request.title}</h2>
          <button
            className="icon-button"
            title="关闭对话框"
            onClick={() => dismiss(null)}
          >
            <X size={16} />
          </button>
        </div>
        {request.description && <p>{request.description}</p>}
        {request.value !== undefined ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (value.trim()) dismiss(value.trim());
            }}
          >
            <input
              autoFocus
              aria-label={request.title}
              placeholder={request.placeholder}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
            <div className="dialog-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => dismiss(null)}
              >
                取消
              </button>
              <button
                type="submit"
                className="primary-button"
                disabled={!value.trim()}
              >
                确定
              </button>
            </div>
          </form>
        ) : (
          <div className="dialog-choices">
            {request.choices?.map((choice) => (
              <button
                key={choice.value}
                className={`secondary-button ${choice.danger ? "danger-text" : ""}`}
                onClick={() => dismiss(choice.value)}
              >
                {choice.label}
              </button>
            ))}
            <button className="text-button" onClick={() => dismiss(null)}>
              取消
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [docs, setDocs] = useState<OpenDocument[]>([]);
  const [activeKeys, setActiveKeys] = useState<Record<string, string>>({});
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [projectFilter, setProjectFilter] = useState("");
  const [panel, setPanel] = useState<"files" | "search" | "git">("files");
  const [revision, setRevision] = useState(0);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [gitRefresh, setGitRefresh] = useState(0);
  const [gitBusy, setGitBusy] = useState(false);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [diff, setDiff] = useState<DiffState | null>(null);
  const [sideBySide, setSideBySide] = useState(true);
  const [compareExternal, setCompareExternal] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [projectMenu, setProjectMenu] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogRequest | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(
    null,
  );
  const [ready, setReady] = useState(false);
  const latest = useRef({ settings, docs, activeKeys });
  latest.current = { settings, docs, activeKeys };
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(new Set<string>());
  const openRequests = useRef(new Set<string>());
  const notify = useCallback((text: string, error = false) => {
    setNotice({ text, error });
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(
      () => setNotice(null),
      error ? 15000 : 4500,
    );
  }, []);
  const onError = useCallback(
    (error: unknown) => notify(cleanError(error), true),
    [notify],
  );
  const run = (task: () => Promise<unknown>) => {
    void task().catch(onError);
  };
  const ask = (request: Omit<DialogRequest, "resolve">) =>
    new Promise<string | null>((resolve) => setDialog({ ...request, resolve }));
  const dismiss = (value: string | null) => {
    dialog?.resolve(value);
    setDialog(null);
  };
  const project = settings?.projects.find(
    (p) => p.id === settings.activeProject,
  );
  const projectId = project?.id;
  const projectDocs = docs.filter((d) => d.projectId === projectId);
  const activeDoc =
    projectDocs.find((d) => d.key === activeKeys[projectId || ""]) ||
    projectDocs.at(-1);
  const activeDiff = diff?.projectId === projectId ? diff : null;

  useEffect(() => {
    if (!api) return;
    let alive = true;
    (async () => {
      const [loaded, terminals] = await Promise.all([
        api.settings(),
        api.terminalList(),
      ]);
      const restored: OpenDocument[] = [];
      const keys: Record<string, string> = {};
      const results = await Promise.allSettled(
        loaded.projects.flatMap((p) =>
          (loaded.workspaces[p.id]?.tabs || []).map(async (file) => {
            const data = await api.readFile(p.id, file);
            return {
              key: `${p.id}:${file}`,
              projectId: p.id,
              path: file,
              content: data.content,
              base: data.content,
              hash: data.hash,
              position: loaded.workspaces[p.id]?.positions?.[file],
            };
          }),
        ),
      );
      results.forEach((result) => {
        if (result.status === "fulfilled") restored.push(result.value);
      });
      for (const p of loaded.projects)
        if (loaded.workspaces[p.id]?.active)
          keys[p.id] = `${p.id}:${loaded.workspaces[p.id].active}`;
      if (!alive) return;
      setSettings(loaded);
      setDocs(restored);
      setActiveKeys(keys);
      setSessions(terminals);
      setReady(true);
      if (results.some((r) => r.status === "rejected"))
        notify("部分文件无法恢复，请在文件树中检查路径。", true);
    })().catch(onError);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const idle = requestIdleCallback(
      () => {
        void loadEditor().catch(onError);
      },
      { timeout: 1000 },
    );
    return () => cancelIdleCallback(idle);
  }, [ready, onError]);

  async function persistWorkspace() {
    if (!latest.current.settings || !ready)
      throw new Error("工作区仍在加载，请稍后重试");
    const state = latest.current;
    const workspaces: Settings["workspaces"] = {};
    for (const p of state.settings!.projects) {
      const local = state.docs.filter((d) => d.projectId === p.id);
      workspaces[p.id] = {
        tabs: local.map((d) => d.path),
        active: local.find((d) => d.key === state.activeKeys[p.id])?.path,
        positions: Object.fromEntries(
          local.filter((d) => d.position).map((d) => [d.path, d.position!]),
        ),
      };
    }
    return api.saveSettings({
      activeProject: state.settings!.activeProject,
      theme: state.settings!.theme,
      widths: state.settings!.widths,
      collapsed: state.settings!.collapsed,
      terminalHeight: state.settings!.terminalHeight,
      terminalMaximized: state.settings!.terminalMaximized,
      terminalFontSize: state.settings!.terminalFontSize,
      workspaces,
    });
  }
  useEffect(() => {
    if (!settings || !ready) return;
    const timer = setTimeout(() => void persistWorkspace().catch(onError), 250);
    return () => clearTimeout(timer);
  }, [settings, docs, activeKeys, ready]);
  const prepareQuit = useRef<
    (request: { id: string; save: boolean; discard: boolean }) => Promise<void>
  >(async () => {});
  prepareQuit.current = async ({ id, save, discard }) => {
    try {
      if (save) await saveAll();
      await persistWorkspace();
      if (
        saving.current.size ||
        (!discard && latest.current.docs.some((d) => d.content !== d.base))
      )
        throw new Error("仍有未保存的修改，请保存完成后再退出");
      api.finishQuit(id, true);
    } catch (error) {
      onError(error);
      api.finishQuit(id, false);
    }
  };
  useEffect(
    () => api?.onPrepareQuit((request) => void prepareQuit.current(request)),
    [],
  );

  useEffect(() => {
    api?.setDirty(docs.some((d) => d.content !== d.base));
  }, [docs]);
  useEffect(() => {
    if (!api) return;
    let treeTimer: ReturnType<typeof setTimeout>;
    const refreshes = new Map<string, number>();
    const off = api.onFileChange((event) => {
      clearTimeout(treeTimer);
      treeTimer = setTimeout(() => {
        setRevision((v) => v + 1);
        setGitRefresh((v) => v + 1);
      }, 250);
      const targets = latest.current.docs.filter(
        (d) =>
          d.projectId === event.projectId &&
          (d.path === event.path || d.path.startsWith(event.path + "/")),
      );
      targets.forEach((doc) => {
        const token = (refreshes.get(doc.key) || 0) + 1;
        refreshes.set(doc.key, token);
        api
          .readFile(doc.projectId, doc.path)
          .then((data) => {
            if (refreshes.get(doc.key) !== token) return;
            setDocs((current) =>
              current.map((d) => {
                if (d.key !== doc.key || d.hash === data.hash)
                  return d.missing && d.key === doc.key
                    ? { ...d, missing: false }
                    : d;
                if (d.content === d.base)
                  return {
                    ...d,
                    content: data.content,
                    base: data.content,
                    hash: data.hash,
                    external: undefined,
                    missing: false,
                  };
                return { ...d, external: data, missing: false };
              }),
            );
          })
          .catch(() => {
            if (refreshes.get(doc.key) === token)
              setDocs((current) =>
                current.map((d) =>
                  d.key === doc.key ? { ...d, missing: true } : d,
                ),
              );
          });
      });
    });
    const exit = api.onTerminalExit((event) =>
      setSessions((current) =>
        current.map((s) => (s.id === event.id ? { ...s, exited: true } : s)),
      ),
    );
    return () => {
      off();
      exit();
      clearTimeout(treeTimer);
    };
  }, []);

  useEffect(() => {
    if (!projectId) {
      setGitStatus(null);
      return;
    }
    let alive = true;
    api
      .gitStatus(projectId)
      .then((status) => {
        if (alive) setGitStatus(status);
      })
      .catch((error) => {
        if (alive) onError(error);
      });
    return () => {
      alive = false;
    };
  }, [projectId, gitRefresh]);
  useEffect(() => {
    setGitStatus(null);
    setDiff(null);
    setCompareExternal(false);
    setQuickOpen(false);
  }, [projectId]);
  useEffect(() => {
    setCompareExternal(false);
  }, [activeDoc?.key]);
  useEffect(() => {
    const refresh = () => {
      setRevision((v) => v + 1);
      setGitRefresh((v) => v + 1);
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  useEffect(() => {
    if (!diff || diff.projectId !== projectId) return;
    let alive = true;
    api
      .gitDiff(diff.projectId, diff.path, diff.staged)
      .then((data) => {
        if (alive) setDiff((current) => current && { ...current, data });
      })
      .catch(() => {
        if (alive) setDiff(null);
      });
    return () => {
      alive = false;
    };
  }, [projectId, gitRefresh, diff?.path, diff?.staged]);

  async function addProject() {
    const added = await api.addProject();
    if (!added) return;
    setSettings(
      (current) =>
        current && {
          ...current,
          projects: current.projects.some((p) => p.id === added.id)
            ? current.projects
            : [...current.projects, added],
          activeProject: added.id,
        },
    );
  }
  const treeOpen = useEvent((file: string) => run(() => openFile(file)));
  const treeCreate = useEvent((parent: string, directory: boolean) =>
    run(() => createFile(parent, directory)),
  );
  const treeAction = useEvent((entry: FileEntry) =>
    run(() => fileAction(entry)),
  );
  const treeRelocate = useEvent(() => {
    if (project) run(() => projectAction(project, "relocate"));
  });
  function switchProject(id: string) {
    setSettings((current) => current && { ...current, activeProject: id });
    setProjectMenu(null);
  }
  async function openFile(
    file: string,
    line?: number,
    targetProject = projectId,
  ) {
    if (!targetProject) return;
    void loadEditor().catch(onError);
    const key = `${targetProject}:${file}`;
    const existing = latest.current.docs.find((d) => d.key === key);
    if (!existing) {
      if (openRequests.current.has(key)) return;
      openRequests.current.add(key);
      try {
        const data = await api.readFile(targetProject, file);
        setDocs((current) =>
          current.some((d) => d.key === key)
            ? current
            : [
                ...current,
                {
                  key,
                  projectId: targetProject,
                  path: file,
                  content: data.content,
                  base: data.content,
                  hash: data.hash,
                  position: line ? { lineNumber: line, column: 1 } : undefined,
                },
              ],
        );
      } finally {
        openRequests.current.delete(key);
      }
    } else if (line)
      setDocs((current) =>
        current.map((d) =>
          d.key === key
            ? { ...d, position: { lineNumber: line, column: 1 } }
            : d,
        ),
      );
    setActiveKeys((current) => ({ ...current, [targetProject]: key }));
    setDiff(null);
    setQuickOpen(false);
  }
  async function saveAll() {
    if (saving.current.size) throw new Error("文件正在保存，请完成后重试");
    const unsaved = latest.current.docs.filter((d) => d.content !== d.base);
    for (const doc of unsaved) await saveDoc(doc);
    if (unsaved.length) notify(`已保存 ${unsaved.length} 个文件`);
  }
  async function saveDoc(doc = activeDoc) {
    if (!doc || saving.current.has(doc.key) || doc.content === doc.base) return;
    saving.current.add(doc.key);
    try {
      const data = await api.writeFile(
        doc.projectId,
        doc.path,
        doc.content,
        doc.hash,
      );
      setDocs((current) =>
        current.map((d) =>
          d.key === doc.key
            ? {
                ...d,
                base: data.content,
                hash: data.hash,
                external: undefined,
                missing: false,
              }
            : d,
        ),
      );
      setGitRefresh((v) => v + 1);
      notify(`已保存 ${basename(doc.path)}`);
    } catch (error) {
      try {
        const data = await api.readFile(doc.projectId, doc.path);
        if (data.hash !== doc.hash)
          setDocs((current) =>
            current.map((d) =>
              d.key === doc.key ? { ...d, external: data } : d,
            ),
          );
      } catch {
        /* Original save error is surfaced below. */
      }
      throw error;
    } finally {
      saving.current.delete(doc.key);
    }
  }
  async function closeDoc(doc: OpenDocument) {
    if (doc.content !== doc.base) {
      const choice = await ask({
        title: `保存 ${basename(doc.path)} 的修改？`,
        description: "关闭后，未保存的修改将丢失。",
        choices: [
          { label: "保存并关闭", value: "save" },
          { label: "放弃修改并关闭", value: "discard", danger: true },
        ],
      });
      if (!choice) return;
      if (choice === "save") await saveDoc(doc);
    }
    setDocs((current) => current.filter((d) => d.key !== doc.key));
  }
  async function resolveExternal(keepMine: boolean) {
    const doc = activeDoc;
    if (!doc?.external) return;
    const choice = await ask({
      title: keepMine ? "保留编辑器中的版本？" : "使用磁盘中的版本？",
      description: keepMine
        ? "将以当前磁盘版本为保存基准。点击保存后，磁盘内容会被编辑器版本替换。"
        : "未保存的编辑器修改将被磁盘版本替换。",
      choices: [
        { label: keepMine ? "保留我的修改" : "使用磁盘版本", value: "yes" },
      ],
    });
    if (!choice) return;
    setDocs((current) =>
      current.map((d) =>
        d.key === doc.key && d.external
          ? {
              ...d,
              content: keepMine ? d.content : d.external.content,
              base: d.external.content,
              hash: d.external.hash,
              external: undefined,
            }
          : d,
      ),
    );
    setCompareExternal(false);
  }
  async function createFile(parent: string, directory: boolean) {
    if (!projectId) return;
    const id = projectId;
    const value = await ask({
      title: directory ? "新建文件夹" : "新建文件",
      description: "输入相对于项目根目录的路径。",
      value: parent ? parent + "/" : "",
      placeholder: directory ? "src/components" : "src/example.ts",
    });
    if (!value) return;
    await api.createFile(id, value, directory);
    setRevision((v) => v + 1);
    if (!directory) await openFile(value, undefined, id);
  }
  async function fileAction(entry: FileEntry) {
    const id = projectId!;
    const choice = await ask({
      title: entry.name,
      choices: [
        ...(entry.directory
          ? [
              { label: "在此新建文件", value: "file" },
              { label: "在此新建文件夹", value: "folder" },
            ]
          : []),
        { label: "重命名 / 移动", value: "move" },
        { label: "移到废纸篓", value: "delete", danger: true },
      ],
    });
    if (choice === "file" || choice === "folder")
      return createFile(entry.path, choice === "folder");
    if (choice === "move") {
      const to = await ask({
        title: "重命名 / 移动",
        description: "输入相对于项目根目录的新路径。目标父目录需要已存在。",
        value: entry.path,
      });
      if (!to || to === entry.path) return;
      await api.moveFile(id, entry.path, to);
      setDocs((current) =>
        current.map((d) => {
          if (
            d.projectId !== id ||
            (d.path !== entry.path && !d.path.startsWith(entry.path + "/"))
          )
            return d;
          const renamed = to + d.path.slice(entry.path.length);
          return {
            ...d,
            path: renamed,
            key: `${id}:${renamed}`,
            missing: false,
          };
        }),
      );
      setActiveKeys((current) => {
        const old = current[id];
        return old?.startsWith(`${id}:${entry.path}`)
          ? {
              ...current,
              [id]: old.replace(`${id}:${entry.path}`, `${id}:${to}`),
            }
          : current;
      });
      setDiff(null);
      setRevision((v) => v + 1);
    }
    if (choice === "delete") {
      if (
        latest.current.docs.some(
          (d) =>
            d.projectId === id &&
            (d.path === entry.path || d.path.startsWith(entry.path + "/")) &&
            d.content !== d.base,
        )
      )
        throw new Error("请先保存或关闭此路径下未保存的文件");
      if (await api.trashFile(id, entry.path)) {
        setDocs((current) =>
          current.filter(
            (d) =>
              !(
                d.projectId === id &&
                (d.path === entry.path || d.path.startsWith(entry.path + "/"))
              ),
          ),
        );
        setRevision((v) => v + 1);
        setDiff(null);
      }
    }
  }
  async function projectAction(p: Project, action: string) {
    setProjectMenu(null);
    if (action === "rename") {
      const name = await ask({ title: "修改项目名称", value: p.name });
      if (!name) return;
      const updated = await api.updateProject(p.id, name);
      setSettings(
        (s) =>
          s && {
            ...s,
            projects: s.projects.map((item) =>
              item.id === p.id ? updated : item,
            ),
          },
      );
    } else if (action === "relocate") {
      if (docs.some((d) => d.projectId === p.id && d.content !== d.base))
        throw new Error("请先保存或关闭此项目未保存的文件");
      const updated = await api.relocateProject(p.id);
      if (!updated) return;
      setDocs((current) => current.filter((d) => d.projectId !== p.id));
      setSettings(
        (s) =>
          s && {
            ...s,
            projects: s.projects.map((item) =>
              item.id === p.id ? updated : item,
            ),
          },
      );
      setRevision((v) => v + 1);
    } else if (action === "remove") {
      if (docs.some((d) => d.projectId === p.id && d.content !== d.base))
        throw new Error("请先保存或关闭此项目未保存的文件");
      if (
        !(await ask({
          title: `移除 ${p.name}？`,
          description: "仅从项目列表移除，磁盘文件会保留。",
          choices: [{ label: "移除项目", value: "yes", danger: true }],
        }))
      )
        return;
      await api.removeProject(p.id);
      setDocs((current) => current.filter((d) => d.projectId !== p.id));
      setSettings((s) => {
        if (!s) return s;
        const projects = s.projects.filter((item) => item.id !== p.id);
        return {
          ...s,
          projects,
          activeProject:
            s.activeProject === p.id ? projects[0]?.id : s.activeProject,
        };
      });
    } else {
      const projects = [...latest.current.settings!.projects];
      const index = projects.findIndex((item) => item.id === p.id);
      const next = index + (action === "up" ? -1 : 1);
      if (next < 0 || next >= projects.length) return;
      [projects[index], projects[next]] = [projects[next], projects[index]];
      await api.reorderProjects(projects.map((item) => item.id));
      setSettings((s) => s && { ...s, projects });
    }
  }
  async function showDiff(change: Change, staged: boolean) {
    if (change.conflict) {
      await openFile(change.path);
      notify("请解决文件中的冲突标记，再暂存。", true);
      return;
    }
    const id = projectId!;
    const data = await api.gitDiff(id, change.path, staged);
    setDiff({ projectId: id, path: change.path, staged, data });
  }
  async function stage(change: Change, stage: boolean) {
    setGitBusy(true);
    try {
      await api.gitStage(projectId!, change.path, stage);
      setGitRefresh((v) => v + 1);
      setDiff(null);
    } finally {
      setGitBusy(false);
    }
  }
  async function commit() {
    const id = projectId!;
    setGitBusy(true);
    try {
      const output = await api.gitCommit(id, messages[id]);
      setMessages((current) => ({ ...current, [id]: "" }));
      setDiff(null);
      setGitRefresh((v) => v + 1);
      notify(output.split("\n")[0]);
    } finally {
      setGitBusy(false);
    }
  }
  async function newTerminal() {
    if (!projectId) return;
    const session = await api.terminalCreate(projectId);
    setSessions((current) => [...current, session]);
    setSettings(
      (s) => s && { ...s, collapsed: [s.collapsed[0], s.collapsed[1], false] },
    );
  }
  function togglePanel(index: number) {
    setSettings(
      (s) =>
        s && {
          ...s,
          collapsed: s.collapsed.map((value, i) =>
            i === index ? !value : value,
          ),
        },
    );
  }
  const actions = useRef<Record<string, () => void>>({});
  actions.current = {
    "add-project": () => run(addProject),
    save: () => run(() => saveDoc()),
    "save-all": () => run(saveAll),
    "close-tab": () => {
      if (activeDiff) setDiff(null);
      else if (activeDoc) run(() => closeDoc(activeDoc));
    },
    "quick-open": () => {
      if (projectId) setQuickOpen(true);
    },
    search: () => {
      setPanel("search");
      setSettings(
        (s) =>
          s && { ...s, collapsed: [s.collapsed[0], false, s.collapsed[2]] },
      );
    },
    sidebar: () => togglePanel(1),
    terminal: () => togglePanel(2),
    "new-terminal": () => run(newTerminal),
  };
  useEffect(() => api?.onMenu((action) => actions.current[action]?.()), []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setQuickOpen(false);
        setProjectMenu(null);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);
  function resize(index: number, event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    const initialX = event.clientX;
    const width = settings!.widths[index];
    const element = event.currentTarget;
    const move = (e: PointerEvent) =>
      setSettings(
        (s) =>
          s && {
            ...s,
            widths: s.widths.map((w, i) =>
              i === index
                ? Math.max(
                    index === 0 ? 140 : 180,
                    Math.min(
                      index === 2 ? 650 : 400,
                      width + (e.clientX - initialX) * (index === 2 ? -1 : 1),
                    ),
                  )
                : w,
            ),
          },
      );
    const up = () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", up);
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", up);
  }

  function setTerminalHeight(height: number, container: HTMLElement | null) {
    const maximum = Math.max(140, (container?.clientHeight || 700) - 160);
    setSettings(
      (s) =>
        s && { ...s, terminalHeight: Math.max(140, Math.min(maximum, height)) },
    );
  }
  function resizeTerminal(event: React.PointerEvent<HTMLDivElement>) {
    const element = event.currentTarget;
    const container = element.parentElement;
    const height =
      container?.querySelector(".terminal-wrapper")?.getBoundingClientRect()
        .height || settings!.terminalHeight;
    const initialY = event.clientY;
    element.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) =>
      setTerminalHeight(height + initialY - e.clientY, container);
    const stop = () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", stop);
      element.removeEventListener("pointercancel", stop);
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", stop);
    element.addEventListener("pointercancel", stop);
  }

  if (!api)
    return (
      <div className="empty-state">
        <Leaf size={40} />
        <h1>Grove 是一个桌面工作区</h1>
        <p>请通过 Electron 启动应用，以访问本地文件和终端。</p>
        <code>npm run dev</code>
      </div>
    );
  if (!settings)
    return (
      <div className="empty-state">
        <Leaf size={40} />
        <h1>Grove</h1>
        <p>{notice?.text || "正在整理你的工作区…"}</p>
      </div>
    );
  const visibleProjects = settings.projects.filter((p) =>
    `${p.name} ${p.path}`.toLowerCase().includes(projectFilter.toLowerCase()),
  );
  return (
    <div className={`app theme-${settings.theme}`}>
      <header className="titlebar">
        <div className="traffic-space" />
        <div className="brand">
          <Leaf size={18} strokeWidth={1.7} /> grove{" "}
          <span>LOCAL WORKSPACE</span>
        </div>
        <button
          className="command-box"
          disabled={!project}
          onClick={() => setQuickOpen(true)}
        >
          <Search size={13} />
          <span>
            {project
              ? `${project.name} 中快速打开`
              : "你的下一个想法，从这里开始"}
          </span>
          <kbd>⌘ P</kbd>
        </button>
        <div className="titlebar-actions">
          <button
            className={`icon-button ${settings.collapsed[0] ? "muted" : ""}`}
            title="切换项目列表"
            onClick={() => togglePanel(0)}
          >
            <Files size={15} />
          </button>
          <button
            className="icon-button"
            title="切换文件侧栏"
            onClick={() => togglePanel(1)}
          >
            <PanelLeftClose size={15} />
          </button>
          <button
            className="icon-button"
            title="切换终端面板"
            onClick={() => togglePanel(2)}
          >
            <PanelBottomClose size={15} />
          </button>
        </div>
      </header>
      <main className="workspace">
        {!settings.collapsed[0] && (
          <>
            <aside
              className="projects-pane"
              style={{ width: settings.widths[0] }}
            >
              <div className="project-title">
                <span>项目</span>
                <span className="count">
                  {settings.projects.length.toString().padStart(2, "0")}
                </span>
                <button
                  title="添加本地项目"
                  className="icon-button"
                  onClick={() => run(addProject)}
                >
                  <Plus size={15} />
                </button>
              </div>
              <label className="project-filter">
                <Search size={13} />
                <input
                  aria-label="搜索项目"
                  placeholder="查找项目"
                  value={projectFilter}
                  onChange={(e) => setProjectFilter(e.target.value)}
                />
              </label>
              <div className="project-list">
                {visibleProjects.map((p, index) => (
                  <div
                    key={p.id}
                    className={`project-row ${p.id === projectId ? "active" : ""}`}
                  >
                    <button
                      className="project-select"
                      title={p.path}
                      onClick={() => switchProject(p.id)}
                    >
                      <span className={`project-avatar color-${index % 4}`}>
                        {p.name.slice(0, 1).toUpperCase()}
                      </span>
                      <span>
                        <strong>{p.name}</strong>
                        <small>{p.path.replace(/^\/Users\/[^/]+/, "~")}</small>
                      </span>
                      {sessions.some(
                        (s) => s.projectId === p.id && !s.exited,
                      ) && <span className="status-dot" />}
                    </button>
                    <button
                      className="project-more"
                      title={`${p.name} 项目设置`}
                      onClick={() =>
                        setProjectMenu(projectMenu === p.id ? null : p.id)
                      }
                    >
                      <MoreHorizontal size={15} />
                    </button>
                    {projectMenu === p.id && (
                      <div className="project-popover">
                        <button
                          onClick={() => run(() => projectAction(p, "rename"))}
                        >
                          修改显示名称
                        </button>
                        <button
                          onClick={() =>
                            run(() => projectAction(p, "relocate"))
                          }
                        >
                          重新定位目录
                        </button>
                        <button
                          onClick={() => run(() => projectAction(p, "up"))}
                        >
                          <ArrowUp size={13} /> 上移
                        </button>
                        <button
                          onClick={() => run(() => projectAction(p, "down"))}
                        >
                          <ArrowDown size={13} /> 下移
                        </button>
                        <button
                          className="danger-text"
                          onClick={() => run(() => projectAction(p, "remove"))}
                        >
                          从列表移除
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {!visibleProjects.length && (
                  <p className="panel-copy">
                    {projectFilter
                      ? "没有匹配的项目"
                      : "添加一个本地目录，开始工作。"}
                  </p>
                )}
                <button className="add-project" onClick={() => run(addProject)}>
                  <Plus size={14} /> 添加项目
                </button>
              </div>
              <div className="project-bottom">
                <div className="local-label">
                  <span className="status-dot" /> 本地工作区
                </div>
                <button
                  className="theme-switch"
                  title="切换主题"
                  aria-label="切换主题"
                  onClick={() =>
                    setSettings(
                      (s) =>
                        s && {
                          ...s,
                          theme: s.theme === "dark" ? "light" : "dark",
                        },
                    )
                  }
                >
                  {settings.theme === "dark" ? (
                    <Sun size={15} />
                  ) : (
                    <Moon size={15} />
                  )}
                  <span>
                    {settings.theme === "dark" ? "浅色外观" : "深色外观"}
                  </span>
                  <Settings2 size={13} />
                </button>
              </div>
            </aside>
            <div
              className="resize-handle"
              role="separator"
              aria-label="调整项目栏宽度"
              onPointerDown={(event) => resize(0, event)}
            />
          </>
        )}
        {!settings.collapsed[1] && (
          <>
            <aside
              className="explorer-pane"
              style={{ width: settings.widths[1] }}
            >
              <nav className="explorer-tabs" aria-label="侧栏视图">
                <button
                  className={panel === "files" ? "active" : ""}
                  title="文件"
                  onClick={() => setPanel("files")}
                >
                  <Files size={15} /> 文件
                </button>
                <button
                  className={panel === "search" ? "active" : ""}
                  title="项目搜索"
                  onClick={() => setPanel("search")}
                >
                  <Search size={15} />
                </button>
                <button
                  className={panel === "git" ? "active" : ""}
                  title="Git 变更"
                  aria-label="Git 变更"
                  onClick={() => setPanel("git")}
                >
                  <GitBranch size={15} />
                  {gitStatus?.changes.length ? (
                    <span className="count">{gitStatus.changes.length}</span>
                  ) : null}
                </button>
              </nav>
              {project ? (
                panel === "files" ? (
                  <FileTree
                    project={project}
                    revision={revision}
                    activePath={activeDoc?.path}
                    onOpen={treeOpen}
                    onCreate={treeCreate}
                    onAction={treeAction}
                    onError={onError}
                    onRelocate={treeRelocate}
                  />
                ) : panel === "search" ? (
                  <SearchPanel
                    key={project.id}
                    projectId={project.id}
                    onOpen={(file, line) => run(() => openFile(file, line))}
                  />
                ) : (
                  <GitPanel
                    status={gitStatus}
                    message={messages[project.id] || ""}
                    setMessage={(value) =>
                      setMessages((current) => ({
                        ...current,
                        [project.id]: value,
                      }))
                    }
                    onDiff={(change, staged) =>
                      run(() => showDiff(change, staged))
                    }
                    onStage={(change, stageValue) =>
                      run(() => stage(change, stageValue))
                    }
                    onCommit={() => run(commit)}
                    refresh={() => setGitRefresh((v) => v + 1)}
                    busy={gitBusy}
                  />
                )
              ) : (
                <div className="small-empty">
                  <FolderOpen size={26} />
                  <p>
                    选择一个项目
                    <br />
                    查看文件与更改
                  </p>
                </div>
              )}
            </aside>
            <div
              className="resize-handle"
              role="separator"
              aria-label="调整文件栏宽度"
              onPointerDown={(event) => resize(1, event)}
            />
          </>
        )}
        <div className="editor-stack">
          <section
            className="editor-pane"
            aria-label="编辑区"
            style={{
              display:
                settings.terminalMaximized && !settings.collapsed[2]
                  ? "none"
                  : undefined,
            }}
          >
            <div className="file-tabs">
              {projectDocs.map((doc) => (
                <div
                  key={doc.key}
                  className={`file-tab ${!activeDiff && doc.key === activeDoc?.key ? "active" : ""}`}
                >
                  <button
                    title={doc.path}
                    onClick={() => {
                      setActiveKeys((current) => ({
                        ...current,
                        [doc.projectId]: doc.key,
                      }));
                      setDiff(null);
                    }}
                  >
                    <FileCode2 size={13} />
                    <span>{basename(doc.path)}</span>
                    {doc.content !== doc.base && (
                      <span className="unsaved-dot" aria-label="未保存" />
                    )}
                  </button>
                  <button
                    title={`关闭 ${basename(doc.path)}`}
                    onClick={() => run(() => closeDoc(doc))}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
              {activeDiff && (
                <div className="file-tab active diff-tab">
                  <button>
                    <GitBranch size={13} /> {basename(activeDiff.path)} · Diff
                  </button>
                  <button title="关闭 Diff" onClick={() => setDiff(null)}>
                    <X size={12} />
                  </button>
                </div>
              )}
              {!projectDocs.length && !activeDiff && (
                <div className="welcome-tab">
                  <Leaf size={13} /> 欢迎使用 Grove
                </div>
              )}
            </div>
            {(activeDiff || activeDoc) && (
              <div className="breadcrumbs">
                <span className="truncate">
                  {project?.name} <ChevronDown size={10} />{" "}
                  {activeDiff?.path || activeDoc?.path}
                </span>
                <div className="actions">
                  {activeDiff || compareExternal ? (
                    <>
                      <span>
                        {compareExternal
                          ? "磁盘 ↔ 编辑器"
                          : activeDiff?.staged
                            ? "HEAD ↔ 暂存区"
                            : "暂存区 ↔ 工作区"}
                      </span>
                      <button
                        className="icon-button"
                        title="切换并排 / 行内 Diff"
                        onClick={() => setSideBySide((v) => !v)}
                      >
                        <ChevronsLeftRight size={14} />
                      </button>
                      {activeDiff && (
                        <button
                          className="text-button"
                          onClick={() => run(() => openFile(activeDiff.path))}
                        >
                          编辑文件
                        </button>
                      )}
                    </>
                  ) : (
                    <button
                      className="text-button"
                      disabled={
                        !activeDoc || activeDoc.content === activeDoc.base
                      }
                      onClick={() => run(() => saveDoc())}
                    >
                      保存 <kbd>⌘ S</kbd>
                    </button>
                  )}
                </div>
              </div>
            )}
            {!activeDiff && activeDoc?.external && (
              <div className="conflict-banner">
                <div>
                  <AlertTriangle size={14} />
                  <span>磁盘文件已被修改，当前编辑内容已保留。</span>
                </div>
                <div className="actions">
                  <button onClick={() => setCompareExternal((v) => !v)}>
                    {compareExternal ? "返回编辑" : "比较"}
                  </button>
                  <button onClick={() => run(() => resolveExternal(false))}>
                    使用磁盘版本
                  </button>
                  <button onClick={() => run(() => resolveExternal(true))}>
                    保留我的修改
                  </button>
                </div>
              </div>
            )}
            {!activeDiff && activeDoc?.missing && (
              <div className="conflict-banner">
                <AlertTriangle size={14} />{" "}
                文件已被移动、删除或无法读取。编辑内容仍保留，请复制后恢复文件。
              </div>
            )}
            <div className="editor-content">
              <Suspense
                fallback={<div className="center muted">正在加载编辑器…</div>}
              >
                {activeDiff ? (
                  <DiffView
                    diff={activeDiff.data}
                    path={activeDiff.path}
                    theme={settings.theme}
                    sideBySide={sideBySide}
                  />
                ) : activeDoc ? (
                  compareExternal && activeDoc.external ? (
                    <DiffView
                      diff={{
                        original: activeDoc.external.content,
                        modified: activeDoc.content,
                        binary: false,
                      }}
                      path={activeDoc.path}
                      theme={settings.theme}
                      sideBySide={sideBySide}
                    />
                  ) : (
                    <Editor
                      doc={activeDoc}
                      theme={settings.theme}
                      onSave={() => run(() => saveDoc())}
                      onChange={(content) =>
                        setDocs((current) =>
                          current.map((d) =>
                            d.key === activeDoc.key ? { ...d, content } : d,
                          ),
                        )
                      }
                      onPosition={(position) =>
                        setDocs((current) =>
                          current.map((d) =>
                            d.key === activeDoc.key ? { ...d, position } : d,
                          ),
                        )
                      }
                    />
                  )
                ) : (
                  <div className="welcome">
                    <div className="welcome-emblem">
                      <Leaf size={43} strokeWidth={1} />
                    </div>
                    <span className="eyebrow">A LITTLE SPACE TO BUILD</span>
                    <h1>让想法，生长为作品。</h1>
                    <p>
                      {project
                        ? `你已来到 ${project.name}。打开一个文件，或启动终端继续工作。`
                        : "所有项目，一个安静的工作区。\n从一个本地目录开始，让专注自然发生。"}
                    </p>
                    <button
                      className="primary-button"
                      onClick={() =>
                        project ? setQuickOpen(true) : run(addProject)
                      }
                    >
                      {project ? (
                        <FileCode2 size={15} />
                      ) : (
                        <FolderOpen size={15} />
                      )}
                      {project ? "打开项目文件" : "打开本地项目"}
                      <ArrowRight size={15} />
                    </button>
                    <div className="welcome-shortcuts">
                      <div>
                        <span>快速打开文件</span>
                        <kbd>⌘ P</kbd>
                      </div>
                      <div>
                        <span>搜索整个项目</span>
                        <kbd>⌘ ⇧ F</kbd>
                      </div>
                      <div>
                        <span>打开新终端</span>
                        <kbd>⌃ ⇧ `</kbd>
                      </div>
                    </div>
                    <div className="welcome-footer">
                      <span /> 本地优先 · 为专注而生 <span />
                    </div>
                  </div>
                )}
              </Suspense>
            </div>
          </section>
          {!settings.collapsed[2] && !settings.terminalMaximized && (
            <div
              className="terminal-resizer"
              role="separator"
              aria-label="调整终端高度"
              aria-orientation="horizontal"
              aria-valuemin={140}
              aria-valuenow={Math.round(settings.terminalHeight)}
              tabIndex={0}
              title="拖动调整终端高度，双击最大化"
              onPointerDown={resizeTerminal}
              onDoubleClick={() =>
                setSettings((s) => s && { ...s, terminalMaximized: true })
              }
              onKeyDown={(event) => {
                if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                  event.preventDefault();
                  setTerminalHeight(
                    settings.terminalHeight +
                      (event.key === "ArrowUp" ? 24 : -24),
                    event.currentTarget.parentElement,
                  );
                }
              }}
            />
          )}
          <div
            className={`terminal-wrapper ${settings.terminalMaximized ? "maximized" : ""}`}
            style={{
              height: settings.terminalMaximized
                ? undefined
                : settings.terminalHeight,
              display: settings.collapsed[2] ? "none" : "flex",
            }}
          >
            <TerminalPane
              sessions={sessions}
              projectId={projectId}
              hidden={settings.collapsed[2]}
              theme={settings.theme}
              maximized={settings.terminalMaximized}
              fontSize={settings.terminalFontSize}
              onToggleMaximize={() =>
                setSettings(
                  (s) => s && { ...s, terminalMaximized: !s.terminalMaximized },
                )
              }
              onFontSizeChange={(fontSize) =>
                setSettings(
                  (s) =>
                    s && {
                      ...s,
                      terminalFontSize: Math.max(9, Math.min(24, fontSize)),
                    },
                )
              }
              onHide={() => togglePanel(2)}
              onCreate={() => run(newTerminal)}
              onClose={(id) =>
                run(async () => {
                  if (await api.terminalClose(id))
                    setSessions((current) =>
                      current.filter((s) => s.id !== id),
                    );
                })
              }
              onError={onError}
            />
          </div>
        </div>
      </main>
      <footer className="statusbar">
        <div>
          <span className="status-brand">
            <Leaf size={12} />
          </span>
          <button
            onClick={() => {
              setPanel("git");
              setSettings(
                (s) =>
                  s && {
                    ...s,
                    collapsed: [s.collapsed[0], false, s.collapsed[2]],
                  },
              );
            }}
          >
            <GitBranch size={12} />
            {gitStatus?.repository ? gitStatus.branch : "本地项目"}
          </button>
          {gitStatus?.changes.length ? (
            <span>{gitStatus.changes.length} 项更改</span>
          ) : null}
        </div>
        <div>
          {activeDoc && (
            <>
              <span>
                行 {activeDoc.position?.lineNumber || 1}, 列{" "}
                {activeDoc.position?.column || 1}
              </span>
              <span>UTF-8</span>
              <span>{activeDoc.path.split(".").pop()?.toUpperCase()}</span>
            </>
          )}
          <span>
            <span className="status-dot" />{" "}
            {sessions.filter((s) => !s.exited).length} 个终端
          </span>
          <span>Grove 0.1</span>
        </div>
      </footer>
      {notice && (
        <div
          role={notice.error ? "alert" : "status"}
          className={`toast ${notice.error ? "error" : ""}`}
        >
          {notice.error ? <AlertTriangle size={17} /> : <Check size={17} />}
          <span>{notice.text}</span>
          <button
            className="icon-button"
            title="关闭通知"
            onClick={() => setNotice(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {quickOpen && project && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setQuickOpen(false);
          }}
        >
          <div
            className="quick-open"
            role="dialog"
            aria-modal="true"
            aria-label="快速打开"
          >
            <div className="dialog-heading">
              <span>快速打开文件</span>
              <button
                className="icon-button"
                title="关闭快速打开"
                onClick={() => setQuickOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <SearchPanel
              key={project.id}
              projectId={project.id}
              filenames
              onOpen={(file, line) => run(() => openFile(file, line))}
            />
          </div>
        </div>
      )}
      {dialog && (
        <Dialog
          key={`${dialog.title}:${dialog.value}`}
          request={dialog}
          dismiss={dismiss}
        />
      )}
    </div>
  );
}

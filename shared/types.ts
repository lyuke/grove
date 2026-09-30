export interface Project {
  id: string;
  name: string;
  path: string;
  remoteId?: string;
}
export interface RemoteConnection {
  id: string;
  name: string;
  host: string;
  user?: string;
  port?: number;
  identityFile?: string;
  nodePath?: string;
  configFile?: string;
  authentication?: "ssh" | "kerberos";
}
export interface KerberosStatus {
  valid: boolean;
  message: string;
}
export interface RemoteInfo {
  hostname: string;
  home: string;
  node: string;
  git: boolean;
  search: boolean;
}
export interface Workspace {
  tabs: string[];
  active?: string;
  positions?: Record<string, { lineNumber: number; column: number }>;
}
export interface Settings {
  palette?: Record<string, string>;
  agents?: AgentProfile[];
  tasksVisible?: boolean;
  taskSound?: boolean;
  taskNotifications?: boolean;
  projects: Project[];
  remotes?: RemoteConnection[];
  activeProject?: string;
  theme: "dark" | "light" | "nord" | "catppuccin";
  widths: number[];
  collapsed: boolean[];
  terminalDock: "bottom" | "right";
  terminalWidth: number;
  terminalShortcut: string;
  terminalHeight: number;
  terminalMaximized: boolean;
  terminalFontSize: number;
  workspaces: Record<string, Workspace>;
}
export interface FileEntry {
  name: string;
  path: string;
  directory: boolean;
  symlink: boolean;
}
export interface FileData {
  content: string;
  hash: string;
}
export interface Change {
  path: string;
  originalPath?: string;
  index: string;
  worktree: string;
  conflict: boolean;
}
export interface GitStatus {
  repository: boolean;
  branch: string;
  changes: Change[];
}
export interface GitCommitInfo {
  hash: string;
  author: string;
  date: string;
  message: string;
}
export interface GitCommitFile {
  path: string;
  originalPath?: string;
  status: string;
}
export interface GitDiff {
  original: string;
  modified: string;
  binary: boolean;
}
export interface SearchHit {
  path: string;
  line: number;
  text: string;
}
export interface TerminalSession {
  id: string;
  projectId: string;
  title: string;
  exited?: boolean;
}
export interface GroveAPI {
  tasks(): Promise<AgentTask[]>;
  createTask(input: {
    title: string;
    prompt: string;
    projectId: string;
    agentId: string;
  }): Promise<AgentTask>;
  onTaskChange(callback: (task: AgentTask) => void): () => void;
  settings(): Promise<Settings>;
  takeOpenFiles(): Promise<
    Array<
      | { project: Project; path?: string; error?: never }
      | { error: string; project?: never; path?: never }
    >
  >;
  onOpenFiles(callback: () => void): () => void;
  saveSettings(settings: Partial<Omit<Settings, "projects">>): Promise<void>;
  addProject(): Promise<Project | null>;
  saveRemote(connection: RemoteConnection): Promise<RemoteConnection>;
  removeRemote(id: string): Promise<void>;
  testRemote(id: string): Promise<RemoteInfo>;
  kerberosStatus(): Promise<KerberosStatus>;
  addRemoteProject(id: string, path: string): Promise<Project>;
  relocateRemoteProject(id: string, path: string): Promise<Project>;
  updateProject(id: string, name: string): Promise<Project>;
  relocateProject(id: string): Promise<Project | null>;
  removeProject(id: string): Promise<void>;
  reorderProjects(ids: string[]): Promise<void>;
  listFiles(id: string, path: string): Promise<FileEntry[]>;
  readFile(id: string, path: string): Promise<FileData>;
  writeFile(
    id: string,
    path: string,
    content: string,
    hash: string,
  ): Promise<FileData>;
  createFile(id: string, path: string, directory: boolean): Promise<void>;
  moveFile(id: string, from: string, to: string): Promise<void>;
  trashFile(id: string, path: string): Promise<boolean>;
  revealInFinder(id: string, path: string): Promise<void>;
  search(id: string, query: string, filenames: boolean): Promise<SearchHit[]>;
  gitHistory(id: string, skip: number): Promise<GitCommitInfo[]>;
  gitCommitDetail(id: string, hash: string): Promise<string>;
  gitCommitFiles(id: string, hash: string): Promise<GitCommitFile[]>;
  gitCommitDiff(id: string, hash: string, path: string): Promise<GitDiff>;
  gitStatus(id: string): Promise<GitStatus>;
  gitDiff(id: string, path: string, staged: boolean): Promise<GitDiff>;
  gitStage(id: string, path: string, stage: boolean): Promise<void>;
  gitDiscard(id: string, path: string): Promise<void>;
  gitCommit(id: string, message: string): Promise<string>;
  openExternal(url: string): Promise<void>;
  terminalCreate(id: string): Promise<TerminalSession>;
  terminalList(): Promise<TerminalSession[]>;
  terminalAttach(id: string): Promise<string>;
  terminalWrite(id: string, data: string): Promise<void>;
  terminalResize(id: string, cols: number, rows: number): Promise<void>;
  terminalClose(id: string): Promise<boolean>;
  setDirty(dirty: boolean): void;
  finishQuit(id: string, success: boolean): void;
  onPrepareQuit(
    callback: (request: {
      id: string;
      save: boolean;
      discard: boolean;
    }) => void,
  ): () => void;
  onFileChange(
    callback: (event: {
      projectId: string;
      path: string;
      type: string;
    }) => void,
  ): () => void;
  onTerminalData(
    callback: (event: { id: string; data: string }) => void,
  ): () => void;
  onTerminalExit(
    callback: (event: { id: string; exitCode: number }) => void,
  ): () => void;
  onMenu(callback: (action: string) => void): () => void;
}
export interface AgentProfile {
  id: string;
  name: string;
  executable: string;
  args: string[];
}
export interface AgentTask {
  id: string;
  title: string;
  prompt: string;
  projectId: string;
  projectName: string;
  target: string;
  remote: boolean;
  agentName: string;
  status: "running" | "succeeded" | "failed" | "interrupted";
  output: string;
  createdAt: string;
  finishedAt?: string;
  exitCode?: number;
}
declare global {
  interface Window {
    grove: GroveAPI;
  }
}

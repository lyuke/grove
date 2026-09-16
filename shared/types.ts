export interface Project {
  id: string;
  name: string;
  path: string;
}
export interface Workspace {
  tabs: string[];
  active?: string;
  positions?: Record<string, { lineNumber: number; column: number }>;
}
export interface Settings {
  projects: Project[];
  activeProject?: string;
  theme: "dark" | "light";
  widths: number[];
  collapsed: boolean[];
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
  settings(): Promise<Settings>;
  saveSettings(settings: Partial<Omit<Settings, "projects">>): Promise<void>;
  addProject(): Promise<Project | null>;
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
  search(id: string, query: string, filenames: boolean): Promise<SearchHit[]>;
  gitStatus(id: string): Promise<GitStatus>;
  gitDiff(id: string, path: string, staged: boolean): Promise<GitDiff>;
  gitStage(id: string, path: string, stage: boolean): Promise<void>;
  gitCommit(id: string, message: string): Promise<string>;
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
declare global {
  interface Window {
    grove: GroveAPI;
  }
}

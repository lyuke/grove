import { memo, useCallback, useEffect, useMemo, useState } from "react";
import VirtualList from "./VirtualList";
import {
  ChevronRight,
  ChevronDown,
  FileCode2,
  Folder,
  FolderOpen,
  Link2,
  FilePlus2,
  FolderPlus,
  MoreHorizontal,
  RefreshCw,
} from "lucide-react";
import type { FileEntry, Project } from "../../shared/types";
type Props = {
  project: Project;
  revision: number;
  activePath?: string;
  onOpen(path: string): void;
  onCreate(parent: string, directory: boolean): void;
  onAction(entry: FileEntry): void;
  onError(error: unknown): void;
  onRelocate(): void;
};
const TreeRow = memo(function TreeRow({
  entry,
  depth,
  selected,
  expanded,
  onToggle,
  onOpen,
  onAction,
}: {
  entry: FileEntry;
  depth: number;
  selected: boolean;
  expanded: boolean;
  onToggle(path: string): void;
  onOpen(path: string): void;
  onAction(entry: FileEntry): void;
}) {
  return (
    <div
      onContextMenu={(event) => {
        event.preventDefault();
        onAction(entry);
      }}
      className={`tree-row ${selected ? "selected" : ""}`}
      style={{ paddingLeft: 12 + depth * 14 }}
    >
      <button
        className="tree-item"
        title={entry.path}
        aria-expanded={entry.directory ? expanded : undefined}
        onClick={() =>
          entry.directory ? onToggle(entry.path) : onOpen(entry.path)
        }
      >
        {entry.directory ? (
          expanded ? (
            <ChevronDown size={12} />
          ) : (
            <ChevronRight size={12} />
          )
        ) : (
          <span className="tree-spacer" />
        )}
        {entry.directory ? (
          expanded ? (
            <FolderOpen size={15} className="folder-icon" />
          ) : (
            <Folder size={15} className="folder-icon" />
          )
        ) : entry.symlink ? (
          <Link2 size={14} />
        ) : (
          <FileCode2
            size={14}
            className={`file-icon ext-${entry.name.split(".").pop()}`}
          />
        )}
        <span>{entry.name}</span>
      </button>
      <button
        className="row-action"
        title={`${entry.name} 操作`}
        onClick={() => onAction(entry)}
      >
        <MoreHorizontal size={14} />
      </button>
    </div>
  );
});
type DirectoryState = {
  entries: FileEntry[];
  error?: string;
  revision: number;
};
type TreeItem = {
  key: string;
  depth: number;
  entry?: FileEntry;
  message?: string;
};
function TreeContents(props: Props) {
  const [directories, setDirectories] = useState(
    new Map<string, DirectoryState>(),
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = useCallback(
    (path: string) =>
      setExpanded((old) => {
        const next = new Set(old);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      }),
    [],
  );
  useEffect(() => {
    let alive = true;
    for (const parent of ["", ...expanded]) {
      if (directories.get(parent)?.revision === props.revision) continue;
      window.grove
        .listFiles(props.project.id, parent)
        .then((entries) => {
          if (alive)
            setDirectories((current) =>
              new Map(current).set(parent, {
                entries,
                revision: props.revision,
              }),
            );
        })
        .catch((error) => {
          if (alive)
            setDirectories((current) =>
              new Map(current).set(parent, {
                entries: [],
                error: String(error.message || error),
                revision: props.revision,
              }),
            );
        });
    }
    return () => {
      alive = false;
    };
  }, [props.project.id, props.revision, expanded]);
  const rows = useMemo(() => {
    const result: TreeItem[] = [];
    const visit = (parent: string, depth: number) => {
      const directory = directories.get(parent);
      if (!directory || directory.error || !directory.entries.length) {
        result.push({
          key: `placeholder:${parent}`,
          depth,
          message: !directory ? "加载中…" : directory.error || "空目录",
        });
        return;
      }
      for (const entry of directory.entries) {
        result.push({ key: `entry:${entry.path}`, depth, entry });
        if (entry.directory && expanded.has(entry.path))
          visit(entry.path, depth + 1);
      }
    };
    visit("", 0);
    return result;
  }, [directories, expanded]);
  if (directories.get("")?.error)
    return (
      <div className="tree-error">
        <p>无法读取目录</p>
        <small>{directories.get("")!.error}</small>
        <button className="secondary-button" onClick={props.onRelocate}>
          重新定位项目
        </button>
      </div>
    );
  return (
    <VirtualList
      className="tree-scroll"
      items={rows}
      rowHeight={28}
      itemKey={(row) => row.key}
      render={({ entry, depth, message }) =>
        entry ? (
          <TreeRow
            entry={entry}
            depth={depth}
            selected={props.activePath === entry.path}
            expanded={expanded.has(entry.path)}
            onToggle={toggle}
            onOpen={props.onOpen}
            onAction={props.onAction}
          />
        ) : (
          <div
            className="tree-placeholder truncate"
            title={message}
            style={{
              paddingLeft: 26 + depth * 14,
              height: 28,
              paddingTop: 6,
              paddingBottom: 6,
            }}
          >
            {message}
          </div>
        )
      }
    />
  );
}
function FileTree(props: Props) {
  const [extraRevision, refresh] = useState(0);
  return (
    <>
      <div className="panel-heading">
        <span className="truncate">{props.project.name}</span>
        <div className="actions">
          <button
            className="icon-button"
            title="新建文件"
            onClick={() => props.onCreate("", false)}
          >
            <FilePlus2 size={14} />
          </button>
          <button
            className="icon-button"
            title="新建文件夹"
            onClick={() => props.onCreate("", true)}
          >
            <FolderPlus size={14} />
          </button>
          <button
            className="icon-button"
            title="刷新文件树"
            onClick={() => refresh((v) => v + 1)}
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>
      <TreeContents
        key={`${props.project.id}:${props.project.path}`}
        {...props}
        revision={props.revision + extraRevision}
      />
    </>
  );
}

export default memo(FileTree);

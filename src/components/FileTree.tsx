import { useEffect, useState } from "react";
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
function Directory({
  parent,
  depth,
  props,
}: {
  parent: string;
  depth: number;
  props: Props;
}) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    window.grove
      .listFiles(props.project.id, parent)
      .then((files) => {
        if (alive) {
          setEntries(files);
          setError("");
        }
      })
      .catch((e) => {
        if (alive) setError(String(e.message || e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [props.project.id, props.project.path, props.revision, parent]);
  if (error)
    return (
      <div className="tree-error">
        <p>无法读取目录</p>
        <small>{error}</small>
        {!parent && (
          <button className="secondary-button" onClick={props.onRelocate}>
            重新定位项目
          </button>
        )}
      </div>
    );
  if (loading) return <div className="tree-placeholder">加载中…</div>;
  return (
    <>
      {entries.map((entry) => (
        <div key={entry.path}>
          <div
            className={`tree-row ${props.activePath === entry.path ? "selected" : ""}`}
            style={{ paddingLeft: 12 + depth * 14 }}
          >
            <button
              className="tree-item"
              title={entry.path}
              onClick={() =>
                entry.directory
                  ? setExpanded((old) => {
                      const next = new Set(old);
                      if (next.has(entry.path)) next.delete(entry.path);
                      else next.add(entry.path);
                      return next;
                    })
                  : props.onOpen(entry.path)
              }
            >
              {entry.directory ? (
                expanded.has(entry.path) ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )
              ) : (
                <span className="tree-spacer" />
              )}
              {entry.directory ? (
                expanded.has(entry.path) ? (
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
              onClick={() => props.onAction(entry)}
            >
              <MoreHorizontal size={14} />
            </button>
          </div>
          {entry.directory && expanded.has(entry.path) && (
            <Directory parent={entry.path} depth={depth + 1} props={props} />
          )}
        </div>
      ))}
      {!entries.length && (
        <div
          className="tree-placeholder"
          style={{ paddingLeft: 26 + depth * 14 }}
        >
          空目录
        </div>
      )}
    </>
  );
}
export default function FileTree(props: Props) {
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
      <div className="tree-scroll">
        <Directory
          key={props.project.id}
          parent=""
          depth={0}
          props={{ ...props, revision: props.revision + extraRevision }}
        />
      </div>
    </>
  );
}

import { useEffect, useRef, useState } from "react";
import type { GitCommitFile, GitCommitInfo } from "../../shared/types";

export default function GitHistory({
  projectId,
  revision,
  onDiff,
}: {
  projectId: string;
  revision: number;
  onDiff(hash: string, file: string): void;
}) {
  const [commits, setCommits] = useState<GitCommitInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");
  const [files, setFiles] = useState<GitCommitFile[]>([]);
  const [activeFile, setActiveFile] = useState("");
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState("");
  const generation = useRef(0);
  const selection = useRef(0);
  async function load(skip: number, token = generation.current) {
    setBusy(true);
    setError("");
    try {
      const items = await window.grove.gitHistory(projectId, skip);
      if (token !== generation.current) return;
      setCommits((old) => (skip ? [...old, ...items] : items));
      setMore(items.length === 50);
    } catch (e) {
      if (token === generation.current) setError(String(e));
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    const token = ++generation.current;
    setCommits([]);
    setSelected("");
    setFiles([]);
    selection.current++;
    void load(0, token);
    return () => {
      generation.current++;
      selection.current++;
    };
  }, [projectId, revision]);
  function open(hash: string, file: string) {
    setActiveFile(file);
    onDiff(hash, file);
  }
  async function select(hash: string) {
    const token = ++selection.current;
    setSelected(hash);
    setFiles([]);
    setActiveFile("");
    setDetailBusy(true);
    setDetailError("");
    try {
      const result = await window.grove.gitCommitFiles(projectId, hash);
      if (token !== selection.current) return;
      setFiles(result);
      if (result.length) open(hash, result[0].path);
    } catch (e) {
      if (token === selection.current) setDetailError(String(e));
    } finally {
      if (token === selection.current) setDetailBusy(false);
    }
  }
  return (
    <div className="git-scroll history-list">
      <p className="panel-copy">选择提交，在编辑区查看代码 Diff</p>
      {commits.map((commit) => (
        <div key={commit.hash}>
          <button
            className="history-commit"
            aria-pressed={selected === commit.hash}
            onClick={() => void select(commit.hash)}
          >
            <strong>{commit.message.split("\n")[0]}</strong>
            <span>
              {commit.author} · {new Date(commit.date).toLocaleDateString()}
            </span>
            <code>{commit.hash.slice(0, 8)}</code>
          </button>
          {selected === commit.hash && (
            <section className="commit-detail" aria-label="提交文件变更">
              {commit.message.includes("\n") && (
                <p className="panel-copy">{commit.message}</p>
              )}
              <p className="panel-copy">相对父提交 · {files.length} 个文件</p>
              {detailBusy && <p role="status">正在读取文件列表…</p>}
              {detailError && <p role="alert">{detailError}</p>}
              {!detailBusy && !detailError && !files.length && (
                <p>此提交没有文件变更</p>
              )}
              {files.map((file) => (
                <button
                  className="history-file git-file"
                  key={file.path}
                  title={
                    file.originalPath
                      ? `${file.originalPath} → ${file.path}`
                      : file.path
                  }
                  aria-pressed={activeFile === file.path}
                  onClick={() => open(commit.hash, file.path)}
                >
                  <span className={`change-code code-${file.status[0]}`}>
                    {file.status[0]}
                  </span>
                  <span>
                    {file.path}
                    <small>
                      {file.originalPath
                        ? `原路径：${file.originalPath}`
                        : "查看代码 Diff"}
                    </small>
                  </span>
                </button>
              ))}
            </section>
          )}
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
      {!busy && !error && !commits.length && (
        <p className="panel-copy">还没有提交记录</p>
      )}
      {(more || error) && (
        <button
          className="secondary-button full"
          disabled={busy}
          onClick={() => void load(commits.length)}
        >
          {busy ? "正在加载…" : error ? "重试" : "加载更多"}
        </button>
      )}
    </div>
  );
}

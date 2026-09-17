import { useEffect, useRef, useState } from "react";
import type { GitCommitInfo } from "../../shared/types";
export default function GitHistory({
  projectId,
  revision,
}: {
  projectId: string;
  revision: number;
}) {
  const [commits, setCommits] = useState<GitCommitInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState("");
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
    setDetail("");
    selection.current++;
    void load(0, token);
    return () => {
      generation.current++;
      selection.current++;
    };
  }, [projectId, revision]);
  async function select(hash: string) {
    const token = ++selection.current;
    setDetail("正在读取提交…");
    try {
      const result = await window.grove.gitCommitDetail(projectId, hash);
      if (token === selection.current) setDetail(result);
    } catch (e) {
      if (token === selection.current) setDetail(String(e));
    }
  }
  return (
    <div className="git-scroll history-list">
      <p className="panel-copy">当前分支 · 当前项目目录</p>
      {commits.map((commit) => (
        <button
          className="history-commit"
          key={commit.hash}
          onClick={() => void select(commit.hash)}
        >
          <strong>{commit.message.split("\n")[0]}</strong>
          <span>
            {commit.author} · {new Date(commit.date).toLocaleDateString()}
          </span>
          <code>{commit.hash.slice(0, 8)}</code>
        </button>
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
      {detail && (
        <section className="commit-detail">
          <button
            className="secondary-button"
            onClick={() => {
              selection.current++;
              setDetail("");
            }}
          >
            关闭详情
          </button>
          <pre>{detail}</pre>
        </section>
      )}
    </div>
  );
}

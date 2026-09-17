import { memo, lazy, Suspense } from "react";
import { useState } from "react";
import {
  GitBranch,
  Check,
  Plus,
  Minus,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import type { Change, GitStatus } from "../../shared/types";
const GitHistory = lazy(() => import("./GitHistory"));
function GitPanel({
  projectId,
  revision,
  status,
  message,
  setMessage,
  onDiff,
  onStage,
  onCommit,
  refresh,
  busy,
}: {
  projectId: string;
  revision: number;
  status: GitStatus | null;
  message: string;
  setMessage(v: string): void;
  onDiff(change: Change, staged: boolean): void;
  onStage(change: Change, stage: boolean): void;
  onCommit(): void;
  refresh(): void;
  busy: boolean;
}) {
  const [history, setHistory] = useState(false);
  const [stagedOpen, setStagedOpen] = useState(true);
  if (!status) return <p className="panel-copy">正在读取 Git 状态…</p>;
  if (!status.repository)
    return (
      <div className="small-empty">
        <GitBranch size={28} />
        <h3>此目录未启用 Git</h3>
        <p>
          可以在终端中运行 git init，
          <br />
          然后刷新此面板。
        </p>
        <button className="secondary-button" onClick={refresh}>
          刷新
        </button>
      </div>
    );
  const staged = status.changes.filter(
    (c) => c.index !== " " && c.index !== "?" && !c.conflict,
  );
  const unstaged = status.changes.filter(
    (c) => c.worktree !== " " || c.conflict,
  );
  const rows = (changes: Change[], staged: boolean) =>
    changes.map((change) => (
      <div className="git-row" key={change.path}>
        <button
          className="git-file"
          title={change.path}
          onClick={() => onDiff(change, staged)}
        >
          {change.conflict ? (
            <AlertTriangle size={13} />
          ) : (
            <span
              className={`change-code code-${staged ? change.index : change.worktree}`}
            >
              {staged
                ? change.index
                : change.worktree === "?"
                  ? "U"
                  : change.worktree}
            </span>
          )}
          <span>
            {change.path.split("/").pop()}
            <small>
              {change.path.includes("/")
                ? change.path.slice(0, change.path.lastIndexOf("/"))
                : ""}
            </small>
          </span>
        </button>
        <button
          className="icon-button"
          disabled={busy}
          title={`${staged ? "取消暂存" : "暂存"} ${change.path}`}
          onClick={() => onStage(change, !staged)}
        >
          {staged ? <Minus size={14} /> : <Plus size={14} />}
        </button>
      </div>
    ));
  return (
    <>
      <div className="panel-heading">
        <span>
          <GitBranch size={13} /> {status.branch}
        </span>
        <button className="icon-button" title="刷新 Git" onClick={refresh}>
          <RefreshCw size={13} />
        </button>
      </div>
      <div className="history-tabs">
        <button aria-pressed={!history} onClick={() => setHistory(false)}>
          更改
        </button>
        <button aria-pressed={history} onClick={() => setHistory(true)}>
          历史提交
        </button>
      </div>
      {history ? (
        <Suspense fallback={<p>正在加载…</p>}>
          <GitHistory projectId={projectId} revision={revision} />
        </Suspense>
      ) : (
        <>
          <div className="commit-form">
            <textarea
              aria-label="提交信息"
              placeholder="这次改变了什么？"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
            />
            <button
              className="primary-button full"
              disabled={
                busy ||
                !message.trim() ||
                !staged.length ||
                status.changes.some((c) => c.conflict)
              }
              onClick={onCommit}
            >
              <Check size={14} />
              {busy
                ? "处理中…"
                : `提交暂存内容${staged.length ? ` · ${staged.length}` : ""}`}
            </button>
          </div>
          <div className="git-scroll">
            <button
              className="section-label full"
              onClick={() => setStagedOpen((v) => !v)}
            >
              暂存的更改 <span>{staged.length}</span>
            </button>
            {stagedOpen && rows(staged, true)}
            <div className="section-label">
              工作区更改 <span>{unstaged.length}</span>
            </div>
            {rows(unstaged, false)}
            {!status.changes.length && (
              <div className="git-clean">
                <Check size={24} />
                <p>工作区干净</p>
                <small>每一次改变，都从这里开始。</small>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

export default memo(GitPanel);

import { lazy, Suspense, useState } from "react";
import {
  Plus,
  Minus,
  X,
  TerminalSquare,
  Maximize2,
  Minimize2,
  ChevronDown,
} from "lucide-react";
import type { TerminalSession } from "../../shared/types";

const TerminalSurface = lazy(() => import("./TerminalSurface"));
export default function TerminalPane({
  sessions,
  projectId,
  theme,
  hidden,
  maximized,
  fontSize,
  onToggleMaximize,
  onFontSizeChange,
  onHide,
  onCreate,
  onClose,
  onError,
}: {
  sessions: TerminalSession[];
  projectId?: string;
  theme: string;
  hidden: boolean;
  maximized: boolean;
  fontSize: number;
  onToggleMaximize(): void;
  onFontSizeChange(size: number): void;
  onHide(): void;
  onCreate(): void;
  onClose(id: string): void;
  onError(error: unknown): void;
}) {
  const [selected, setSelected] = useState<Record<string, string>>({});
  const local = sessions.filter((s) => s.projectId === projectId);
  const active =
    local.find((s) => s.id === selected[projectId || ""])?.id ||
    local.at(-1)?.id;
  return (
    <section
      className="terminal-pane"
      style={{ display: hidden ? "none" : undefined }}
      aria-label="终端面板"
    >
      <div className="panel-heading">
        <span>
          <TerminalSquare size={14} /> 终端
        </span>
        <div className="actions terminal-actions">
          <button
            className="icon-button"
            title="缩小终端字体"
            disabled={fontSize <= 9}
            onClick={() => onFontSizeChange(fontSize - 1)}
          >
            <Minus size={14} />
          </button>
          <button
            className="terminal-font-size"
            title="重置终端字体"
            onClick={() => onFontSizeChange(12)}
          >
            {fontSize}
          </button>
          <button
            className="icon-button"
            title="放大终端字体"
            disabled={fontSize >= 24}
            onClick={() => onFontSizeChange(fontSize + 1)}
          >
            <Plus size={14} />
          </button>
          <span className="toolbar-divider" />
          <button
            className="icon-button"
            title="新建终端"
            disabled={!projectId}
            onClick={onCreate}
          >
            <Plus size={15} />
          </button>
          <button
            className="icon-button"
            title={maximized ? "还原终端" : "最大化终端"}
            onClick={onToggleMaximize}
          >
            {maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button className="icon-button" title="收起终端" onClick={onHide}>
            <ChevronDown size={15} />
          </button>
        </div>
      </div>
      <div className="terminal-tabs">
        {local.map((session) => (
          <div
            key={session.id}
            className={`terminal-tab ${active === session.id ? "active" : ""}`}
          >
            <button
              onClick={() =>
                setSelected((s) => ({ ...s, [projectId!]: session.id }))
              }
            >
              <span
                className={`status-dot ${session.exited ? "exited" : ""}`}
              />
              {session.title}
            </button>
            <button
              title={`关闭 ${session.title}`}
              onClick={() => onClose(session.id)}
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
      <div className="terminal-content">
        <Suspense fallback={<div className="muted center">正在打开终端…</div>}>
          {sessions.map((session) => (
            <TerminalSurface
              key={session.id}
              session={session}
              theme={theme}
              fontSize={fontSize}
              visible={!hidden && active === session.id}
              onError={onError}
            />
          ))}
        </Suspense>
        {!local.length && (
          <div className="terminal-empty">
            <TerminalSquare size={30} strokeWidth={1} />
            <h3>让想法开始运行</h3>
            <p>
              在项目目录中打开 Shell，
              <br />
              运行命令或你熟悉的 Agent CLI。
            </p>
            <button
              className="secondary-button"
              onClick={onCreate}
              disabled={!projectId}
            >
              <Plus size={14} /> 新建终端
            </button>
            <code>codex · claude · your CLI</code>
          </div>
        )}
      </div>
      <div className="terminal-footer">
        <span className="status-dot" /> 本地 Shell <span>⌃ ⇧ ` 新建</span>
      </div>
    </section>
  );
}

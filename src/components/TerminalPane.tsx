import { lazy, Suspense, useState } from "react";
import {
  Plus,
  Minus,
  X,
  TerminalSquare,
  Maximize2,
  Minimize2,
  ChevronDown,
  ArrowDownToLine,
  Keyboard,
  PanelRight,
  PanelBottom,
  GripVertical,
} from "lucide-react";
import { displayShortcut } from "../../shared/shortcuts";
import type { TerminalSession } from "../../shared/types";

const TerminalSurface = lazy(() => import("./TerminalSurface"));
export default function TerminalPane({
  sessions,
  projectId,
  theme,
  hidden,
  maximized,
  fontSize,
  dock,
  shortcut,
  focusRequest,
  onDock,
  onDragDock,
  onShortcut,
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
  dock: "bottom" | "right";
  shortcut: string;
  focusRequest: number;
  onDock(dock: "bottom" | "right"): void;
  onDragDock(dragging: boolean): void;
  onShortcut(): void;
  onToggleMaximize(): void;
  onFontSizeChange(size: number): void;
  onHide(): void;
  onCreate(): void;
  onClose(id: string): void;
  onError(error: unknown): void;
}) {
  const [scrollRequest, setScrollRequest] = useState(0);
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
        <span
          className="terminal-drag-handle"
          draggable
          title="拖动终端到右侧或下方"
          onDragStart={(event) => {
            event.dataTransfer.setData("application/x-grove-terminal", "dock");
            event.dataTransfer.effectAllowed = "move";
            onDragDock(true);
          }}
          onDragEnd={() => onDragDock(false)}
        >
          <GripVertical size={14} /> 终端
        </span>
        <div className="actions terminal-actions">
          <button
            className="icon-button"
            title="滚动到底部"
            onClick={() => setScrollRequest((v) => v + 1)}
          >
            <ArrowDownToLine size={14} />
          </button>
          <button
            className="icon-button"
            title="设置终端快捷键"
            onClick={onShortcut}
          >
            <Keyboard size={14} />
          </button>
          <button
            className="icon-button"
            title={dock === "bottom" ? "停靠到右侧" : "停靠到底部"}
            onClick={() => onDock(dock === "bottom" ? "right" : "bottom")}
          >
            {dock === "bottom" ? (
              <PanelRight size={14} />
            ) : (
              <PanelBottom size={14} />
            )}
          </button>
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
              focusRequest={focusRequest}
              scrollRequest={scrollRequest}
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
        <span className="status-dot" /> ⌘ 点击链接
        <button
          className="terminal-shortcut"
          title="设置终端快捷键"
          onClick={onShortcut}
        >
          {displayShortcut(shortcut)} 打开
        </button>
      </div>
    </section>
  );
}

import { useEffect, useRef, useState } from "react";
import { Terminal as XTerminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
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
import "@xterm/xterm/css/xterm.css";

function TerminalSurface({
  session,
  visible,
  theme,
  fontSize,
  onError,
}: {
  session: TerminalSession;
  visible: boolean;
  theme: string;
  fontSize: number;
  onError(error: unknown): void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<XTerminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const errorRef = useRef(onError);
  errorRef.current = onError;
  useEffect(() => {
    const term = new XTerminal({
      fontFamily: '"SF Mono", Menlo, monospace',
      fontSize,
      lineHeight: 1.45,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: false,
    });
    const addon = new FitAddon();
    term.loadAddon(addon);
    terminal.current = term;
    fit.current = addon;
    term.open(host.current!);
    // Attach buffers while collecting live output; main-process ordering prevents gaps.
    let attached = false;
    let disposed = false;
    let pending: string[] = [];
    const offData = window.grove.onTerminalData((event) => {
      if (event.id === session.id) {
        if (attached) term.write(event.data);
        else pending.push(event.data);
      }
    });
    window.grove
      .terminalAttach(session.id)
      .then((buffer) => {
        if (disposed) return;
        term.write(buffer);
        attached = true;
        pending = []; // Buffer snapshot contains data emitted before the IPC reply.
      })
      .catch((error) => errorRef.current(error));
    const offExit = window.grove.onTerminalExit((event) => {
      if (event.id === session.id)
        term.write(`\r\n\x1b[90m[进程已退出 · ${event.exitCode}]\x1b[0m\r\n`);
    });
    const input = term.onData((data) => {
      void window.grove.terminalWrite(session.id, data).catch(errorRef.current);
    });
    const resize = term.onResize(({ cols, rows }) => {
      void window.grove
        .terminalResize(session.id, cols, rows)
        .catch(errorRef.current);
    });
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (host.current?.clientWidth && host.current?.clientHeight)
          addon.fit();
      });
    });
    observer.observe(host.current!);
    return () => {
      disposed = true;
      offData();
      offExit();
      input.dispose();
      resize.dispose();
      observer.disconnect();
      cancelAnimationFrame(frame);
      term.dispose();
      pending = [];
    };
  }, [session.id]);
  useEffect(() => {
    if (terminal.current)
      terminal.current.options.theme =
        theme === "dark"
          ? {
              background: "#131D18",
              foreground: "#CAD8CF",
              cursor: "#BBDD9D",
              selectionBackground: "#385344",
              black: "#1D2922",
              red: "#E48E8E",
              green: "#A9C98B",
              yellow: "#DCC493",
              blue: "#8DADC5",
              magenta: "#B9A3CD",
              cyan: "#8DC7BD",
              white: "#D7E2DA",
            }
          : {
              background: "#F0F4ED",
              foreground: "#2B3D30",
              cursor: "#4F713A",
              selectionBackground: "#C8DABC",
            };
  }, [theme]);
  useEffect(() => {
    if (terminal.current) terminal.current.options.fontSize = fontSize;
    if (visible && host.current?.clientWidth && host.current?.clientHeight)
      fit.current?.fit();
  }, [fontSize, visible]);
  useEffect(() => {
    if (visible) {
      requestAnimationFrame(() => {
        fit.current?.fit();
        terminal.current?.focus();
      });
    }
  }, [visible]);
  return (
    <div
      ref={host}
      className="terminal-surface"
      style={{ display: visible ? "block" : "none" }}
      data-testid={`terminal-${session.id}`}
    />
  );
}
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

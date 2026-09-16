import { useEffect, useRef } from "react";
import { Terminal as XTerminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { TerminalSession } from "../../shared/types";
import "@xterm/xterm/css/xterm.css";

export default function TerminalSurface({
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

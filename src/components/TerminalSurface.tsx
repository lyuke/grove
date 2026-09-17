import { useCallback, useEffect, useRef } from "react";
import { Terminal as XTerminal } from "@xterm/xterm";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { FitAddon } from "@xterm/addon-fit";
import type { TerminalSession } from "../../shared/types";
import "@xterm/xterm/css/xterm.css";

export default function TerminalSurface({
  session,
  visible,
  theme,
  fontSize,
  focusRequest,
  scrollRequest,
  onError,
}: {
  session: TerminalSession;
  visible: boolean;
  theme: string;
  fontSize: number;
  focusRequest: number;
  scrollRequest: number;
  onError(error: unknown): void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<XTerminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const pinnedToBottom = useRef(true);
  const fitting = useRef(false);
  const fittedSize = useRef({ width: 0, height: 0 });
  const settleFrame = useRef(0);
  const userScrollUntil = useRef(0);
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const fitPreservingScroll = useCallback(() => {
    const term = terminal.current;
    if (!term || !host.current?.clientWidth || !host.current?.clientHeight)
      return;
    // Browser scroll clamping can happen before ResizeObserver runs. Keep the
    // user's scroll intent independently of that transient viewport position.
    fitting.current = true;
    userScrollUntil.current = 0;
    fit.current?.fit();
    cancelAnimationFrame(settleFrame.current);
    settleFrame.current = requestAnimationFrame(() => {
      if (pinnedToBottom.current) term.scrollToBottom();
      fittedSize.current = {
        width: host.current?.clientWidth || 0,
        height: host.current?.clientHeight || 0,
      };
      fitting.current = false;
    });
  }, []);
  useEffect(() => {
    const activateLink = (event: MouseEvent, url: string) => {
      event.preventDefault();
      if (event.metaKey)
        void window.grove.openExternal(url).catch(errorRef.current);
    };
    const term = new XTerminal({
      fontFamily: '"SF Mono", Menlo, monospace',
      fontSize,
      lineHeight: 1.45,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: false,
      scrollOnUserInput: true,
      linkHandler: { activate: activateLink },
    });
    const addon = new FitAddon();
    term.loadAddon(addon);
    term.loadAddon(new WebLinksAddon(activateLink));
    terminal.current = term;
    fit.current = addon;
    term.open(host.current!);
    pinnedToBottom.current = true;
    const viewport =
      term.element!.querySelector<HTMLElement>(".xterm-viewport")!;
    const markUserScroll = () => {
      userScrollUntil.current = performance.now() + 250;
    };
    const startPointerScroll = () => {
      userScrollUntil.current = Infinity;
    };
    const endPointerScroll = () => {
      if (userScrollUntil.current === Infinity) markUserScroll();
    };
    const surface = host.current!;
    surface.addEventListener("wheel", markUserScroll, {
      capture: true,
      passive: true,
    });
    surface.addEventListener("touchmove", markUserScroll, {
      capture: true,
      passive: true,
    });
    surface.addEventListener("pointerdown", startPointerScroll, true);
    window.addEventListener("pointerup", endPointerScroll);
    window.addEventListener("pointercancel", endPointerScroll);
    const trackScroll = () => {
      if (
        performance.now() <= userScrollUntil.current &&
        !fitting.current &&
        host.current?.clientWidth === fittedSize.current.width &&
        host.current?.clientHeight === fittedSize.current.height
      ) {
        // xterm 5.5 can leave its next-scroll suppression set when a fractional
        // row offset is clamped by Chromium. Reconcile genuine DOM scrolls via
        // the public API so the scrollbar and rendered buffer cannot diverge.
        const screen =
          term.element!.querySelector<HTMLElement>(".xterm-screen")!;
        const rowHeight = screen.getBoundingClientRect().height / term.rows;
        if (rowHeight > 0) {
          const target = Math.min(
            term.buffer.active.baseY,
            Math.round(viewport.scrollTop / rowHeight),
          );
          if (target !== term.buffer.active.viewportY)
            term.scrollToLine(target);
          pinnedToBottom.current = target >= term.buffer.active.baseY;
        }
      }
    };
    viewport.addEventListener("scroll", trackScroll);
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
      pinnedToBottom.current = true;
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
        fitPreservingScroll();
      });
    });
    observer.observe(host.current!);
    return () => {
      disposed = true;
      offData();
      offExit();
      input.dispose();
      resize.dispose();
      viewport.removeEventListener("scroll", trackScroll);
      surface.removeEventListener("wheel", markUserScroll, true);
      surface.removeEventListener("touchmove", markUserScroll, true);
      surface.removeEventListener("pointerdown", startPointerScroll, true);
      window.removeEventListener("pointerup", endPointerScroll);
      window.removeEventListener("pointercancel", endPointerScroll);
      observer.disconnect();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(settleFrame.current);
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
    const term = terminal.current;
    if (!term) return;
    fitting.current = true;
    term.options.fontSize = fontSize;
    if (visible) fitPreservingScroll();
  }, [fontSize, visible]);
  useEffect(() => {
    if (visible) {
      const frame = requestAnimationFrame(() => {
        fitPreservingScroll();
        terminal.current?.focus();
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [visible, focusRequest, fitPreservingScroll]);
  useEffect(() => {
    if (visible && scrollRequest) {
      pinnedToBottom.current = true;
      fitPreservingScroll();
    }
  }, [scrollRequest, fitPreservingScroll]);
  return (
    <div
      ref={host}
      className="terminal-surface"
      style={{ display: visible ? "block" : "none" }}
      data-testid={`terminal-${session.id}`}
    />
  );
}

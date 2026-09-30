import { randomUUID } from "node:crypto";
import type { IPty } from "node-pty";
import type { Project, RemoteConnection } from "../shared/types";
import { shellQuote, sshArgs } from "./remote";

export interface TaskTerminal {
  id: string;
  ready: Promise<void>;
  run(command: string): void;
  close(): void;
}
export interface TaskTerminalEvents {
  output(data: string): void;
  complete(code: number): void;
  exit(code: number): void;
}
export class PromptDecoder {
  private pending = "";
  constructor(
    private marker: string,
    private output: (data: string) => void,
    private prompt: (code: number) => void,
  ) {}
  write(data: string) {
    this.pending += data;
    while (this.pending) {
      const start = this.pending.indexOf(this.marker);
      if (start < 0) {
        let retained = Math.min(this.pending.length, this.marker.length - 1);
        while (
          retained &&
          !this.marker.startsWith(this.pending.slice(-retained))
        )
          retained--;
        const text = this.pending.slice(0, this.pending.length - retained);
        this.pending = this.pending.slice(this.pending.length - retained);
        if (text) this.output(text);
        return;
      }
      if (start) this.output(this.pending.slice(0, start));
      this.pending = this.pending.slice(start);
      const end = this.pending.indexOf("\x07", this.marker.length);
      if (end < 0) return;
      const code = this.pending.slice(this.marker.length, end);
      this.pending = this.pending.slice(end + 1);
      if (/^\d{1,3}$/.test(code)) this.prompt(Number(code));
    }
  }
  flush() {
    if (this.pending) this.output(this.pending);
    this.pending = "";
  }
}
export function commandInput(command: string) {
  const delimiter = `GROVE_${randomUUID().replaceAll("-", "")}`;
  const encoded = Buffer.from(command)
    .toString("base64")
    .match(/.{1,768}/g)!
    .join("\n");
  return `/bin/bash -c "$(base64 -d <<'${delimiter}'\n${encoded}\n${delimiter}\n)"\n`;
}
export async function openTaskTerminal(
  project: Project,
  remote: RemoteConnection | undefined,
  events: TaskTerminalEvents,
): Promise<TaskTerminal & { process: IPty; input(): void }> {
  const token = randomUUID();
  const marker = `\x1b]777;grove-${token};`;
  const promptCommand = `printf '\\033]777;grove-${token};%s\\007' "$?"`;
  const continuationPrompt = `\x1b]779;grove-${token};0\x07`;
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  const { spawn } = await import("node-pty");
  if (project.remoteId && (!remote || project.remoteId !== remote.id))
    throw new Error("远端连接配置不存在");
  const script = `cd ${shellQuote(project.path)} && exec env BASH_SILENCE_DEPRECATION_WARNING=1 HISTFILE=/dev/null PROMPT_COMMAND=${shellQuote(promptCommand)} PS1=${shellQuote("\\W $ ")} PS2=${shellQuote(continuationPrompt)} /bin/bash --noprofile --norc -i`;
  const child = spawn(
    remote ? "/usr/bin/ssh" : "/bin/bash",
    remote
      ? [...sshArgs(remote, true), `sh -lc ${shellQuote(script)}`]
      : ["--noprofile", "--norc", "-i"],
    {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: remote ? undefined : project.path,
      env: {
        ...env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        PROMPT_COMMAND: promptCommand,
        PS1: "\\W $ ",
        PS2: continuationPrompt,
        HISTFILE: "/dev/null",
        BASH_SILENCE_DEPRECATION_WARNING: "1",
      },
    },
  );
  let idle = false;
  let running = false;
  let sending = false;
  let pendingInput: string[] = [];
  const sendNext = () => {
    const line = pendingInput.shift();
    if (line !== undefined) child.write(line + "\n");
  };
  let exited = false;
  let resolveReady: () => void;
  let rejectReady: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const timeout = setTimeout(() => {
    rejectReady(new Error("任务终端启动超时"));
    child.kill();
  }, 30000);
  const decoder = new PromptDecoder(
    marker,
    (data) => {
      if (!sending) events.output(data);
    },
    (code) => {
      sending = false;
      pendingInput = [];
      idle = true;
      clearTimeout(timeout);
      resolveReady();
      if (running) {
        running = false;
        events.complete(code);
      }
    },
  );
  const started = new PromptDecoder(
    `\x1b]778;grove-${token};`,
    (data) => decoder.write(data),
    () => {
      sending = false;
    },
  );
  const continuation = new PromptDecoder(
    `\x1b]779;grove-${token};`,
    (data) => started.write(data),
    () => {
      if (sending) sendNext();
      else events.output("> ");
    },
  );
  child.onData((data) => continuation.write(data));
  child.onExit(({ exitCode }) => {
    exited = true;
    clearTimeout(timeout);
    continuation.flush();
    started.flush();
    decoder.flush();
    rejectReady(new Error(`任务终端已退出（${exitCode}）`));
    events.exit(exitCode);
  });
  return {
    id: randomUUID(),
    process: child,
    ready,
    input() {
      idle = false;
    },
    run(command) {
      if (exited) throw new Error("任务终端已关闭，请新建任务");
      if (!idle || running)
        throw new Error("终端正在执行命令或有未提交输入，请先在终端完成操作");
      idle = false;
      running = true;
      sending = true;
      events.output("\r\n");
      pendingInput = commandInput(
        `printf '\\033]778;grove-${token};0\\007'; ${command}`,
      )
        .trimEnd()
        .split("\n");
      sendNext();
    },
    close() {
      child.kill();
    },
  };
}

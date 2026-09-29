import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline";
import type { KerberosStatus, RemoteConnection } from "../shared/types";
declare const __REMOTE_AGENT_SOURCE__: string;

export function shellQuote(value: string) {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}
export function validateRemote(value: RemoteConnection): RemoteConnection {
  if (!value || typeof value.name !== "string" || !value.name.trim())
    throw new Error("请输入连接名称");
  if (
    value.authentication !== undefined &&
    !["ssh", "kerberos"].includes(value.authentication)
  )
    throw new Error("认证方式无效");
  if (
    typeof value.host !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:[\]-]*$/.test(value.host)
  )
    throw new Error("请输入主机名、IP 或 SSH 配置别名");
  if (value.user && !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(value.user))
    throw new Error("SSH 用户名无效");
  if (
    value.port !== undefined &&
    (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535)
  )
    throw new Error("端口必须为 1–65535");
  for (const field of [value.identityFile, value.nodePath, value.configFile])
    if (
      field !== undefined &&
      (typeof field !== "string" || /[\0\r\n]/.test(field))
    )
      throw new Error("路径无效");
  return {
    id: value.id,
    name: value.name.trim(),
    host: value.host,
    user: value.user || undefined,
    port: value.port,
    identityFile: value.identityFile || undefined,
    nodePath: value.nodePath || undefined,
    configFile: value.configFile || undefined,
    authentication: value.authentication || "ssh",
  };
}
export function sshArgs(
  connection: RemoteConnection,
  terminal = false,
): string[] {
  validateRemote(connection);
  return [
    terminal ? "-tt" : "-T",
    ...(connection.configFile ? ["-F", connection.configFile] : []),
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=3",
    ...(connection.authentication === "kerberos"
      ? [
          "-o",
          "GSSAPIAuthentication=yes",
          "-o",
          "PubkeyAuthentication=no",
          "-o",
          "PasswordAuthentication=no",
          "-o",
          "KbdInteractiveAuthentication=no",
          "-o",
          "PreferredAuthentications=gssapi-with-mic",
        ]
      : []),
    ...(connection.user ? ["-l", connection.user] : []),
    ...(connection.port ? ["-p", String(connection.port)] : []),
    ...(connection.identityFile && connection.authentication !== "kerberos"
      ? ["-i", connection.identityFile]
      : []),
    "--",
    connection.host,
  ];
}
export async function kerberosStatus(
  env = process.env,
): Promise<KerberosStatus> {
  try {
    // Use macOS Kerberos, not a Conda/Homebrew executable, and never return ticket contents.
    await promisify(execFile)("/usr/bin/klist", ["-s"], { env, timeout: 5000 });
    return {
      valid: true,
      message: "本机 Kerberos 票据有效；请测试连接以确认主机权限",
    };
  } catch (error: any) {
    return {
      valid: false,
      message:
        error.code === 1
          ? "未找到有效 Kerberos 票据，请在系统终端执行 /usr/bin/kinit 后重试"
          : "无法检查 Kerberos 票据，请在系统终端运行 /usr/bin/klist 排查",
    };
  }
}
export function remoteTerminalCommand(root: string) {
  return `cd ${shellQuote(root)} && exec "\${SHELL:-/bin/sh}" -l`;
}
export class RemoteClient {
  private child?: ChildProcessWithoutNullStreams;
  private pending = new Map<
    number,
    {
      resolve(value: any): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private sequence = 0;
  constructor(
    private connection: RemoteConnection,
    private source = __REMOTE_AGENT_SOURCE__,
    private onChange?: (event: {
      root: string;
      path: string;
      type: string;
    }) => void,
  ) {}
  private start() {
    if (this.child) return this.child;
    const command = `${shellQuote(this.connection.nodePath || "node")} -e ${shellQuote(this.source)}`;
    const child = spawn(
      "/usr/bin/ssh",
      [...sshArgs(this.connection), command],
      { stdio: "pipe" },
    );
    this.child = child;
    let stderr = "";
    child.stderr.on("data", (data) => {
      stderr = (stderr + data).slice(-8000);
    });
    const fail = (error: Error) => {
      if (this.child !== child) return;
      this.child = undefined;
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(error);
      }
      this.pending.clear();
      child.kill();
    };
    child.on("error", fail);
    child.stdin.on("error", fail);
    child.on("close", () =>
      fail(
        new Error(
          `SSH 连接已断开：${stderr.trim() || "远端进程退出"}。${
            this.connection.authentication === "kerberos"
              ? "请检查研发网络/VPN、/usr/bin/klist 票据状态，必要时执行 /usr/bin/kinit；同时确认 SSH 配置、known_hosts 和远端 Node.js 路径。"
              : "请确认密钥、known_hosts 和远端 Node.js 路径。"
          }`,
        ),
      ),
    );
    const reader = createInterface({ input: child.stdout });
    reader.on("line", (line) => {
      if (this.child !== child) return;
      try {
        const response = JSON.parse(line);
        if (response.event) {
          this.onChange?.(response.event);
          return;
        }
        const request = this.pending.get(response.id);
        if (!request) return;
        clearTimeout(request.timer);
        this.pending.delete(response.id);
        if (response.error) request.reject(new Error(response.error));
        else request.resolve(response.result);
      } catch {
        fail(
          new Error(
            "远端返回了无效数据，请检查 SSH 登录脚本是否向标准输出写入内容",
          ),
        );
      }
    });
    return child;
  }
  call<T>(method: string, root: string, ...args: unknown[]): Promise<T> {
    const child = this.start();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.close("远端请求超时；写入操作可能已完成，请刷新确认后重试"),
        135000,
      );
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, method, root, args }) + "\n");
    });
  }
  close(message = "SSH 连接已关闭") {
    const child = this.child;
    this.child = undefined;
    child?.kill();
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(message));
    }
    this.pending.clear();
  }
}

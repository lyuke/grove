import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import type {
  AgentProfile,
  AgentTask,
  Project,
  RemoteConnection,
} from "../shared/types";
import { shellQuote, sshArgs } from "./remote";
import { validateAgents } from "../shared/preferences";

export function taskCommand(
  project: Project,
  agent: AgentProfile,
  prompt: string,
  remote?: RemoteConnection,
) {
  const args = agent.args.map((arg) =>
    arg.replaceAll("{prompt}", () => prompt),
  );
  if (!project.remoteId)
    return { executable: agent.executable, args, cwd: project.path };
  if (!remote || remote.id !== project.remoteId)
    throw new Error("远端连接配置不存在");
  const command = `cd ${shellQuote(project.path)} && exec ${[agent.executable, ...args].map(shellQuote).join(" ")}`;
  return {
    executable: "/usr/bin/ssh",
    args: [...sshArgs(remote), `sh -lc ${shellQuote(command)}`],
    cwd: undefined,
  };
}

export class TaskManager {
  private records: AgentTask[] = [];
  private processes = new Map<string, ChildProcess>();
  private writes: Promise<void> = Promise.resolve();
  private closing = false;
  constructor(
    private file: string,
    private changed: (task: AgentTask) => void,
    private completed: (task: AgentTask) => void,
  ) {}

  async load() {
    try {
      const records = JSON.parse(await fs.readFile(this.file, "utf8"));
      if (!Array.isArray(records)) throw new Error("任务记录格式无效");
      this.records = records;
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
    }
    for (const task of this.records) {
      if (task.status === "running") {
        task.status = "interrupted";
        task.finishedAt = new Date().toISOString();
        task.output +=
          "\nGrove 上次退出时任务尚未完成，请检查执行目标后重新创建任务。";
      }
    }
    await this.save();
  }

  list() {
    return this.records;
  }

  private save() {
    const snapshot = JSON.stringify(this.records, null, 2);
    const write = this.writes
      .catch(() => {})
      .then(async () => {
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        await fs.writeFile(this.file + ".tmp", snapshot);
        await fs.rename(this.file + ".tmp", this.file);
      });
    this.writes = write;
    return write;
  }

  async create(
    input: { title: string; prompt: string },
    project: Project,
    agent: AgentProfile,
    remote?: RemoteConnection,
  ) {
    if (this.closing) throw new Error("应用正在退出");
    if (this.processes.size >= 8) throw new Error("最多同时执行 8 个任务");
    if (
      !input ||
      typeof input.title !== "string" ||
      !input.title.trim() ||
      input.title.length > 200 ||
      typeof input.prompt !== "string" ||
      !input.prompt.trim() ||
      input.prompt.length > 32000 ||
      input.prompt.includes("\0")
    )
      throw new Error(
        "请输入任务标题（最多 200 字）和任务描述（最多 32000 字）",
      );
    validateAgents([agent]);
    const command = taskCommand(project, agent, input.prompt, remote);
    const task: AgentTask = {
      id: randomUUID(),
      title: input.title.trim(),
      prompt: input.prompt,
      projectId: project.id,
      projectName: project.name,
      target: remote
        ? `${remote.name} · ${remote.host}:${project.path}`
        : project.path,
      remote: !!project.remoteId,
      agentName: agent.name,
      status: "running",
      output: "",
      createdAt: new Date().toISOString(),
    };
    this.records.unshift(task);
    try {
      await this.save();
    } catch (error) {
      this.records = this.records.filter((record) => record.id !== task.id);
      throw error;
    }
    this.changed(task);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const append = (data: string) => {
      task.output = (task.output + data).slice(-100000);
      if (!timer)
        timer = setTimeout(() => {
          timer = undefined;
          this.changed(task);
        }, 100);
    };
    const finish = async (code: number | null, error?: Error) => {
      if (task.status !== "running") return;
      if (timer) clearTimeout(timer);
      this.processes.delete(task.id);
      task.status = this.closing
        ? "interrupted"
        : code === 0 && !error
          ? "succeeded"
          : "failed";
      task.finishedAt = new Date().toISOString();
      if (code !== null) task.exitCode = code;
      if (error)
        task.output = (task.output + `\n${error.message}`).slice(-100000);
      try {
        await this.save();
      } catch (failure) {
        task.output += `\n保存任务记录失败：${String(failure)}`;
      }
      this.changed(task);
      if (!this.closing) this.completed(task);
    };
    try {
      const child = spawn(command.executable, command.args, {
        cwd: command.cwd,
        env: process.env,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.processes.set(task.id, child);
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", append);
      child.stderr?.on("data", append);
      child.once("error", (error) => void finish(null, error));
      child.once("close", (code) => void finish(code));
    } catch (error) {
      await finish(null, error as Error);
    }
    return task;
  }

  close() {
    this.closing = true;
    for (const child of this.processes.values()) {
      try {
        if (child.pid) process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill();
      }
    }
  }
}

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { stripVTControlCharacters } from "node:util";
import type {
  AgentProfile,
  AgentTask,
  Project,
  RemoteConnection,
} from "../shared/types";
import { shellQuote } from "./remote";
import { validateAgents } from "../shared/preferences";
import type { TaskTerminal, TaskTerminalEvents } from "./task-terminal";

type TerminalFactory = (
  task: AgentTask,
  project: Project,
  remote: RemoteConnection | undefined,
  events: TaskTerminalEvents,
) => Promise<TaskTerminal>;
export function taskCommand(agent: AgentProfile, prompt: string) {
  return [
    agent.executable,
    ...agent.args.map((arg) => arg.replaceAll("{prompt}", () => prompt)),
  ]
    .map(shellQuote)
    .join(" ");
}
export class TaskManager {
  private records: AgentTask[] = [];
  private sessions = new Map<string, TaskTerminal>();
  private rawOutputs = new Map<string, string>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private writes: Promise<void> = Promise.resolve();
  private closing = false;
  constructor(
    private file: string,
    private changed: (task: AgentTask) => void,
    private completed: (task: AgentTask) => void,
    private openTerminal: TerminalFactory,
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
      task.terminalId = undefined;
      if (task.status === "running") {
        task.status = "interrupted";
        task.finishedAt = new Date().toISOString();
        task.output +=
          "\nGrove 上次退出时任务尚未完成，请检查执行目标后新建任务。";
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
  private validatePrompt(prompt: string) {
    if (
      typeof prompt !== "string" ||
      !prompt.trim() ||
      prompt.length > 32000 ||
      prompt.includes("\0")
    )
      throw new Error("请输入任务描述（最多 32000 字）");
  }
  private append(task: AgentTask, data: string) {
    const raw = ((this.rawOutputs.get(task.id) || task.output) + data).slice(
      -100000,
    );
    this.rawOutputs.set(task.id, raw);
    task.output = stripVTControlCharacters(raw);
    if (!this.timers.has(task.id))
      this.timers.set(
        task.id,
        setTimeout(() => {
          this.timers.delete(task.id);
          this.changed(task);
        }, 100),
      );
  }
  private async finish(task: AgentTask, code: number, interrupted = false) {
    if (task.status !== "running") return;
    clearTimeout(this.timers.get(task.id));
    this.timers.delete(task.id);
    task.status =
      interrupted || this.closing
        ? "interrupted"
        : code === 0
          ? "succeeded"
          : "failed";
    task.exitCode = code;
    task.finishedAt = new Date().toISOString();
    const snapshot = { ...task };
    try {
      await this.save();
    } catch (error) {
      this.append(task, `\n保存任务记录失败：${String(error)}`);
    }
    this.changed(task);
    if (!this.closing) this.completed(snapshot);
  }
  async create(
    input: { title: string; prompt: string },
    project: Project,
    agent: AgentProfile,
    remote?: RemoteConnection,
  ) {
    if (this.closing) throw new Error("应用正在退出");
    if (this.records.filter((task) => task.status === "running").length >= 8)
      throw new Error("最多同时执行 8 个任务");
    this.validatePrompt(input.prompt);
    if (
      typeof input.title !== "string" ||
      !input.title.trim() ||
      input.title.length > 200
    )
      throw new Error("请输入任务标题（最多 200 字）");
    const profile = validateAgents([agent])[0];
    const task: AgentTask = {
      id: randomUUID(),
      title: input.title.trim(),
      prompt: input.prompt,
      prompts: [input.prompt],
      projectId: project.id,
      projectName: project.name,
      target: remote
        ? `${remote.name} · ${remote.host}:${project.path}`
        : project.path,
      remote: !!project.remoteId,
      agentName: agent.name,
      agent: profile,
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
    try {
      const session = await this.openTerminal(task, project, remote, {
        output: (data) => this.append(task, data),
        complete: (code) => {
          void this.finish(task, code);
        },
        exit: (code) => {
          this.sessions.delete(task.id);
          task.terminalId = undefined;
          if (task.status === "running") void this.finish(task, code, true);
          else {
            this.changed(task);
            void this.save().catch(() => {});
          }
        },
      });
      this.sessions.set(task.id, session);
      task.terminalId = session.id;
      await session.ready;
      await this.save();
      this.changed(task);
      session.run(taskCommand(profile, input.prompt));
    } catch (error) {
      this.append(task, `\n${String(error)}`);
      await this.finish(task, 1);
    }
    return task;
  }
  async continue(id: string, prompt: string) {
    if (this.closing) throw new Error("应用正在退出");
    this.validatePrompt(prompt);
    const task = this.records.find((record) => record.id === id);
    const session = this.sessions.get(id);
    if (!task || !session || !task.agent || !task.terminalId)
      throw new Error("任务终端已关闭，请新建任务");
    if (task.status === "running")
      throw new Error("Agent 正在执行，请在终端中交互");
    if (
      this.records.filter((record) => record.status === "running").length >= 8
    )
      throw new Error("最多同时执行 8 个任务");
    const previous = { ...task };
    task.prompts = [...(task.prompts || [task.prompt]), prompt];
    task.status = "running";
    task.finishedAt = undefined;
    task.exitCode = undefined;
    try {
      await this.save();
      session.run(taskCommand(task.agent, prompt));
    } catch (error) {
      Object.assign(task, previous);
      if (!this.sessions.has(id)) task.terminalId = undefined;
      await this.save();
      throw error;
    }
    this.changed(task);
    return task;
  }
  close() {
    this.closing = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const session of this.sessions.values()) session.close();
  }
}

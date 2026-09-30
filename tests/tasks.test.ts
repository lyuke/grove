import { afterEach, beforeEach, expect, test, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TaskManager, taskCommand } from "../electron/tasks";
import {
  parsePalette,
  validateAgents,
  defaultAgents,
} from "../shared/preferences";
import { startSSH } from "./ssh-fixture";
import type { AgentTask } from "../shared/types";

let root: string;
let manager: TaskManager;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "grove-tasks-"));
});
afterEach(async () => {
  manager?.close();
  await fs.rm(root, { recursive: true, force: true });
});

test("palette import validates schema and excludes arbitrary CSS", () => {
  expect(
    parsePalette(
      JSON.stringify({
        version: 1,
        theme: "nord",
        colors: { local: "#123456", remote: "#aabbccdd" },
      }),
    ),
  ).toEqual({
    theme: "nord",
    palette: { local: "#123456", remote: "#aabbccdd" },
  });
  for (const colors of [
    { remote: "url(https://invalid)" },
    { typo: "#aabbcc" },
    [],
    null,
  ])
    expect(() =>
      parsePalette(JSON.stringify({ version: 1, theme: "dark", colors })),
    ).toThrow();
  expect(() => parsePalette('{"version":2}')).toThrow();
  expect(() =>
    validateAgents([{ ...defaultAgents[0], args: ["exec"] }]),
  ).toThrow();
  expect(() => validateAgents([defaultAgents[0], defaultAgents[0]])).toThrow();
});

test("local tasks preserve literal prompts, cwd, output and history, and notify once", async () => {
  const completed = vi.fn();
  manager = new TaskManager(path.join(root, "tasks.json"), () => {}, completed);
  await manager.load();
  const prompt = "'中文' $(touch injected) `whoami`\n{prompt}";
  const task = await manager.create(
    { title: "Literal prompt", prompt },
    { id: "local", name: "Local", path: root },
    {
      id: "node",
      name: "Test",
      executable: process.execPath,
      args: [
        "-e",
        "console.log(process.cwd()); console.log(process.argv[1])",
        "{prompt}",
      ],
    },
  );
  await vi.waitFor(() => expect(completed).toHaveBeenCalledTimes(1));
  expect(task.status).toBe("succeeded");
  expect(task.output).toContain(prompt);
  expect(task.output).toContain(root);
  await expect(fs.stat(path.join(root, "injected"))).rejects.toThrow();
  const restored = new TaskManager(
    path.join(root, "tasks.json"),
    () => {},
    () => {},
  );
  await restored.load();
  expect(restored.list()[0]).toEqual(task);
});

test("nonzero exits and missing agents fail rather than reporting completion", async () => {
  const completed = vi.fn();
  manager = new TaskManager(path.join(root, "tasks.json"), () => {}, completed);
  await manager.load();
  const project = { id: "local", name: "Local", path: root };
  const failure = await manager.create(
    { title: "failure", prompt: "test" },
    project,
    {
      id: "node",
      name: "Test",
      executable: process.execPath,
      args: [
        "-e",
        "console.error(process.argv[1]); process.exit(7)",
        "{prompt}",
      ],
    },
  );
  await vi.waitFor(() => expect(completed).toHaveBeenCalledTimes(1));
  expect(failure.status).toBe("failed");
  expect(failure.exitCode).toBe(7);
  expect(failure.output).toContain("test");
  const missing = await manager.create(
    { title: "missing", prompt: "test" },
    project,
    { ...defaultAgents[0], executable: path.join(root, "missing-agent") },
  );
  await vi.waitFor(() => expect(completed).toHaveBeenCalledTimes(2));
  expect(missing.status).toBe("failed");
  expect(missing.output).toContain("ENOENT");
});

test("restart marks unfinished tasks interrupted without replay or notification", async () => {
  const record: AgentTask = {
    id: "old",
    title: "unfinished",
    prompt: "test",
    projectId: "local",
    projectName: "Local",
    target: root,
    remote: false,
    agentName: "Test",
    status: "running",
    output: "partial",
    createdAt: new Date().toISOString(),
  };
  await fs.writeFile(path.join(root, "tasks.json"), JSON.stringify([record]));
  const completed = vi.fn();
  manager = new TaskManager(path.join(root, "tasks.json"), () => {}, completed);
  await manager.load();
  expect(manager.list()[0].status).toBe("interrupted");
  expect(manager.list()[0].output).toContain("partial");
  expect(completed).not.toHaveBeenCalled();
});

test("real SSH tasks run in the selected remote directory and quote prompts safely", async () => {
  const fixture = await startSSH(root);
  try {
    const directory = path.join(root, "remote ' project");
    await fs.mkdir(directory);
    const completed = vi.fn();
    manager = new TaskManager(
      path.join(root, "tasks.json"),
      () => {},
      completed,
    );
    await manager.load();
    const connection = {
      id: "remote",
      name: "Test SSH",
      host: "grove-test",
      configFile: fixture.configFile,
    };
    const project = {
      id: "project",
      name: "Remote",
      path: directory,
      remoteId: "remote",
    };
    const agent = {
      id: "node",
      name: "Test",
      executable: process.execPath,
      args: [
        "-e",
        "console.log(process.cwd()); console.log(process.argv[1])",
        "{prompt}",
      ],
    };
    expect(() => taskCommand(project, agent, "test")).toThrow();
    const prompt = "你好 ' $(touch injected) `whoami`\nnext";
    const task = await manager.create(
      { title: "SSH", prompt },
      project,
      agent,
      connection,
    );
    await vi.waitFor(() => expect(completed).toHaveBeenCalledTimes(1), {
      timeout: 10000,
    });
    expect(task.status, task.output).toBe("succeeded");
    expect(task.output).toContain(directory);
    expect(task.output).toContain(prompt);
    await expect(fs.stat(path.join(directory, "injected"))).rejects.toThrow();
  } finally {
    await fixture.close();
  }
}, 20000);

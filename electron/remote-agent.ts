import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as service from "./services";

const exec = promisify(execFile);
const available = async (command: string) =>
  exec(command, ["--version"]).then(
    () => true,
    () => false,
  );
const handlers: Record<string, (root: string, ...args: any[]) => unknown> = {
  listFiles: service.listFiles,
  readFile: service.readFile,
  writeFile: service.writeFile,
  createFile: service.createFile,
  moveFile: service.moveFile,
  search: (root, query, filenames) =>
    service.search(root, query, filenames, "rg"),
  gitStatus: service.gitStatus,
  gitDiff: service.gitDiff,
  gitStage: service.gitStage,
  gitDiscard: service.gitDiscard,
  gitHistory: service.gitHistory,
  gitCommitDetail: service.gitCommitDetail,
  gitCommitFiles: service.gitCommitFiles,
  gitCommitDiff: service.gitCommitDiff,
  gitCommit: async (root, message) => {
    if (typeof message !== "string" || !message.trim())
      throw new Error("请填写提交信息");
    const status = await service.gitStatus(root);
    if (status.changes.some((c) => c.conflict))
      throw new Error("请先解决合并冲突");
    const staged = (s: typeof status) =>
      s.changes.filter((c) => c.index !== " " && c.index !== "?").length;
    if (!staged(status)) throw new Error("暂存区为空");
    const repo = (
      await service.git(root, ["rev-parse", "--show-toplevel"])
    ).trim();
    if (staged(await service.gitStatus(repo)) !== staged(status))
      throw new Error(
        "仓库中有此项目目录之外的暂存文件，请打开仓库根目录后提交",
      );
    return service.git(root, ["commit", "-m", message]);
  },
  // Use a recoverable per-user remote trash; never delete remote files recursively.
  trashFile: async (root, relative) => {
    await service.safePath(root, relative);
    const source = path.join(
      await service.safePath(root, path.dirname(relative), true),
      path.basename(relative),
    );
    const trash = path.join(os.homedir(), ".grove-trash", randomUUID());
    await fs.mkdir(trash, { recursive: true, mode: 0o700 });
    await fs.writeFile(
      path.join(trash, "origin.json"),
      JSON.stringify({ path: source, date: new Date().toISOString() }),
      { mode: 0o600 },
    );
    await fs.rename(source, path.join(trash, "item"));
    return trash;
  },
  resolve: async (root) => {
    const expanded =
      root === "~"
        ? os.homedir()
        : root.startsWith("~/")
          ? path.join(os.homedir(), root.slice(2))
          : root;
    if (!path.isAbsolute(expanded))
      throw new Error("请输入远端绝对路径或 ~/ 开头的路径");
    const real = await fs.realpath(expanded);
    if (!(await fs.stat(real)).isDirectory())
      throw new Error("请选择远端文件夹");
    return real;
  },
  info: async () => ({
    hostname: os.hostname(),
    home: os.homedir(),
    node: process.version,
    git: await available("git"),
    search: await available("rg"),
  }),
};
const lines = createInterface({ input: process.stdin });
const watched = new Map<
  string,
  { root: string; relative: string; signature: string; directory: boolean }
>();
const roots = new Set<string>();
async function signature(root: string, relative: string) {
  try {
    const target = await service.safePath(root, relative, true);
    const stat = await fs.stat(target);
    return `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
  } catch {
    return "missing";
  }
}
let polling = false;
const poll = setInterval(async () => {
  if (polling) return;
  polling = true;
  try {
    for (const entry of watched.values()) {
      const current = await signature(entry.root, entry.relative);
      if (current !== entry.signature) {
        entry.signature = current;
        process.stdout.write(
          JSON.stringify({
            event: {
              root: entry.root,
              path: entry.relative,
              type: entry.directory ? "add" : "change",
            },
          }) + "\n",
        );
      }
    }
    for (const root of roots)
      process.stdout.write(
        JSON.stringify({ event: { root, path: ".git", type: "change" } }) +
          "\n",
      );
  } finally {
    polling = false;
  }
}, 3000);
poll.unref();
lines.on("close", () => {
  clearInterval(poll);
});
// Serialize writes so two saves cannot both pass the same expected hash.
let queue = Promise.resolve();
lines.on("line", (line) => {
  queue = queue.then(async () => {
    let id: number | undefined;
    try {
      const request = JSON.parse(line);
      id = request.id;
      if (
        !Object.hasOwn(handlers, request.method) ||
        !Array.isArray(request.args)
      )
        throw new Error("远端请求无效");
      const result = await handlers[request.method](
        request.root,
        ...request.args,
      );
      if (request.method === "gitStatus") roots.add(request.root);
      if (["listFiles", "readFile"].includes(request.method)) {
        const relative = request.args[0];
        roots.add(request.root);
        watched.set(JSON.stringify([request.root, relative]), {
          root: request.root,
          relative,
          directory: request.method === "listFiles",
          signature: await signature(request.root, relative),
        });
      }
      process.stdout.write(
        JSON.stringify({ id, result: result ?? null }) + "\n",
      );
    } catch (error) {
      process.stdout.write(
        JSON.stringify({
          id,
          error: error instanceof Error ? error.message : String(error),
        }) + "\n",
      );
    }
  });
});

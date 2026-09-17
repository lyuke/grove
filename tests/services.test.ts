import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as service from "../electron/services";
let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "grove-unit-"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
describe("file integrity and project boundaries", () => {
  it("saves without altering CRLF or UTF-8 BOM and refuses a stale disk version", async () => {
    await fs.writeFile(path.join(root, "text.txt"), "\uFEFF你好\r\nGrove\r\n");
    const original = await service.readFile(root, "text.txt");
    expect(original.content).toBe("\uFEFF你好\r\nGrove\r\n");
    await service.writeFile(
      root,
      "text.txt",
      original.content + "next\r\n",
      original.hash,
    );
    expect(await fs.readFile(path.join(root, "text.txt"), "utf8")).toBe(
      original.content + "next\r\n",
    );
    await expect(
      service.writeFile(root, "text.txt", "stale", original.hash),
    ).rejects.toThrow("磁盘文件已更改");
  });
  it("rejects traversal and links outside the project, including nonexistent descendants", async () => {
    await fs.symlink(os.tmpdir(), path.join(root, "outside"));
    await expect(service.safePath(root, "../secret")).rejects.toThrow(
      "项目目录之外",
    );
    await expect(service.safePath(root, "outside/new/file")).rejects.toThrow(
      "符号链接",
    );
    await expect(service.safePath(root, "")).rejects.toThrow();
  });
  it("does not overwrite an existing file when creating or moving", async () => {
    await service.createFile(root, "first", false);
    await service.createFile(root, "second", false);
    await expect(service.createFile(root, "first", false)).rejects.toThrow();
    await expect(service.moveFile(root, "first", "second")).rejects.toThrow(
      "已存在",
    );
    await service.moveFile(root, "first", "renamed");
    expect((await service.listFiles(root, "")).map((e) => e.name)).toEqual([
      "renamed",
      "second",
    ]);
  });
  it("rejects binary and invalid UTF-8 files", async () => {
    await fs.writeFile(path.join(root, "binary"), Buffer.from([1, 0, 4]));
    await fs.writeFile(path.join(root, "invalid"), Buffer.from([255, 254]));
    await expect(service.readFile(root, "binary")).rejects.toThrow("二进制");
    await expect(service.readFile(root, "invalid")).rejects.toThrow("UTF-8");
  });
  it("renames a symlink without moving its target", async () => {
    await fs.writeFile(path.join(root, "target"), "keep");
    await fs.symlink("target", path.join(root, "link"));
    await service.moveFile(root, "link", "renamed-link");
    expect(await fs.readlink(path.join(root, "renamed-link"))).toBe("target");
    expect(await fs.readFile(path.join(root, "target"), "utf8")).toBe("keep");
  });
});
describe("real Git repository", () => {
  beforeEach(async () => {
    await service.git(root, ["init", "-b", "main"]);
    await service.git(root, ["config", "user.name", "Grove Test"]);
    await service.git(root, ["config", "user.email", "grove@example.test"]);
    await service.git(root, ["config", "commit.gpgsign", "false"]);
    await service.git(root, [
      "config",
      "core.hooksPath",
      path.join(root, ".git/hooks"),
    ]);
  });
  it("stages and unstages before first commit, then separates index and worktree diffs", async () => {
    await fs.writeFile(path.join(root, "hello world.txt"), "one\n");
    await service.gitStage(root, "hello world.txt", true);
    expect((await service.gitStatus(root)).changes[0].index).toBe("A");
    await service.gitStage(root, "hello world.txt", false);
    expect((await service.gitStatus(root)).changes[0].index).toBe("?");
    await service.gitStage(root, "hello world.txt", true);
    await service.git(root, ["commit", "-m", "initial"]);
    await fs.writeFile(path.join(root, "hello world.txt"), "two\n");
    await service.gitStage(root, "hello world.txt", true);
    await fs.writeFile(path.join(root, "hello world.txt"), "three\n");
    expect(await service.gitDiff(root, "hello world.txt", true)).toEqual({
      original: "one\n",
      modified: "two\n",
      binary: false,
    });
    expect(await service.gitDiff(root, "hello world.txt", false)).toEqual({
      original: "two\n",
      modified: "three\n",
      binary: false,
    });
  });
  it("handles staged renames and deletion paths", async () => {
    await fs.writeFile(path.join(root, "old.txt"), "original\n");
    await service.gitStage(root, "old.txt", true);
    await service.git(root, ["commit", "-m", "initial"]);
    await service.git(root, ["mv", "old.txt", "新 name.txt"]);
    const renamed = (await service.gitStatus(root)).changes[0];
    expect(renamed.originalPath).toBe("old.txt");
    expect((await service.gitDiff(root, "新 name.txt", true)).original).toBe(
      "original\n",
    );
    await service.git(root, ["commit", "-m", "rename"]);
    await fs.unlink(path.join(root, "新 name.txt"));
    expect((await service.gitDiff(root, "新 name.txt", false)).modified).toBe(
      "",
    );
    await service.gitStage(root, "新 name.txt", true);
    expect((await service.gitStatus(root)).changes[0].index).toBe("D");
  });
  it("scopes nested project paths correctly", async () => {
    await fs.mkdir(path.join(root, "nested"));
    await fs.writeFile(path.join(root, "nested/a.txt"), "first");
    const nested = path.join(root, "nested");
    expect((await service.gitStatus(nested)).changes[0].path).toBe("a.txt");
    await service.gitStage(nested, "a.txt", true);
    expect((await service.gitDiff(nested, "a.txt", true)).modified).toBe(
      "first",
    );
  });
  it("treats Git pathspec syntax as a literal filename when staging", async () => {
    await fs.writeFile(path.join(root, ":(glob)*"), "literal");
    await fs.writeFile(path.join(root, "other"), "must remain untracked");
    await service.gitStage(root, ":(glob)*", true);
    const changes = (await service.gitStatus(root)).changes;
    expect(changes.find((c) => c.path === ":(glob)*")?.index).toBe("A");
    expect(changes.find((c) => c.path === "other")?.index).toBe("?");
  });
  it("does not rewrite the Git index while checking status or reading a cached change", async () => {
    await fs.writeFile(path.join(root, "clean.txt"), "same\n");
    await service.git(root, ["add", "."]);
    await service.git(root, ["commit", "-m", "initial"]);
    const index = path.join(root, ".git/index");
    const before = await fs.readFile(index);
    const later = new Date(Date.now() + 3000);
    await fs.utimes(path.join(root, "clean.txt"), later, later);
    expect((await service.gitStatus(root)).changes).toEqual([]);
    expect(await fs.readFile(index)).toEqual(before);
    await fs.writeFile(path.join(root, "clean.txt"), "changed\n");
    const change = (await service.gitStatus(root)).changes[0];
    expect(await service.gitDiff(root, "clean.txt", false, change)).toEqual({
      original: "same\n",
      modified: "changed\n",
      binary: false,
    });
  });
  it("reports not-a-repository without fabricating status", async () => {
    const plain = await fs.mkdtemp(path.join(os.tmpdir(), "grove-plain-"));
    try {
      expect((await service.gitStatus(plain)).repository).toBe(false);
    } finally {
      await fs.rm(plain, { recursive: true });
    }
  });
});

describe("commit history", () => {
  it("handles empty repositories, multiline messages and paginates without duplicates", async () => {
    await service.git(root, ["init"]);
    expect(await service.gitHistory(root, 0)).toEqual([]);
    await service.git(root, ["config", "commit.gpgsign", "false"]);
    await service.git(root, ["config", "user.name", "History Tester"]);
    await service.git(root, ["config", "user.email", "history@example.com"]);
    await fs.writeFile(path.join(root, "history.txt"), "first");
    await service.git(root, ["add", "."]);
    await service.git(root, [
      "commit",
      "-m",
      "First commit\n\nA multiline body 中文",
    ]);
    const first = await service.gitHistory(root, 0);
    expect(first).toHaveLength(1);
    expect(first[0].message).toContain("A multiline body 中文");
    expect(first[0].author).toBe("History Tester");
    expect(await service.gitHistory(root, 1)).toEqual([]);
    expect(await service.gitCommitDetail(root, first[0].hash)).toContain(
      "history.txt",
    );
    await expect(service.gitHistory(root, -1)).rejects.toThrow("分页");
    await expect(service.gitCommitDetail(root, "--all")).rejects.toThrow(
      "提交编号",
    );
  });
});

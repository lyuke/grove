import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  Change,
  FileData,
  FileEntry,
  GitDiff,
  GitStatus,
  SearchHit,
  Settings,
} from "../shared/types";

const exec = promisify(execFile);
export const defaults = (): Settings => ({
  projects: [],
  theme: "dark",
  widths: [180, 245, 390],
  collapsed: [false, false, false],
  terminalHeight: 280,
  terminalMaximized: false,
  terminalFontSize: 12,
  workspaces: {},
});
export const hash = (content: string) =>
  createHash("sha256").update(content).digest("hex");
const inside = (root: string, candidate: string) =>
  candidate === root || candidate.startsWith(root + path.sep);

export async function safePath(
  root: string,
  relative: string,
  allowRoot = false,
): Promise<string> {
  if (
    typeof relative !== "string" ||
    relative.includes("\0") ||
    path.isAbsolute(relative)
  )
    throw new Error("文件路径无效");
  const canonicalRoot = await fs.realpath(root);
  const candidate = path.resolve(canonicalRoot, relative);
  if (
    !inside(canonicalRoot, candidate) ||
    (!allowRoot && candidate === canonicalRoot)
  )
    throw new Error("不能操作项目目录之外的文件");
  // Resolve the closest existing ancestor, including symlinks, before allowing new paths.
  let ancestor = candidate;
  while (true) {
    try {
      const actual = await fs.realpath(ancestor);
      if (!inside(canonicalRoot, actual))
        throw new Error("符号链接指向项目目录之外");
      return path.join(actual, path.relative(ancestor, candidate));
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
      if (ancestor === canonicalRoot) throw error;
      ancestor = path.dirname(ancestor);
    }
  }
}

export async function listFiles(
  root: string,
  relative: string,
): Promise<FileEntry[]> {
  const dir = await safePath(root, relative, true);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.name !== ".git")
    .map((e) => ({
      name: e.name,
      path: path.posix.join(relative, e.name),
      directory: e.isDirectory(),
      symlink: e.isSymbolicLink(),
    }))
    .sort(
      (a, b) =>
        Number(b.directory) - Number(a.directory) ||
        a.name.localeCompare(b.name),
    );
}

export async function readFile(
  root: string,
  relative: string,
): Promise<FileData> {
  const target = await safePath(root, relative);
  const stat = await fs.stat(target);
  if (!stat.isFile()) throw new Error("请选择普通文件");
  if (stat.size > 5 * 1024 * 1024)
    throw new Error("文件超过 5 MB，暂不支持编辑");
  const buffer = await fs.readFile(target);
  if (buffer.includes(0)) throw new Error("这是二进制文件，暂不支持文本编辑");
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      buffer,
    );
  } catch {
    throw new Error("文件不是有效的 UTF-8 编码，暂不支持编辑");
  }
  return { content, hash: hash(content) };
}

export async function writeFile(
  root: string,
  relative: string,
  content: string,
  expectedHash: string,
): Promise<FileData> {
  const target = await safePath(root, relative);
  let current: FileData;
  try {
    current = await readFile(root, relative);
  } catch (error: any) {
    if (error.code === "ENOENT")
      throw new Error("文件已被外部删除，请另存或恢复后重试");
    throw error;
  }
  if (current.hash !== expectedHash)
    throw new Error("磁盘文件已更改，请比较并处理外部修改后再保存");
  const stat = await fs.stat(target);
  const temp = path.join(path.dirname(target), `.grove-save-${randomUUID()}`);
  try {
    await fs.writeFile(temp, content, { mode: stat.mode, flag: "wx" });
    if ((await readFile(root, relative)).hash !== expectedHash)
      throw new Error("磁盘文件已更改，请比较并处理外部修改后再保存");
    await fs.rename(temp, target);
  } finally {
    await fs.unlink(temp).catch(() => {});
  }
  return { content, hash: hash(content) };
}

export async function createFile(
  root: string,
  relative: string,
  directory: boolean,
) {
  const target = await safePath(root, relative);
  if (directory) await fs.mkdir(target);
  else await fs.writeFile(target, "", { flag: "wx" });
}
export async function moveFile(root: string, from: string, to: string) {
  await safePath(root, from);
  const source = path.join(
    await safePath(root, path.dirname(from), true),
    path.basename(from),
  );
  const target = await safePath(root, to);
  try {
    await fs.lstat(target);
    throw new Error("目标文件已存在");
  } catch (error: any) {
    if (error.code !== "ENOENT") throw error;
  }
  await fs.rename(source, target);
}

export async function git(root: string, args: string[]) {
  try {
    return (
      await exec("git", ["--literal-pathspecs", "-C", root, ...args], {
        maxBuffer: 12 * 1024 * 1024,
        timeout: 120000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      })
    ).stdout;
  } catch (error: any) {
    throw new Error(error.stderr?.trim() || error.message);
  }
}

export function parseStatus(output: string): Change[] {
  const records = output.split("\0");
  const changes: Change[] = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record) continue;
    const index = record[0],
      worktree = record[1];
    const originalPath = /[RC]/.test(index + worktree)
      ? records[++i]
      : undefined;
    changes.push({
      path: record.slice(3),
      originalPath,
      index,
      worktree,
      conflict: ["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(
        index + worktree,
      ),
    });
  }
  return changes;
}
export async function gitStatus(root: string): Promise<GitStatus> {
  try {
    await git(root, ["rev-parse", "--git-dir"]);
  } catch {
    return { repository: false, branch: "", changes: [] };
  }
  // --relative paths are scoped to this project, including projects opened below the repo root.
  const [branch, output] = await Promise.all([
    git(root, ["symbolic-ref", "--short", "HEAD"]).catch(() =>
      git(root, ["rev-parse", "--short", "HEAD"]),
    ),
    git(root, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--",
      ".",
    ]),
  ]);
  const prefix = (await git(root, ["rev-parse", "--show-prefix"])).trim();
  const changes = parseStatus(output).map((c) => ({
    ...c,
    path:
      prefix && c.path.startsWith(prefix)
        ? c.path.slice(prefix.length)
        : c.path,
    originalPath:
      c.originalPath && prefix && c.originalPath.startsWith(prefix)
        ? c.originalPath.slice(prefix.length)
        : c.originalPath,
  }));
  return { repository: true, branch: branch.trim(), changes };
}

export async function gitDiff(
  root: string,
  relative: string,
  staged: boolean,
): Promise<GitDiff> {
  await safePath(root, relative);
  const status = await gitStatus(root);
  const change = status.changes.find((c) => c.path === relative);
  if (!change) throw new Error("此文件没有 Git 变更，请刷新");
  if (change.conflict)
    throw new Error("文件存在合并冲突，请在编辑器中解决冲突后暂存");
  const prefix = (await git(root, ["rev-parse", "--show-prefix"])).trim();
  const oldPath =
    prefix + (staged ? change.originalPath || relative : relative);
  let original = "",
    modified = "";
  if (staged) {
    if (change.index !== "A")
      original = await git(root, ["show", `HEAD:${oldPath}`]);
    if (change.index !== "D")
      modified = await git(root, ["show", `:${prefix + relative}`]);
  } else {
    if (change.index !== "?" && change.index !== "D")
      original = await git(root, ["show", `:${prefix + relative}`]);
    if (change.worktree !== "D") {
      const target = await safePath(root, relative);
      const stat = await fs.stat(target);
      if (stat.size > 5 * 1024 * 1024)
        throw new Error("文件超过 5 MB，暂不支持 Diff");
      modified = (await fs.readFile(target)).toString("utf8");
    }
  }
  return {
    original,
    modified,
    binary: original.includes("\0") || modified.includes("\0"),
  };
}

export async function gitStage(root: string, relative: string, stage: boolean) {
  await safePath(root, relative);
  const change = (await gitStatus(root)).changes.find(
    (c) => c.path === relative,
  );
  if (!change) throw new Error("文件状态已变化，请刷新");
  const paths = change.originalPath
    ? [relative, change.originalPath]
    : [relative];
  if (stage) await git(root, ["add", "--", ...paths]);
  else {
    const head = await git(root, ["rev-parse", "--verify", "HEAD"]).then(
      () => true,
      () => false,
    );
    await git(
      root,
      head
        ? ["reset", "-q", "HEAD", "--", ...paths]
        : ["rm", "--cached", "-r", "--", ...paths],
    );
  }
}

export async function search(
  root: string,
  query: string,
  filenames: boolean,
  rgPath: string,
): Promise<SearchHit[]> {
  if (!query.trim()) return [];
  const excludes = [
    "-g",
    "!node_modules",
    "-g",
    "!.git",
    "-g",
    "!dist",
    "-g",
    "!build",
    "-g",
    "!vendor",
  ];
  const args = filenames
    ? ["--files", "--null", "--hidden", ...excludes]
    : [
        "--json",
        "--hidden",
        "--max-count",
        "20",
        "--max-filesize",
        "1M",
        ...excludes,
        "-F",
        "-i",
        "--",
        query,
        ".",
      ];
  let output = "";
  try {
    output = (
      await exec(rgPath, args, {
        cwd: root,
        timeout: 15000,
        maxBuffer: 16 * 1024 * 1024,
      })
    ).stdout;
  } catch (error: any) {
    if (error.code === 1) return [];
    throw new Error(
      error.code === "ENOENT"
        ? "未找到 ripgrep，请安装 rg 后重启 Grove"
        : "搜索失败或结果过多，请缩小搜索范围",
    );
  }
  if (filenames)
    return output
      .split("\0")
      .filter((p) => p && p.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 200)
      .map((p) => ({ path: p, line: 1, text: p }));
  return output
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      const item = JSON.parse(line);
      return item.type === "match" &&
        item.data.path.text &&
        typeof item.data.lines.text === "string"
        ? [
            {
              path: item.data.path.text.replace(/^\.\//, ""),
              line: item.data.line_number,
              text: item.data.lines.text.trimEnd().slice(0, 400),
            },
          ]
        : [];
    })
    .slice(0, 200);
}

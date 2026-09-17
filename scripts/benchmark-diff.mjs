import { _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
const root = await fs.mkdtemp(path.join(os.tmpdir(), "grove-diff-perf-"));
const repo = path.join(root, "project");
await fs.mkdir(repo);
const git = (args) =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
for (const args of [
  ["init", "-b", "main"],
  ["config", "user.name", "Grove benchmark"],
  ["config", "user.email", "grove@example.test"],
  ["config", "commit.gpgsign", "false"],
  ["config", "core.hooksPath", path.join(repo, ".git/hooks")],
])
  git(args);
for (let i = 0; i < 3; i++)
  await fs.writeFile(
    path.join(repo, `diff-${i}.txt`),
    `BEFORE_${i}\n` +
      Array.from(
        { length: 18000 },
        (_, n) => `line ${n}: repeated payload for a larger diff ${i}\n`,
      ).join(""),
  );
git(["add", "."]);
git(["commit", "-m", "baseline"]);
for (let i = 0; i < 3; i++) {
  const file = path.join(repo, `diff-${i}.txt`);
  await fs.writeFile(
    file,
    (await fs.readFile(file, "utf8"))
      .replace(`BEFORE_${i}`, `AFTER_${i}`)
      .replace("line 10000:", "line 10000 changed:"),
  );
}
for (let batch = 0; batch < 20; batch++)
  await Promise.all(
    Array.from({ length: 100 }, (_, n) =>
      fs.writeFile(
        path.join(repo, `untracked-${batch * 100 + n}.txt`),
        "untracked",
      ),
    ),
  );
const env = {
  ...process.env,
  GROVE_USER_DATA: path.join(root, "state"),
  GROVE_TEST_PROJECT: repo,
};
delete env.ELECTRON_RUN_AS_NODE;
let app, child;
const results = {
  untrackedFiles: 2000,
  diffFiles: 3,
  linesPerFile: 18001,
  runs: [],
};
try {
  for (let run = 0; run < 3; run++) {
    await fs.rm(env.GROVE_USER_DATA, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
    app = await electron.launch({
      executablePath: process.env.GROVE_EXECUTABLE,
      args: [path.resolve(".")],
      env,
    });
    child = app.process();
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.getByRole("button", { name: "Git 变更", exact: true }).click();
    await page.locator('.git-file[title="diff-0.txt"]').waitFor();
    await app.evaluate(() => {
      const cp = process.getBuiltinModule("node:child_process");
      const spawn = cp.ChildProcess.prototype.spawn;
      globalThis.__gitCommands = [];
      cp.ChildProcess.prototype.spawn = function (options) {
        if (options.file === "git") globalThis.__gitCommands.push(options.args);
        return spawn.call(this, options);
      };
    });
    const samples = [];
    for (const index of [0, 1, 2, 0, 1, 2]) {
      await app.evaluate(() => {
        globalThis.__gitCommands = [];
      });
      const elapsed = await page.evaluate(async (index) => {
        const start = performance.now();
        document.querySelector(`.git-file[title="diff-${index}.txt"]`).click();
        await new Promise((resolve, reject) => {
          const check = () => {
            const content =
              document.querySelector(".monaco-diff-editor")?.textContent || "";
            const ready = document
              .querySelector(".diff-view")
              ?.getAttribute("data-diff-ready");
            const highlights = document.querySelector(
              ".monaco-diff-editor .line-insert, .monaco-diff-editor .char-insert",
            );
            if (
              content.includes(`AFTER_${index}`) &&
              (ready === "true" ||
                ((ready === null || ready === undefined) && highlights))
            )
              requestAnimationFrame(resolve);
            else if (performance.now() - start > 20000)
              reject(new Error("Diff did not become visible"));
            else requestAnimationFrame(check);
          };
          requestAnimationFrame(check);
        });
        return performance.now() - start;
      }, index);
      samples.push({
        index,
        elapsedMs: elapsed,
        gitCommands: await app.evaluate(() => globalThis.__gitCommands.length),
      });
    }
    if (errors.length) throw new Error(errors.join("\n"));
    results.runs.push(samples);
    const exited = new Promise((resolve) => child.once("exit", resolve));
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await exited;
    app = undefined;
  }
  await fs.writeFile(
    process.env.GROVE_BENCH_OUTPUT || "artifacts/diff-performance.json",
    JSON.stringify(results, null, 2) + "\n",
  );
  console.log(JSON.stringify(results));
} finally {
  if (app) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    const fallback = setTimeout(() => child.kill("SIGKILL"), 5000);
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await exited;
    clearTimeout(fallback);
  }
  await fs.rm(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}

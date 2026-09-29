import { _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "grove-large-bench-"));
const repo = path.join(root, "project");
const count = Number(process.env.GROVE_BENCH_FILES || 6000);
const output = process.env.GROVE_BENCH_OUTPUT || "artifacts/large-project.json";
const report = { files: count, runs: [] };
let app;
try {
  await fs.mkdir(repo);
  execFileSync("git", ["-C", repo, "init", "-b", "main"]);
  for (let offset = 0; offset < count; offset += 200) {
    await Promise.all(
      Array.from({ length: Math.min(200, count - offset) }, (_, i) =>
        fs.writeFile(
          path.join(repo, `file-${String(offset + i).padStart(5, "0")}.txt`),
          "sample\n",
        ),
      ),
    );
  }
  for (let run = 0; run < 3; run++) {
    const env = {
      ...process.env,
      GROVE_TEST_PROJECT: repo,
      GROVE_USER_DATA: path.join(root, `state-${run}`),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    const start = performance.now();
    app = await electron.launch({ args: [path.resolve(".")], env });
    const page = await app.firstWindow();
    await page.locator(".tree-item").first().waitFor();
    const treeReadyMs = performance.now() - start;
    const treeRows = await page.locator(".tree-row").count();
    const startGit = performance.now();
    await page.getByRole("button", { name: "Git 变更", exact: true }).click();
    await page.locator(".git-row").first().waitFor();
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    const gitReadyMs = performance.now() - startGit;
    const gitRows = await page.locator(".git-row").count();
    report.runs.push({ treeReadyMs, treeRows, gitReadyMs, gitRows });
    const exited = new Promise((resolve) =>
      app.process().once("exit", resolve),
    );
    await app.evaluate(({ app }) => app.exit(0));
    await exited;
    app = undefined;
  }
  await fs.writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (app) await app.close();
  await fs.rm(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}

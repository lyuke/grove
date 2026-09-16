import { _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const root = await fs.mkdtemp(path.join(os.tmpdir(), "grove-perf-"));
const repo = path.join(root, "project");
await fs.mkdir(repo);
for (let batch = 0; batch < 12; batch++) {
  await Promise.all(
    Array.from({ length: 100 }, (_, offset) => {
      const index = batch * 100 + offset;
      return fs.writeFile(
        path.join(repo, `file-${String(index).padStart(4, "0")}.txt`),
        `FILE_${index}\n` +
          "A line of code for browsing performance.\n".repeat(1000),
      );
    }),
  );
}
const env = {
  ...process.env,
  GROVE_USER_DATA: path.join(root, "state"),
  GROVE_TEST_PROJECT: repo,
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];
const result = { directoryFiles: 1200, fileLines: 1001, runs: [] };
try {
  for (let run = 0; run < Number(process.env.GROVE_BENCH_RUNS || 3); run++) {
    await fs.rm(env.GROVE_USER_DATA, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
    const start = performance.now();
    app = await electron.launch({
      executablePath: process.env.GROVE_EXECUTABLE,
      args: [path.resolve(".")],
      env,
    });
    const page = await app.firstWindow();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.locator(".tree-item").first().waitFor();
    const startupMs = performance.now() - start;
    const open = async (index, kind) => {
      return page.evaluate(
        async ({ index, kind }) => {
          const start = performance.now();
          const name = `file-${String(index).padStart(4, "0")}.txt`;
          const button =
            kind === "tab"
              ? [...document.querySelectorAll(".file-tab")]
                  .find((e) => e.textContent.includes(name))
                  ?.querySelector("button")
              : document.querySelector(`.tree-item[title="${name}"]`);
          button.click();
          await new Promise((resolve, reject) => {
            const poll = () => {
              if (
                document
                  .querySelector(".view-lines")
                  ?.textContent.includes(`FILE_${index}`)
              )
                requestAnimationFrame(() => resolve());
              else if (performance.now() - start > 15000)
                reject(new Error(`Timed out opening ${name}`));
              else requestAnimationFrame(poll);
            };
            requestAnimationFrame(poll);
          });
          return performance.now() - start;
        },
        { index, kind },
      );
    };
    const firstOpenMs = await open(0, "tree");
    const newFileMs = [];
    for (let index = 1; index <= 8; index++)
      newFileMs.push(await open(index, "tree"));
    const switchTabMs = [];
    for (let index = 0; index <= 8; index++)
      switchTabMs.push(await open(index, "tab"));
    await page.locator(".monaco-editor textarea").first().focus();
    const typingStart = performance.now();
    await page.keyboard.type(
      "typing performance sample with 60 characters in the editor!!!",
    );
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    result.runs.push({
      startupMs,
      firstOpenMs,
      newFileMs,
      switchTabMs,
      typingMs: performance.now() - typingStart,
    });
    const child = app.process();
    const exited = new Promise((resolve) => child.once("exit", resolve));
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await exited;
    app = undefined;
  }
  if (errors.length) throw new Error(errors.join("\n"));
  await fs.mkdir("artifacts", { recursive: true });
  const output = process.env.GROVE_BENCH_OUTPUT || "artifacts/performance.json";
  await fs.writeFile(output, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
} finally {
  if (app) {
    const child = app.process();
    const exited = new Promise((resolve) => child.once("exit", resolve));
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await exited;
  }
  await fs.rm(root, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}

import {
  test,
  expect as baseExpect,
  _electron as electron,
} from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

// The first Monaco worker in a translated x64 app can start slowly. Actual
// native interaction latency is measured separately by benchmark-diff.mjs.
const expect = baseExpect.configure({ timeout: 15000 });

test("large diff reuses its editor and refreshes external changes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "grove-diff-"));
  const repo = path.join(root, "project");
  await fs.mkdir(repo);
  const tail = "unchanged long line for a large text diff\n".repeat(18000);
  for (const name of ["a", "b"])
    await fs.writeFile(
      path.join(repo, `${name}.txt`),
      `BEFORE_${name}\n${tail}`,
    );
  for (const args of [
    ["init", "-b", "main"],
    ["config", "user.name", "Grove Test"],
    ["config", "user.email", "grove@example.test"],
    ["config", "commit.gpgsign", "false"],
    ["config", "core.hooksPath", path.join(repo, ".git/hooks")],
    ["add", "."],
    ["commit", "-m", "initial"],
  ])
    execFileSync("git", ["-C", repo, ...args]);
  for (const name of ["a", "b"])
    await fs.writeFile(
      path.join(repo, `${name}.txt`),
      `AFTER_${name}\n${tail}`,
    );
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
    GROVE_USER_DATA: path.join(root, "state"),
    GROVE_TEST_PROJECT: repo,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath: process.env.GROVE_EXECUTABLE,
    args: [path.resolve(".")],
    env,
  });
  const child = app.process();
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.getByRole("button", { name: "Git 变更", exact: true }).click();
    await page.locator('.git-file[title="a.txt"]').click();
    const diff = page.locator('.diff-view[data-diff-ready="true"]');
    await expect(diff).toContainText("AFTER_a");
    await page
      .locator(".monaco-diff-editor")
      .evaluate((el) => el.setAttribute("data-reuse-test", "same"));
    // Switch before the first IPC read can complete; only the latest selection should win.
    await page.evaluate(() => {
      (
        document.querySelector('.git-file[title="b.txt"]') as HTMLElement
      ).click();
      setTimeout(
        () =>
          (
            document.querySelector('.git-file[title="a.txt"]') as HTMLElement
          ).click(),
        10,
      );
    });
    await expect(diff).toContainText("AFTER_a");
    await page.locator('.git-file[title="b.txt"]').click();
    await expect(diff).toContainText("AFTER_b");
    await expect(page.locator(".monaco-diff-editor")).toHaveAttribute(
      "data-reuse-test",
      "same",
    );
    await fs.writeFile(path.join(repo, "b.txt"), `EXTERNAL_b\n${tail}`);
    await expect(diff).toContainText("EXTERNAL_b");
    await expect(diff).not.toContainText("AFTER_b");
    await page
      .getByRole("button", { name: "切换并排 / 行内 Diff", exact: true })
      .click();
    await expect(diff).toContainText("EXTERNAL_b");
    await expect(page.locator(".monaco-diff-editor")).toHaveAttribute(
      "data-reuse-test",
      "same",
    );
    expect(errors).toEqual([]);
  } finally {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    const fallback = setTimeout(() => child.kill("SIGKILL"), 5000);
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await exited;
    clearTimeout(fallback);
    await fs.rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
});

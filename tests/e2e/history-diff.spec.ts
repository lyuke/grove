import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

test("history shows committed before/after code rather than working-copy content", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "grove-history-"));
  const repo = path.join(root, "repo");
  await fs.mkdir(repo);
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args]);
  git("init", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.com");
  git("config", "commit.gpgsign", "false");
  const file = path.join(repo, "code.ts");
  await fs.writeFile(file, "export const value = 'before';\n");
  git("add", ".");
  git("commit", "-m", "initial");
  await fs.writeFile(file, "export const value = 'after';\n");
  git("commit", "-am", "change value");
  await fs.writeFile(file, "export const value = 'working-copy';\n");
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.GROVE_USER_DATA = path.join(root, "state");
  env.GROVE_TEST_PROJECT = repo;
  const app = await electron.launch({
    executablePath: process.env.GROVE_EXECUTABLE,
    args: [path.resolve(".")],
    env,
  });
  try {
    const page = await app.firstWindow();
    await page
      .getByRole("button", { name: "新建终端", exact: true })
      .first()
      .click();
    await expect(page.locator(".terminal-tab").first()).toBeVisible();
    await page.getByRole("button", { name: "最大化终端", exact: true }).click();
    await page.getByRole("button", { name: "Git 变更", exact: true }).click();
    await page.getByRole("button", { name: "历史提交", exact: true }).click();
    await page
      .locator(".history-commit")
      .filter({ hasText: "change value" })
      .click();
    await expect(
      page.locator('.diff-view[data-diff-ready="true"]'),
    ).toBeVisible({ timeout: 20000 });
    const diff = page.locator(".monaco-diff-editor");
    await expect(page.locator(".terminal-wrapper")).toBeHidden();
    await expect(diff).toContainText("'before'");
    await expect(diff).toContainText("'after'");
    await expect(diff).not.toContainText("working-copy");
    await expect(page.locator(".breadcrumbs")).toContainText("只读");
    await page.getByRole("button", { name: "切换并排 / 行内 Diff" }).click();
    await expect(diff).toContainText("'before'");
    await expect(diff).toContainText("'after'");
    await expect(
      diff
        .locator(
          ".char-delete:visible, .inline-deleted-text:visible, .line-delete:visible",
        )
        .first(),
    ).toBeVisible();
    await page.screenshot({ path: "artifacts/history-code-diff.png" });
    expect(await fs.readFile(file, "utf8")).toContain("working-copy");
  } finally {
    const exited = new Promise((resolve) =>
      app.process().once("exit", resolve),
    );
    await app.evaluate(({ app }) => app.exit(0));
    await exited;
    await fs.rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});

import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { git } from "../../electron/services";

test("discard confirms, preserves staged content and refreshes the open editor", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "grove-discard-"));
  const repo = path.join(root, "project");
  await fs.mkdir(repo);
  const file = path.join(repo, "hello.txt");
  await git(repo, ["init", "-b", "main"]);
  await git(repo, ["config", "user.name", "Grove Test"]);
  await git(repo, ["config", "user.email", "grove@example.test"]);
  await git(repo, ["config", "commit.gpgsign", "false"]);
  await git(repo, ["config", "core.hooksPath", path.join(repo, ".git/hooks")]);
  await fs.writeFile(file, "original\n");
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-m", "initial"]);
  await fs.writeFile(file, "staged\n");
  await git(repo, ["add", "."]);
  await fs.writeFile(file, "unstaged\n");
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
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].hide(),
    );
    await page.getByRole("button", { name: "hello.txt", exact: true }).click();
    await expect(page.locator(".view-lines")).toContainText("unstaged");
    await page.getByRole("button", { name: "Git 变更", exact: true }).click();
    const discard = page.getByRole("button", {
      name: "放弃更改 hello.txt",
      exact: true,
    });
    await discard.click();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    expect(await fs.readFile(file, "utf8")).toBe("unstaged\n");
    await discard.click();
    await page.getByRole("button", { name: "放弃更改", exact: true }).click();
    await expect.poll(() => fs.readFile(file, "utf8")).toBe("staged\n");
    await expect(discard).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "取消暂存 hello.txt", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".view-lines")).toContainText("staged");
    await expect(page.locator(".view-lines")).not.toContainText("unstaged");
    expect(await git(repo, ["show", ":hello.txt"])).toBe("staged\n");

    await fs.writeFile(file, "new worktree change\n");
    await expect(page.locator(".view-lines")).toContainText(
      "new worktree change",
    );
    await page.locator(".monaco-editor textarea").first().focus();
    await page.keyboard.insertText("unsaved ");
    await expect(page.getByLabel("未保存", { exact: true })).toBeVisible();
    await discard.click();
    await expect(
      page.getByText("请先保存或关闭此文件未保存的编辑，再放弃工作区更改", {
        exact: true,
      }),
    ).toBeVisible();
    expect(await fs.readFile(file, "utf8")).toBe("new worktree change\n");
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

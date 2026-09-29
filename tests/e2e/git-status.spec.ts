import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { git } from "../../electron/services";

test("Git status is available before slow login shell initialization", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "grove-git-status-"));
  const repo = path.join(root, "project");
  await fs.mkdir(repo);
  await git(repo, ["init", "-b", "main"]);
  await fs.writeFile(path.join(repo, "changed.txt"), "change");
  const slowShell = path.join(root, "slow-shell");
  await fs.writeFile(
    slowShell,
    '#!/bin/sh\n/bin/sleep 4\nprintf "\\n__GROVE_PATH__%s" "$PATH"\n',
    { mode: 0o755 },
  );
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
    GROVE_USER_DATA: path.join(root, "state"),
    GROVE_TEST_PROJECT: repo,
    SHELL: slowShell,
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
    const started = Date.now();
    const statuses = await page.evaluate(() =>
      Promise.all(
        Array.from({ length: 8 }, () => window.grove.gitStatus("test-project")),
      ),
    );
    expect(Date.now() - started).toBeLessThan(2000);
    for (const status of statuses) {
      expect(status.branch).toBe("main");
      expect(status.changes.map((c) => c.path)).toEqual(["changed.txt"]);
    }
    await page.getByRole("button", { name: "Git 变更", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "放弃更改 changed.txt", exact: true }),
    ).toBeVisible();
    await fs.writeFile(path.join(repo, "second.txt"), "another change");
    await expect(
      page.getByRole("button", { name: "放弃更改 second.txt", exact: true }),
    ).toBeVisible();
    const index = path.join(repo, ".git", "index");
    await fs.writeFile(index, "invalid index");
    await page.getByRole("button", { name: "刷新 Git", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("当前显示上次结果");
    await expect(
      page.getByRole("button", { name: "放弃更改 second.txt", exact: true }),
    ).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Git 变更", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("无法读取 Git 状态");
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("无法读取 Git 状态");
    await fs.unlink(index);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "放弃更改 second.txt", exact: true }),
    ).toBeVisible();
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

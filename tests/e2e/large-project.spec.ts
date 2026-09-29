import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { git } from "../../electron/services";

test("large file and Git lists stay bounded while scrolling, expanding and staging", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "grove-large-"));
  const repo = path.join(root, "project");
  await fs.mkdir(path.join(repo, "aaa", "nested"), { recursive: true });
  await fs.writeFile(path.join(repo, "aaa/nested/child.txt"), "nested content");
  await git(repo, ["init", "-b", "main"]);
  for (let offset = 0; offset < 2400; offset += 200) {
    await Promise.all(
      Array.from({ length: 200 }, (_, i) =>
        fs.writeFile(
          path.join(repo, `file-${String(offset + i).padStart(4, "0")}.txt`),
          `content ${offset + i}`,
        ),
      ),
    );
  }
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
    GROVE_TEST_PROJECT: repo,
    GROVE_USER_DATA: path.join(root, "state"),
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
      BrowserWindow.getAllWindows()[0].showInactive(),
    );
    const tree = page.locator(".tree-scroll");
    await page.getByRole("button", { name: "aaa", exact: true }).click();
    await page.getByRole("button", { name: "nested", exact: true }).click();
    await page.getByRole("button", { name: "child.txt", exact: true }).click();
    await expect(page.locator(".view-lines")).toContainText("nested content");
    expect(await page.locator(".tree-row").count()).toBeLessThan(100);
    await tree.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const last = tree.getByRole("button", {
      name: "file-2399.txt",
      exact: true,
    });
    await last.click();
    await expect(page.locator(".view-lines")).toContainText("content 2399");
    await last.click({ button: "right" });
    await expect(
      page.getByRole("button", { name: "在 Finder 中显示", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await last.focus();
    await page.keyboard.press("Home");
    await expect(
      page.getByRole("button", { name: "aaa", exact: true }),
    ).toBeFocused();
    await page.getByRole("button", { name: "aaa", exact: true }).click();
    await expect(
      tree.getByRole("button", { name: "child.txt", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "aaa", exact: true }).click();
    await expect(
      tree.getByRole("button", { name: "child.txt", exact: true }),
    ).toBeVisible();
    await fs.writeFile(path.join(repo, "aaa/nested/new.txt"), "new content");
    await expect(
      page.getByRole("button", { name: "new.txt", exact: true }),
    ).toBeVisible();
    await fs.unlink(path.join(repo, "aaa/nested/new.txt"));
    await expect(
      page.getByRole("button", { name: "new.txt", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Git 变更", exact: true }).click();
    await expect(page.locator(".git-row").first()).toBeVisible();
    expect(await page.locator(".git-row").count()).toBeLessThan(100);
    await page.locator(".git-scroll").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.locator('.git-file[title="file-2399.txt"]').click();
    await expect(
      page.locator('.diff-view[data-diff-ready="true"]'),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "暂存 file-2399.txt", exact: true })
      .click();
    await page.locator(".git-scroll").evaluate((el) => {
      el.scrollTop = 0;
    });
    await expect(
      page.getByRole("button", { name: "取消暂存 file-2399.txt", exact: true }),
    ).toBeVisible();
    expect(await git(repo, ["show", ":file-2399.txt"])).toBe("content 2399");
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

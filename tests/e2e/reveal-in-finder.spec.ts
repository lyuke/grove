import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("project, folder and file context actions reveal their exact paths", async () => {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "grove-reveal-")),
  );
  await fs.mkdir(path.join(root, "中文 folder"));
  await fs.writeFile(
    path.join(root, "中文 folder", "hello world.txt"),
    "hello",
  );
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
    GROVE_USER_DATA: path.join(root, "state"),
    GROVE_TEST_PROJECT: root,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath: process.env.GROVE_EXECUTABLE,
    args: [path.resolve(".")],
    env,
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow, shell }) => {
      BrowserWindow.getAllWindows()[0].hide();
      (globalThis as any).revealedPaths = [];
      shell.showItemInFolder = (target) => {
        (globalThis as any).revealedPaths.push(target);
      };
    });
    const reveal = page.getByRole("button", {
      name: "在 Finder 中显示",
      exact: true,
    });
    await page.locator(".project-select").click({ button: "right" });
    await reveal.click();
    const folder = page.getByRole("button", {
      name: "中文 folder",
      exact: true,
    });
    await folder.click({ button: "right" });
    await reveal.click();
    await folder.click();
    await page
      .getByRole("button", { name: "hello world.txt", exact: true })
      .click({ button: "right" });
    await reveal.click();
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).revealedPaths))
      .toEqual([
        root,
        path.join(root, "中文 folder"),
        path.join(root, "中文 folder", "hello world.txt"),
      ]);
    const failure = await page.evaluate(async () => {
      const settings = await window.grove.settings();
      try {
        await window.grove.revealInFinder(
          settings.projects[0].id,
          "../outside",
        );
        return "unexpected success";
      } catch (error) {
        return String(error);
      }
    });
    expect(failure).toContain("不能操作项目目录之外的文件");
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

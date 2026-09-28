import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("editor wraps long lines on resize and preserves saved text", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "grove-wrap-"));
  const content = "自动换行 long text without inserted newlines. ".repeat(20);
  const file = path.join(root, "wrap.txt");
  await fs.writeFile(file, content);
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
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].hide();
    });
    await page.getByRole("button", { name: "wrap.txt", exact: true }).click();
    const lines = page.locator(".monaco-editor .view-lines .view-line");
    await expect.poll(() => lines.count()).toBeGreaterThan(1);
    const wideCount = await lines.count();
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setSize(1000, 900);
    });
    await expect.poll(() => lines.count()).toBeGreaterThan(wideCount);
    const input = page.locator(".monaco-editor textarea").first();
    await input.focus();
    await page.keyboard.press("Meta+ArrowDown");
    await page.keyboard.insertText(" END");
    await page.keyboard.press("Meta+s");
    await expect.poll(() => fs.readFile(file, "utf8")).toBe(content + " END");
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setSize(1480, 900);
    });
    await expect.poll(() => lines.count()).toBeLessThan(wideCount + 1);
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

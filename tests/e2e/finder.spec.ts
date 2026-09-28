import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("Finder requests survive renderer startup and new-file menu creates nested files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "grove-finder-"));
  const file = path.join(root, "你好 world.txt");
  await fs.writeFile(file, "Opened from Finder\n");
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
    GROVE_USER_DATA: path.join(root, "state"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath: process.env.GROVE_EXECUTABLE,
    args: [path.resolve(".")],
    env,
  });
  try {
    // Deliver before waiting for the first page, just like a launch-time Apple event.
    await app.evaluate(({ app }, file) => {
      app.emit("open-file", { preventDefault() {} }, file);
    }, file);
    const page = await app.firstWindow();
    await expect(page.locator(".view-lines")).toContainText(
      "Opened from Finder",
      { timeout: 20000 }, // Allow first-run Rosetta translation of Monaco.
    );
    await app.evaluate(({ app }, file) => {
      app.emit("open-file", { preventDefault() {} }, file);
    }, file);
    await expect(page.locator(".file-tab")).toHaveCount(1);
    await app.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu()!
        .items.find((i) => i.label === "文件")!
        .submenu!.items.find((i) => i.label === "新建文件…")!;
      item.click();
    });
    await page
      .getByRole("textbox", { name: "新建文件", exact: true })
      .fill("nested/deep/new.txt");
    await page.getByRole("button", { name: "确定", exact: true }).click();
    await expect(
      page.locator(".file-tab").filter({ hasText: "new.txt" }),
    ).toBeVisible();
    expect(
      await fs.readFile(path.join(root, "nested/deep/new.txt"), "utf8"),
    ).toBe("");
    await app.evaluate(
      ({ app }, file) => {
        app.emit("open-file", { preventDefault() {} }, file);
      },
      path.join(root, "missing.txt"),
    );
    await expect(page.getByText(/无法打开.*missing.txt/)).toBeVisible();
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

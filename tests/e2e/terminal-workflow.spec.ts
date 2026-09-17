import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("terminal shortcut, docking, bottom visibility and command-click links", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "grove-terminal-"));
  const project = path.join(root, "project");
  await fs.mkdir(project);
  await fs.writeFile(path.join(project, "hello.txt"), "Terminal integration\n");
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  Object.assign(env, {
    GROVE_USER_DATA: path.join(root, "state"),
    GROVE_TEST_PROJECT: project,
  });
  const app = await electron.launch({
    executablePath: process.env.GROVE_EXECUTABLE,
    args: [path.resolve(".")],
    env,
  });
  const child = app.process();
  const errors: string[] = [];
  try {
    const page = await app.firstWindow();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.getByRole("button", { name: "hello.txt", exact: true }).click();
    await expect(page.locator(".view-lines")).toContainText(
      "Terminal integration",
    );
    await page.keyboard.press("Control+Backquote");
    const input = page.locator(".xterm-helper-textarea");
    await expect(input).toBeVisible();
    const sessions = await page.evaluate(() => window.grove.terminalList());
    const id = sessions[0].id;
    await page
      .getByRole("button", { name: "设置终端快捷键", exact: true })
      .first()
      .click();
    await page
      .getByRole("textbox", { name: "终端快捷键", exact: true })
      .fill("Command+J");
    await page.getByRole("button", { name: "确定", exact: true }).click();
    await expect
      .poll(() =>
        app.evaluate(
          ({ Menu }) =>
            Menu.getApplicationMenu()!.getMenuItemById("toggle-terminal")!
              .accelerator,
        ),
      )
      .toBe("Command+J");
    await page.getByRole("button", { name: "收起终端", exact: true }).click();
    await expect(input).toBeHidden();
    await page.keyboard.press("Meta+j");
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
    await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      contents.sendInputEvent({
        type: "keyDown",
        keyCode: "J",
        modifiers: ["meta"],
      });
      contents.sendInputEvent({
        type: "keyUp",
        keyCode: "J",
        modifiers: ["meta"],
      });
    });
    await expect(input).toBeHidden();
    await page.keyboard.press("Meta+j");
    await expect(input).toBeVisible();

    await page.evaluate(
      (id) =>
        window.grove.terminalWrite(
          id,
          "for i in {1..800}; do printf 'ROW_%s\\n' $i; done; printf 'GROVE_BOTTOM_MARKER\\n'\r",
        ),
      id,
    );
    const rows = page.locator(".xterm-rows");
    const bottomMarker = page
      .locator(".xterm-rows > div")
      .filter({ hasText: /^GROVE_BOTTOM_MARKER\s*$/ });
    await expect(bottomMarker).toBeVisible();
    const checkFits = async () => {
      await expect(bottomMarker).toBeVisible();
      await expect
        .poll(async () => {
          const screen = (await page.locator(".xterm-screen").boundingBox())!;
          const host = (await page.locator(".terminal-surface").boundingBox())!;
          return screen.y + screen.height <= host.y + host.height + 1;
        })
        .toBe(true);
    };
    await checkFits();
    await page.getByRole("button", { name: "停靠到右侧", exact: true }).click();
    await expect(page.locator(".editor-stack.dock-right")).toBeVisible();
    await checkFits();
    const widthBefore = (await page.locator(".terminal-wrapper").boundingBox())!
      .width;
    const handle = (await page
      .getByRole("separator", { name: "调整终端宽度" })
      .boundingBox())!;
    await page.mouse.move(handle.x + 2, handle.y + 100);
    await page.mouse.down();
    await page.mouse.move(handle.x - 48, handle.y + 100, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(async () =>
        Math.round(
          (await page.locator(".terminal-wrapper").boundingBox())!.width,
        ),
      )
      .toBe(Math.round(widthBefore + 50));
    await page
      .getByRole("button", { name: "放大终端字体", exact: true })
      .click();
    await checkFits();
    await fs.mkdir("artifacts", { recursive: true });
    await page.screenshot({ path: "artifacts/terminal-right.png" });
    const viewport = page.locator(".xterm-viewport");
    const viewportBox = (await viewport.boundingBox())!;
    await page.mouse.move(viewportBox.x + 50, viewportBox.y + 50);
    await page.mouse.wheel(0, -100000);
    await expect(rows).toContainText("ROW_1ROW_2");
    await expect.poll(() => viewport.evaluate((el) => el.scrollTop)).toBe(0);
    await page
      .getByRole("button", { name: "缩小终端字体", exact: true })
      .click();
    await expect(rows).toContainText("ROW_1ROW_2");
    await page
      .getByRole("button", { name: "放大终端字体", exact: true })
      .click();
    await expect(rows).toContainText("ROW_1ROW_2");
    await page.getByRole("button", { name: "滚动到底部", exact: true }).click();
    await expect
      .poll(() =>
        viewport.evaluate((el) =>
          Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop),
        ),
      )
      .toBeLessThan(2);
    await expect(bottomMarker).toBeVisible();

    const grip = (await page
      .getByTitle("拖动终端到右侧或下方", { exact: true })
      .boundingBox())!;
    await page.mouse.move(grip.x + 10, grip.y + 8);
    await page.mouse.down();
    await page.mouse.move(grip.x + 30, grip.y + 15, { steps: 5 });
    await expect(page.getByTestId("dock-bottom")).toBeVisible();
    const target = (await page.getByTestId("dock-bottom").boundingBox())!;
    await page.mouse.move(
      target.x + target.width / 2,
      target.y + target.height / 2,
      { steps: 10 },
    );
    await page.mouse.up();
    await expect(page.locator(".editor-stack.dock-bottom")).toBeVisible();
    expect((await page.evaluate(() => window.grove.terminalList()))[0].id).toBe(
      id,
    );
    await checkFits();

    await app.evaluate(({ shell }) => {
      (globalThis as any).__openedLinks = [];
      shell.openExternal = async (url) => {
        (globalThis as any).__openedLinks.push(url);
      };
    });
    await page.evaluate(
      (id) =>
        window.grove.terminalWrite(
          id,
          "printf '\\nhttps://example.com/grove-link-check\\n'\r",
        ),
      id,
    );
    const linkRow = page
      .locator(".xterm-rows > div")
      .filter({ hasText: /^https:\/\/example.com\/grove-link-check$/ })
      .last();
    await expect(linkRow).toBeVisible();
    await linkRow.click({ position: { x: 60, y: 8 } });
    expect(await app.evaluate(() => (globalThis as any).__openedLinks)).toEqual(
      [],
    );
    await linkRow.click({ position: { x: 60, y: 8 }, modifiers: ["Meta"] });
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).__openedLinks))
      .toEqual(["https://example.com/grove-link-check"]);
    expect(
      await page.evaluate(() =>
        window.grove.openExternal("file:///etc/passwd").then(
          () => false,
          () => true,
        ),
      ),
    ).toBe(true);
    await expect
      .poll(() => page.evaluate(() => window.grove.settings()))
      .toMatchObject({
        terminalDock: "bottom",
        terminalShortcut: "Command+J",
        terminalFontSize: 13,
      });
    await page.reload();
    await expect(input).toBeVisible();
    await expect(page.locator(".terminal-shortcut")).toContainText("⌘ J");
    expect((await page.evaluate(() => window.grove.terminalList()))[0].id).toBe(
      id,
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

import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

for (const prefix of [
  "ASCII ",
  "中文 ",
  "😀🚀📁 ",
  "\ue0b0\uf07b ",
  "󰀵 dev  ",
  "é ",
  "👩‍💻 ",
]) {
  test(`terminal mouse selection follows rendered character positions ${prefix}`, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "grove-selection-"));
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    Object.assign(env, {
      GROVE_USER_DATA: path.join(root, "state"),
      GROVE_TEST_PROJECT: root,
    });
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
      await expect(page.locator(".xterm-helper-textarea")).toBeVisible();
      const id = (await page.evaluate(() => window.grove.terminalList()))[0].id;
      const content = prefix + "TARGET_SELECTION 0123456789";
      await page.evaluate(
        ({ id, content }) =>
          window.grove.terminalWrite(
            id,
            `printf '\\033[2J\\033[H${content}\\r\\n${content}\\r\\n'\r`,
          ),
        { id, content },
      );
      const row = page
        .locator(".xterm-rows > div")
        .filter({ hasText: new RegExp(`^${content}$`) })
        .first();
      await expect(row).toBeVisible();
      const checkSelection = async () => {
        await expect(row).toBeVisible();
        for (const start of [
          content.indexOf("TARGET"),
          content.indexOf("0123456789"),
        ]) {
          const end = start + 8;
          const points = await row.evaluate(
            (el, { start, end }) => {
              const walker = document.createTreeWalker(
                el,
                NodeFilter.SHOW_TEXT,
              );
              const boxes: {
                x: number;
                y: number;
                width: number;
                height: number;
              }[] = [];
              while (walker.nextNode()) {
                const node = walker.currentNode;
                for (let i = 0; i < (node.textContent?.length || 0); i++) {
                  const range = document.createRange();
                  range.setStart(node, i);
                  range.setEnd(node, i + 1);
                  const r = range.getBoundingClientRect();
                  boxes.push({
                    x: r.x,
                    y: r.y,
                    width: r.width,
                    height: r.height,
                  });
                }
              }
              return { start: boxes[start], end: boxes[end] };
            },
            { start, end },
          );
          await page.mouse.move(
            points.start.x + 0.1,
            points.start.y + points.start.height / 2,
          );
          await page.mouse.down();
          await page.mouse.move(
            points.end.x + 0.1,
            points.end.y + points.end.height / 2,
            { steps: 10 },
          );
          await page.mouse.up();
          const selected = await page.locator(".xterm").evaluate((el) => {
            const data = new DataTransfer();
            el.dispatchEvent(
              new ClipboardEvent("copy", {
                clipboardData: data,
                bubbles: true,
                cancelable: true,
              }),
            );
            return data.getData("text/plain");
          });
          expect(selected, `visual columns ${start}..${end}`).toBe(
            content.slice(start, end),
          );
        }
      };
      await checkSelection();
      if (prefix.includes("👩")) {
        for (let n = 0; n < 3; n++)
          await page
            .getByRole("button", { name: "放大终端字体", exact: true })
            .click();
        await checkSelection();
        await page
          .getByRole("button", { name: "停靠到右侧", exact: true })
          .click();
        await checkSelection();
        await page
          .getByRole("button", { name: "收起终端", exact: true })
          .click();
        await page.keyboard.press("Control+Backquote");
        await checkSelection();
        await page.evaluate(
          ({ id, content }) =>
            window.grove.terminalWrite(
              id,
              `for i in {1..80}; do printf '${content}\\r\\n'; done\r`,
            ),
          { id, content },
        );
        const viewport = page.locator(".xterm-viewport");
        await expect
          .poll(() => viewport.evaluate((el) => el.scrollHeight))
          .toBeGreaterThan(1000);
        await page.locator(".xterm-screen").hover();
        await page.mouse.wheel(0, -400);
        await expect
          .poll(() =>
            viewport.evaluate(
              (el) => el.scrollTop < el.scrollHeight - el.clientHeight - 100,
            ),
          )
          .toBe(true);
        await checkSelection();
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.25),
        );
        await checkSelection();
      }
      if (prefix.includes("\ue0b0")) {
        await expect
          .poll(() =>
            page.evaluate(() => {
              let loaded = false;
              document.fonts.forEach((font) => {
                if (
                  font.family.replaceAll('"', "") === "Grove Symbols" &&
                  font.status === "loaded"
                )
                  loaded = true;
              });
              return loaded;
            }),
          )
          .toBe(true);
        const client = await page.context().newCDPSession(page);
        await client.send("DOM.enable");
        await client.send("CSS.enable");
        await row.evaluate((el) => el.setAttribute("data-font-test", "icons"));
        const { root: documentRoot } = await client.send("DOM.getDocument");
        const { nodeId } = await client.send("DOM.querySelector", {
          nodeId: documentRoot.nodeId,
          selector: '[data-font-test="icons"]',
        });
        const { fonts } = await client.send("CSS.getPlatformFontsForNode", {
          nodeId,
        });
        expect(
          fonts.some(
            (font) =>
              font.isCustomFont &&
              font.glyphCount > 0 &&
              font.familyName.includes("Symbols"),
          ),
        ).toBe(true);
        await page.screenshot({ path: "artifacts/terminal-icons.png" });
        await client.detach();
      }
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
}

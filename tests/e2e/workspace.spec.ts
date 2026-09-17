import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
let application: ElectronApplication, page: Page, root: string;
const errors: string[] = [];
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "grove-e2e-"));
  const repo = path.join(root, "project");
  await fs.mkdir(repo);
  await fs.writeFile(path.join(repo, "hello.txt"), "Hello Grove\n");
  await fs.mkdir(path.join(repo, "src"));
  await fs.writeFile(
    path.join(repo, "src/main.ts"),
    'export const greeting = "Hello Grove";\n',
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
  application = await electron.launch({
    executablePath: process.env.GROVE_EXECUTABLE,
    args: [path.resolve(".")],
    env,
  });
  page = await application.firstWindow();
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  await expect(page.getByText("让想法，生长为作品。")).toBeVisible();
});
test.afterAll(async () => {
  if (application && !page.isClosed()) {
    const exited = new Promise((resolve) =>
      application.process().once("exit", resolve),
    );
    await application.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await exited;
  }
  if (root)
    await fs.rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
});

test("edit, save, external conflict, search, Git commit and interactive PTY", async () => {
  await fs.mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/welcome-dark.png" });
  await page.getByRole("button", { name: "hello.txt", exact: true }).click();
  const input = page.locator(".monaco-editor textarea").first();
  await expect(input).toBeVisible();
  await input.focus();
  // Selecting text must survive cursor-position persistence in React.
  await page.keyboard.press("Meta+ArrowRight");
  await page.keyboard.press("Meta+Shift+ArrowLeft");
  await expect(page.locator(".selected-text").first()).toBeVisible();
  await page.keyboard.type("Hello Grove");
  await page.keyboard.press("Meta+s");
  await expect
    .poll(() => fs.readFile(path.join(root, "project/hello.txt"), "utf8"))
    .toBe("Hello Grove\n");
  const line = page.locator(".view-lines .view-line").first();
  const bounds = await line.boundingBox();
  await page.mouse.move(bounds!.x + 1, bounds!.y + 10);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + 39, bounds!.y + 10, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator(".selected-text").first()).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Meta+ArrowDown");
  await page.keyboard.type("Edited in Grove\n");
  await page.keyboard.press("Meta+s");
  await expect
    .poll(() => fs.readFile(path.join(root, "project/hello.txt"), "utf8"))
    .toContain("Edited in Grove");
  await input.focus();
  await page.keyboard.press("Meta+ArrowDown");
  await page.keyboard.type("My unsaved change\n");
  await fs.writeFile(
    path.join(root, "project/hello.txt"),
    "Changed by agent\n",
  );
  await expect(
    page.getByText("磁盘文件已被修改，当前编辑内容已保留。"),
  ).toBeVisible();
  await page.getByRole("button", { name: "比较", exact: true }).click();
  await expect(page.locator(".monaco-diff-editor")).toBeVisible();
  await page.getByRole("button", { name: "保留我的修改", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保留我的修改", exact: true })
    .click();
  await expect(
    page.getByText("磁盘文件已被修改，当前编辑内容已保留。"),
  ).toHaveCount(0);
  await expect(input).toBeVisible();
  await input.focus();
  await page.keyboard.press("Meta+s");
  await expect
    .poll(() => fs.readFile(path.join(root, "project/hello.txt"), "utf8"))
    .toContain("My unsaved change");
  await page.getByRole("button", { name: "项目搜索", exact: true }).click();
  await page.getByRole("textbox", { name: "搜索项目内容" }).fill("Hello Grove");
  await expect(page.locator(".search-result")).toHaveCount(2);
  await page.getByRole("button", { name: "Git 变更", exact: true }).click();
  await page.locator(".git-file").filter({ hasText: "hello.txt" }).click();
  await expect(page.locator(".monaco-diff-editor")).toBeVisible();
  await page
    .getByRole("button", { name: "暂存 hello.txt", exact: true })
    .click();
  // Staging closes the diff and remounts the editor. Wait for that transition
  // before entering the message, especially under Rosetta.
  await expect(
    page.getByRole("button", { name: "取消暂存 hello.txt", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".monaco-diff-editor")).toHaveCount(0);
  await expect(input).toBeVisible();
  await page
    .getByRole("textbox", { name: "提交信息" })
    .fill("Edit greeting from Grove");
  await expect(page.getByRole("textbox", { name: "提交信息" })).toHaveValue(
    "Edit greeting from Grove",
  );
  await page
    .getByRole("button", { name: "提交暂存内容 · 1", exact: true })
    .click();
  await expect(page.getByText("工作区干净", { exact: true })).toBeVisible();
  expect(
    execFileSync(
      "git",
      ["-C", path.join(root, "project"), "log", "-1", "--format=%s"],
      { encoding: "utf8" },
    ).trim(),
  ).toBe("Edit greeting from Grove");
  await page
    .getByRole("button", { name: "新建终端", exact: true })
    .first()
    .click();
  await expect(page.locator(".xterm-helper-textarea")).toBeVisible();
  const sessions = await page.evaluate(() => window.grove.terminalList());
  await page.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type("printf 'GROVE_PTY_OK\\n'\n");
  await expect
    .poll(() =>
      page.evaluate((id) => window.grove.terminalAttach(id), sessions[0].id),
    )
    .toMatch(/GROVE_PTY_OK\r?\n/);
  await page.getByRole("button", { name: "文件", exact: true }).click();
  await page.screenshot({ path: "artifacts/workspace-dark.png" });
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  await expect(page.locator(".theme-light")).toBeVisible();
  await page.screenshot({ path: "artifacts/workspace-light.png" });
  expect(errors).toEqual([]);
});

test("project CRUD, file creation and rename, terminal isolation, and workspace restore", async () => {
  const second = path.join(root, "another-project");
  await fs.mkdir(second);
  await application.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [directory],
    })) as typeof dialog.showOpenDialog;
  }, second);
  await page.getByRole("button", { name: "添加本地项目", exact: true }).click();
  await expect(page.locator(".project-row")).toHaveCount(2);
  await expect(page.locator(".terminal-empty")).toBeVisible();
  await page.getByRole("button", { name: "添加本地项目", exact: true }).click();
  await expect(page.locator(".project-row")).toHaveCount(2);
  await page
    .getByRole("button", { name: "another-project 项目设置", exact: true })
    .click();
  await page.getByRole("button", { name: "修改显示名称", exact: true }).click();
  await page
    .getByRole("textbox", { name: "修改项目名称", exact: true })
    .fill("第二个项目");
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await expect(
    page.locator(".project-select strong").filter({ hasText: "第二个项目" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "新建文件", exact: true }).click();
  await page
    .getByRole("textbox", { name: "新建文件", exact: true })
    .fill("note.md");
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await expect(
    page.locator(".file-tab").filter({ hasText: "note.md" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "note.md 操作", exact: true }).click();
  await page
    .getByRole("button", { name: "重命名 / 移动", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "重命名 / 移动", exact: true })
    .fill("renamed.md");
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await expect(
    page.locator(".file-tab").filter({ hasText: "renamed.md" }),
  ).toBeVisible();
  expect(await fs.readFile(path.join(second, "renamed.md"), "utf8")).toBe("");
  await page
    .locator(".project-select")
    .filter({ hasText: "Test project" })
    .click();
  await expect(page.locator(".xterm-helper-textarea")).toBeVisible();
  const sessions = await page.evaluate(() => window.grove.terminalList());
  expect(sessions[0].projectId).toBe("test-project");
  await page.evaluate(
    (id) => window.grove.terminalWrite(id, "printf 'CWD:%s\\n' \"$PWD\"\r"),
    sessions[0].id,
  );
  await expect
    .poll(() =>
      page.evaluate((id) => window.grove.terminalAttach(id), sessions[0].id),
    )
    .toContain(`CWD:${await fs.realpath(path.join(root, "project"))}`);
  await expect
    .poll(
      async () =>
        JSON.parse(
          await fs.readFile(path.join(root, "state/workspace.json"), "utf8"),
        ).workspaces["test-project"].tabs,
    )
    .toContain("hello.txt");
  await expect
    .poll(
      async () =>
        JSON.parse(
          await fs.readFile(path.join(root, "state/workspace.json"), "utf8"),
        ).activeProject,
    )
    .toBe("test-project");
  await expect
    .poll(async () => {
      const saved = JSON.parse(
        await fs.readFile(path.join(root, "state/workspace.json"), "utf8"),
      );
      return Object.values(
        saved.workspaces as Record<string, { tabs: string[] }>,
      ).some((workspace) => workspace.tabs.includes("renamed.md"));
    })
    .toBe(true);
  // Reload only the renderer to verify persisted tabs/theme and reconnection to the existing PTY.
  await page.reload();
  await expect(
    page.locator(".file-tab").filter({ hasText: "hello.txt" }),
  ).toBeVisible();
  await expect(page.locator(".theme-light")).toBeVisible();
  await expect(page.locator(".xterm-helper-textarea")).toBeVisible();
  await page
    .locator(".project-select")
    .filter({ hasText: "第二个项目" })
    .click();
  await expect(
    page.locator(".file-tab").filter({ hasText: "renamed.md" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "第二个项目 项目设置", exact: true })
    .click();
  await page.getByRole("button", { name: "从列表移除", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "移除项目", exact: true })
    .click();
  await expect(page.locator(".project-row")).toHaveCount(1);
  expect(await fs.readFile(path.join(second, "renamed.md"), "utf8")).toBe("");
  expect(errors).toEqual([]);
});

test("failed commit preserves the message and staged files", async () => {
  const repo = path.join(root, "project");
  await fs.writeFile(path.join(repo, "hello.txt"), "Hook failure test\n");
  await fs.writeFile(
    path.join(repo, ".git/hooks/pre-commit"),
    '#!/bin/sh\necho "GROVE_HOOK_REJECTED" >&2\nexit 1\n',
    { mode: 0o755 },
  );
  await page.getByRole("button", { name: "Git 变更", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "暂存 hello.txt", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "暂存 hello.txt", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "提交信息" })
    .fill("Preserve this message");
  await page
    .getByRole("button", { name: "提交暂存内容 · 1", exact: true })
    .click();
  await expect(page.locator(".toast[role=alert]")).toContainText(
    "GROVE_HOOK_REJECTED",
  );
  await expect(page.getByRole("textbox", { name: "提交信息" })).toHaveValue(
    "Preserve this message",
  );
  await expect(
    page.getByRole("button", { name: "取消暂存 hello.txt", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("larger directory, multiple terminals, sustained output and compact layout", async () => {
  const folder = path.join(root, "project/many-files");
  await fs.mkdir(folder);
  await Promise.all(
    Array.from({ length: 1200 }, (_, index) =>
      fs.writeFile(
        path.join(folder, `file-${index}.txt`),
        `large directory item ${index}\n`,
      ),
    ),
  );
  const files = await page.evaluate(() =>
    window.grove.listFiles("test-project", "many-files"),
  );
  expect(files).toHaveLength(1200);
  const hits = await page.evaluate(() =>
    window.grove.search("test-project", "large directory item 1199", false),
  );
  expect(hits[0].path).toBe("many-files/file-1199.txt");
  await page
    .getByRole("button", { name: "新建终端", exact: true })
    .first()
    .click();
  await expect(page.locator(".terminal-tab")).toHaveCount(2);
  const sessions = await page.evaluate(() => window.grove.terminalList());
  await page.evaluate(
    (id) =>
      window.grove.terminalWrite(
        id,
        "printf '%s\\n' {1..10000}; printf 'GROVE_%s\\n' LOAD_DONE\r",
      ),
    sessions[1].id,
  );
  await expect
    .poll(
      () =>
        page.evaluate((id) => window.grove.terminalAttach(id), sessions[1].id),
      { timeout: 20000 },
    )
    .toContain("GROVE_LOAD_DONE");
  await page.getByRole("button", { name: "文件", exact: true }).click();
  await page.getByRole("button", { name: "src", exact: true }).click();
  await page.locator('.tree-item[title="src/main.ts"]').click();
  await expect(
    page.locator(".file-tab").filter({ hasText: "main.ts" }),
  ).toBeVisible();
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1000, 680),
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.querySelector(".terminal-wrapper")!.getBoundingClientRect()
            .right <=
          innerWidth + 1,
      ),
    )
    .toBe(true);
  await page.screenshot({ path: "artifacts/workspace-compact.png" });
  expect(errors).toEqual([]);
});

test("cold restart restores saved files and theme without reviving terminal processes", async () => {
  await expect
    .poll(
      async () =>
        JSON.parse(
          await fs.readFile(path.join(root, "state/workspace.json"), "utf8"),
        ).workspaces["test-project"].active,
    )
    .toBe("src/main.ts");
  const exited = new Promise((resolve) =>
    application.process().once("exit", resolve),
  );
  await application.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await exited;
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
    GROVE_USER_DATA: path.join(root, "state"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.GROVE_TEST_PROJECT;
  application = await electron.launch({
    executablePath: process.env.GROVE_EXECUTABLE,
    args: [path.resolve(".")],
    env,
  });
  page = await application.firstWindow();
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  await expect(page.locator(".file-tab.active")).toContainText("main.ts");
  await expect(page.locator(".theme-light")).toBeVisible();
  expect(await page.evaluate(() => window.grove.terminalList())).toEqual([]);
  expect(errors).toEqual([]);
});

test("bottom terminal resizes, zooms, maximizes and restores without restarting its session", async () => {
  const panel = page.locator(".terminal-wrapper");
  const editor = page.getByRole("region", { name: "编辑区" });
  const before = await panel.boundingBox();
  const editorBounds = await editor.boundingBox();
  expect(before!.y).toBeGreaterThanOrEqual(
    editorBounds!.y + editorBounds!.height,
  );
  expect(Math.abs(before!.width - editorBounds!.width)).toBeLessThan(2);

  await page
    .getByRole("button", { name: "新建终端", exact: true })
    .first()
    .click();
  await expect(page.locator(".xterm-helper-textarea")).toBeVisible();
  const sessions = await page.evaluate(() => window.grove.terminalList());
  const id = sessions[0].id;
  const separator = page.getByRole("separator", { name: "调整终端高度" });
  const handle = await separator.boundingBox();
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + 2);
  await page.mouse.down();
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y - 78, {
    steps: 8,
  });
  await page.mouse.up();
  await expect
    .poll(async () => Math.round((await panel.boundingBox())!.height))
    .toBe(Math.round(before!.height + 80));
  const resized = (await panel.boundingBox())!.height;

  await page.getByRole("button", { name: "放大终端字体", exact: true }).click();
  await page.getByRole("button", { name: "放大终端字体", exact: true }).click();
  await expect(page.locator(".terminal-font-size")).toHaveText("14");
  await page.getByRole("button", { name: "最大化终端", exact: true }).click();
  await expect(editor).toBeHidden();
  await expect
    .poll(async () => (await panel.boundingBox())!.height)
    .toBeGreaterThan(resized + 100);
  await page.evaluate(
    (id) => window.grove.terminalWrite(id, "printf 'LAYOUT_%s\\n' ALIVE\r"),
    id,
  );
  await expect
    .poll(() => page.evaluate((id) => window.grove.terminalAttach(id), id))
    .toContain("LAYOUT_ALIVE");
  await expect
    .poll(
      async () =>
        JSON.parse(
          await fs.readFile(path.join(root, "state/workspace.json"), "utf8"),
        ).terminalMaximized,
    )
    .toBe(true);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "还原终端", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".terminal-font-size")).toHaveText("14");
  expect((await page.evaluate(() => window.grove.terminalList()))[0].id).toBe(
    id,
  );
  await page.getByRole("button", { name: "还原终端", exact: true }).click();
  await expect(editor).toBeVisible();
  await expect
    .poll(async () => (await panel.boundingBox())!.height)
    .toBe(resized);
  await page.getByRole("button", { name: "收起终端", exact: true }).click();
  await expect(panel).toBeHidden();
  await expect(editor).toBeVisible();
  await page.getByRole("button", { name: "切换终端面板", exact: true }).click();
  await expect(panel).toBeVisible();
  await page.getByRole("button", { name: "缩小终端字体", exact: true }).click();
  await expect(page.locator(".terminal-font-size")).toHaveText("13");
  await page.locator(".terminal-font-size").click();
  await expect(page.locator(".terminal-font-size")).toHaveText("12");
  await page.screenshot({ path: "artifacts/terminal-bottom-light.png" });
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  await page.screenshot({ path: "artifacts/terminal-bottom-dark.png" });
  expect(errors).toEqual([]);
});

test("save all, cancel quit, save failure protection and save before quit", async () => {
  const input = page.locator(".monaco-editor textarea").first();
  await input.focus();
  await page.keyboard.press("Meta+ArrowDown");
  await page.keyboard.type("\n// SAVE_ALL_MAIN\n");
  await page.locator(".file-tab").filter({ hasText: "hello.txt" }).click();
  await input.focus();
  await page.keyboard.press("Meta+ArrowDown");
  await page.keyboard.type("SAVE_ALL_HELLO\n");
  await application.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu()!
      .items.find((item) => item.label === "文件")!
      .submenu!.items.find((item) => item.label === "全部保存")!;
    item.click();
  });
  await expect
    .poll(() => fs.readFile(path.join(root, "project/hello.txt"), "utf8"))
    .toContain("SAVE_ALL_HELLO");
  await expect
    .poll(() => fs.readFile(path.join(root, "project/src/main.ts"), "utf8"))
    .toContain("SAVE_ALL_MAIN");
  await input.focus();
  await page.keyboard.type("SAVE_ON_QUIT\n");
  await application.evaluate(({ dialog, BrowserWindow }) => {
    dialog.showMessageBoxSync = (() => 0) as typeof dialog.showMessageBoxSync;
    BrowserWindow.getAllWindows()[0].close();
  });
  expect(page.isClosed()).toBe(false);
  expect(
    await fs.readFile(path.join(root, "project/hello.txt"), "utf8"),
  ).not.toContain("SAVE_ON_QUIT");
  await fs.writeFile(
    path.join(root, "project/hello.txt"),
    "external changes\n",
  );
  await expect(
    page.getByText("磁盘文件已被修改，当前编辑内容已保留。"),
  ).toBeVisible();
  await application.evaluate(({ dialog, BrowserWindow }) => {
    dialog.showMessageBoxSync = (() => 1) as typeof dialog.showMessageBoxSync;
    BrowserWindow.getAllWindows()[0].close();
  });
  await expect(
    page.getByText("磁盘文件已更改，请比较并处理外部修改后再保存", {
      exact: true,
    }),
  ).toBeVisible();
  expect(page.isClosed()).toBe(false);
  expect(await fs.readFile(path.join(root, "project/hello.txt"), "utf8")).toBe(
    "external changes\n",
  );
  await page.getByRole("button", { name: "保留我的修改", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保留我的修改", exact: true })
    .click();
  await expect(
    page.getByText("磁盘文件已被修改，当前编辑内容已保留。"),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "放大终端字体", exact: true }).click();
  const exited = new Promise((resolve) =>
    application.process().once("exit", resolve),
  );
  await application.evaluate(({ app }) => app.quit()).catch(() => {});
  await exited;
  expect(
    await fs.readFile(path.join(root, "project/hello.txt"), "utf8"),
  ).toContain("SAVE_ON_QUIT");
  const saved = JSON.parse(
    await fs.readFile(path.join(root, "state/workspace.json"), "utf8"),
  );
  expect(saved.terminalFontSize).toBe(13);
  expect(saved.workspaces["test-project"].active).toBe("hello.txt");
  expect(errors).toEqual([]);
});

test("discard on quit preserves disk content and clean quit flushes layout", async () => {
  for (const discard of [true, false]) {
    const env: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      ),
      GROVE_USER_DATA: path.join(root, "state"),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.GROVE_TEST_PROJECT;
    application = await electron.launch({
      executablePath: process.env.GROVE_EXECUTABLE,
      args: [path.resolve(".")],
      env,
    });
    page = await application.firstWindow();
    page.on("pageerror", (error) => errors.push(error.stack || error.message));
    await expect(page.locator(".file-tab.active")).toContainText("hello.txt");
    const before = await fs.readFile(
      path.join(root, "project/hello.txt"),
      "utf8",
    );
    if (discard) {
      const input = page.locator(".monaco-editor textarea").first();
      await input.focus();
      await page.keyboard.type("DISCARD_THIS_TEXT");
      await application.evaluate(({ dialog }) => {
        dialog.showMessageBoxSync = (() =>
          2) as typeof dialog.showMessageBoxSync;
      });
    } else {
      await application.evaluate(({ dialog }) => {
        dialog.showMessageBoxSync = (() => {
          throw new Error("Clean quit must not prompt");
        }) as typeof dialog.showMessageBoxSync;
      });
    }
    await page
      .getByRole("button", { name: "放大终端字体", exact: true })
      .click();
    const exited = new Promise((resolve) =>
      application.process().once("exit", resolve),
    );
    await application
      .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
      .catch(() => {});
    await exited;
    expect(
      await fs.readFile(path.join(root, "project/hello.txt"), "utf8"),
    ).toBe(before);
    const saved = JSON.parse(
      await fs.readFile(path.join(root, "state/workspace.json"), "utf8"),
    );
    expect(saved.terminalFontSize).toBe(discard ? 14 : 15);
  }
  expect(errors).toEqual([]);
});

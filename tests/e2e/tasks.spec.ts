import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaults } from "../../electron/services";

test("palette import, agent assignment, completion alerts and persisted task history", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "grove-task-ui-"));
  const state = path.join(root, "state");
  await fs.mkdir(state);
  await fs.writeFile(
    path.join(state, "workspace.json"),
    JSON.stringify({
      ...defaults(),
      projects: [
        { id: "local", name: "本地项目", path: root },
        {
          id: "remote",
          name: "远端项目",
          path: "/work/project",
          remoteId: "ssh",
        },
      ],
      activeProject: "local",
      remotes: [{ id: "ssh", name: "Devbox", host: "localhost" }],
    }),
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.GROVE_USER_DATA = state;
  const app = await electron.launch({
    executablePath: process.env.GROVE_EXECUTABLE,
    args: [path.resolve(".")],
    env,
  });
  try {
    await app.evaluate(({ shell, Notification }) => {
      (globalThis as any).taskAlerts = { sounds: 0, notifications: 0 };
      shell.beep = () => {
        (globalThis as any).taskAlerts.sounds++;
      };
      Notification.prototype.show = function () {
        (globalThis as any).taskAlerts.notifications++;
      };
    });
    const page = await app.firstWindow();
    await expect(
      page.getByRole("complementary", { name: "任务系统" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByLabel("导入配色 JSON").setInputFiles({
      name: "colors.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          version: 1,
          theme: "dark",
          colors: { local: "#66cc99", remote: "#ffbb55" },
        }),
      ),
    });
    await expect(page.getByRole("status")).toContainText("已导入 colors.json");
    await expect(page.locator(".project-row.local-project")).toHaveCSS(
      "border-left-color",
      "rgb(102, 204, 153)",
    );
    await expect(page.locator(".project-row.remote-project")).toHaveCSS(
      "border-left-color",
      "rgb(255, 187, 85)",
    );
    await page.getByLabel("导入配色 JSON").setInputFiles({
      name: "invalid.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        '{"version":1,"theme":"dark","colors":{"local":"invalid"}}',
      ),
    });
    await expect(page.getByRole("status")).toContainText("必须是");
    await expect(page.locator(".project-row.local-project")).toHaveCSS(
      "border-left-color",
      "rgb(102, 204, 153)",
    );
    await page
      .getByRole("button", { name: "任务与 Agent", exact: true })
      .click();
    await page.getByRole("button", { name: "添加 Agent", exact: true }).click();
    await page.getByLabel("Agent 名称", { exact: true }).fill("测试 Agent");
    await page
      .getByLabel("可执行程序", { exact: true })
      .fill("/usr/bin/printf");
    await page.getByLabel("参数 1", { exact: true }).fill("%s");
    await page.getByRole("button", { name: "添加参数", exact: true }).click();
    await page.getByLabel("参数 2", { exact: true }).fill("{prompt}");
    await page.getByRole("button", { name: "保存 Agent 配置" }).click();
    await expect(page.getByRole("status")).toContainText("Agent 配置已保存");
    await page.getByRole("button", { name: "关闭设置" }).click();
    await page.getByRole("button", { name: "创建任务", exact: true }).click();
    await page.getByLabel("任务标题", { exact: true }).fill("验证任务闭环");
    await page.getByLabel("执行项目", { exact: true }).selectOption("remote");
    await expect(page.locator(".task-form .task-target")).toContainText(
      "localhost:/work/project",
    );
    await page.getByLabel("执行项目", { exact: true }).selectOption("local");
    await page
      .getByLabel("执行 Agent", { exact: true })
      .selectOption({ label: "测试 Agent" });
    await page
      .getByLabel("任务描述", { exact: true })
      .fill("任务输出：中文与 'literal' $(safe)");
    await page.getByRole("button", { name: "分配并执行", exact: true }).click();
    await expect(page.locator(".task-card")).toContainText("已完成");
    await expect(page.getByLabel("任务输出", { exact: true })).toContainText(
      "任务输出：中文与 'literal' $(safe)",
    );
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).taskAlerts.sounds))
      .toBe(1);
    if (await app.evaluate(({ Notification }) => Notification.isSupported()))
      await expect
        .poll(() =>
          app.evaluate(() => (globalThis as any).taskAlerts.notifications),
        )
        .toBe(1);
    const task = await page.evaluate(
      async () => (await window.grove.tasks())[0],
    );
    expect(task.terminalId).toBeTruthy();
    await expect(page.locator(".terminal-tab.active")).toContainText(
      "测试 Agent",
    );
    await expect(page.locator(".terminal-wrapper")).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          (id) => window.grove.terminalAttach(id),
          task.terminalId!,
        ),
      )
      .toContain("任务输出：中文与 'literal' $(safe)");
    await page.getByLabel("追加 Prompt", { exact: true }).fill("FOLLOWUP_OK");
    await page.getByRole("button", { name: "继续执行", exact: true }).click();
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).taskAlerts.sounds))
      .toBe(2);
    await expect(page.getByLabel("任务输出", { exact: true })).toContainText(
      "FOLLOWUP_OK",
    );
    expect(
      (await page.evaluate(() => window.grove.tasks()))[0].terminalId,
    ).toBe(task.terminalId);
    await page
      .getByRole("button", { name: "进入任务终端", exact: true })
      .click();
    await page.evaluate(
      (id) => window.grove.terminalWrite(id, "printf 'MANUAL_%s\\n' READY\r"),
      task.terminalId!,
    );
    await expect
      .poll(() =>
        page.evaluate(
          (id) => window.grove.terminalAttach(id),
          task.terminalId!,
        ),
      )
      .toContain("MANUAL_READY");
    expect(
      await app.evaluate(() => (globalThis as any).taskAlerts.sounds),
    ).toBe(2);
    await page.screenshot({ path: "artifacts/tasks-sidebar.png" });
    await page.getByRole("button", { name: "收起任务列" }).click();
    await expect(
      page.getByRole("complementary", { name: "任务系统" }),
    ).toBeHidden();
    await expect
      .poll(() =>
        page.evaluate(async () => (await window.grove.settings()).tasksVisible),
      )
      .toBe(false);
    await page.reload();
    await page.getByRole("button", { name: "切换任务列" }).click();
    await expect(page.locator(".task-card")).toContainText("验证任务闭环");
    await expect(page.locator(".project-row.remote-project")).toHaveCSS(
      "border-left-color",
      "rgb(255, 187, 85)",
    );
    const saved = JSON.parse(
      await fs.readFile(path.join(state, "tasks.json"), "utf8"),
    );
    expect(saved[0].status).toBe("succeeded");
  } finally {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBoxSync = () => 1;
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      });
    });
    await app.close();
    await fs.rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
});

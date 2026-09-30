import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { defaults } from "../../electron/services";
import { startSSH } from "../ssh-fixture";

for (const remote of [false, true])
  test(`${remote ? "SSH" : "local"} task PTY supports input, follow-ups, manual commands and closure`, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "grove-task-pty-"));
    const fixture = remote ? await startSSH(root) : undefined;
    const state = path.join(root, "state");
    await fs.mkdir(state);
    const connection = {
      id: "ssh",
      name: "Test SSH",
      host: "grove-test",
      configFile: fixture?.configFile,
      nodePath: process.execPath,
    };
    const project = {
      id: "project",
      name: "Task project",
      path: root,
      remoteId: remote ? "ssh" : undefined,
    };
    const agent = {
      id: "interactive",
      name: "Interactive fixture",
      executable: "/bin/bash",
      args: [
        "-c",
        "test -t 0 && test -t 1 || exit 8; printf 'TTY_%s\\n' READY; printf '%s\\n' \"$1\"; if [ \"$1\" = FAIL ]; then exit 7; fi; read -r answer; printf 'ANSWER=%s\\n' \"$answer\"",
        "--",
        "{prompt}",
      ],
    };
    await fs.writeFile(
      path.join(state, "workspace.json"),
      JSON.stringify({
        ...defaults(),
        projects: [project],
        remotes: remote ? [connection] : [],
        agents: [agent],
        activeProject: project.id,
        taskSound: false,
        taskNotifications: false,
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
      const page = await app.firstWindow();
      await page.waitForFunction(() => Boolean(window.grove));
      const task = await page.evaluate(() =>
        window.grove.createTask({
          title: "Interactive task",
          prompt: "中文 ' $(touch injected)\nnext",
          projectId: "project",
          agentId: "interactive",
        }),
      );
      expect(task.terminalId).toBeTruthy();
      const terminalId = task.terminalId!;
      await expect
        .poll(() =>
          page.evaluate((id) => window.grove.terminalAttach(id), terminalId),
        )
        .toContain("TTY_READY");
      await expect
        .poll(() =>
          page.evaluate(async () => (await window.grove.tasks())[0].status),
        )
        .toBe("running");
      await page.locator(".task-card").click();
      await page
        .getByRole("button", { name: "进入任务终端", exact: true })
        .click();
      await expect(page.locator(".terminal-tab.active")).toContainText(
        "Interactive fixture",
      );
      await page.evaluate(
        (id) => window.grove.terminalWrite(id, "hello input\r"),
        terminalId,
      );
      await expect
        .poll(() =>
          page.evaluate(async () => (await window.grove.tasks())[0].status),
        )
        .toBe("succeeded");
      await expect
        .poll(() =>
          page.evaluate((id) => window.grove.terminalAttach(id), terminalId),
        )
        .toContain("ANSWER=hello input");
      const prompt =
        "LONG_PROMPT_" +
        "中文 \" ' $(touch injected)\n".repeat(600) +
        "END_PROMPT";
      await page.evaluate(
        ({ id, prompt }) => window.grove.continueTask(id, prompt),
        { id: task.id, prompt },
      );
      await expect
        .poll(() =>
          page.evaluate((id) => window.grove.terminalAttach(id), terminalId),
        )
        .toContain("END_PROMPT");
      await page.evaluate(
        (id) => window.grove.terminalWrite(id, "second input\r"),
        terminalId,
      );
      await expect
        .poll(() =>
          page.evaluate(async () => (await window.grove.tasks())[0].status),
        )
        .toBe("succeeded");
      expect(
        (await page.evaluate(() => window.grove.tasks()))[0].terminalId,
      ).toBe(terminalId);
      await expect(fs.stat(path.join(root, "injected"))).rejects.toThrow();
      await page.evaluate(
        (id) =>
          window.grove.terminalWrite(
            id,
            "sleep 0.5; printf 'MANUAL_%s\\n' DONE\r",
          ),
        terminalId,
      );
      const busy = await page.evaluate(async (id) => {
        try {
          await window.grove.continueTask(id, "should not run");
          return "accepted";
        } catch (error) {
          return String(error);
        }
      }, task.id);
      expect(busy).toContain("终端正在执行命令");
      await expect
        .poll(() =>
          page.evaluate((id) => window.grove.terminalAttach(id), terminalId),
        )
        .toContain("MANUAL_DONE");
      await page.evaluate(
        (id) => window.grove.continueTask(id, "FAIL"),
        task.id,
      );
      await expect
        .poll(() =>
          page.evaluate(async () => (await window.grove.tasks())[0].exitCode),
        )
        .toBe(7);
      expect(
        (await page.evaluate(() => window.grove.terminalList()))[0].exited,
      ).toBe(false);
      await app.evaluate(({ dialog }) => {
        dialog.showMessageBox = async () => ({
          response: 1,
          checkboxChecked: false,
        });
      });
      await page.evaluate((id) => window.grove.terminalClose(id), terminalId);
      await expect
        .poll(() =>
          page.evaluate(async () => (await window.grove.tasks())[0].terminalId),
        )
        .toBeUndefined();
      const closed = await page.evaluate(async (id) => {
        try {
          await window.grove.continueTask(id, "again");
          return "accepted";
        } catch (error) {
          return String(error);
        }
      }, task.id);
      expect(closed).toContain("终端已关闭");
    } finally {
      await app.evaluate(({ dialog }) => {
        dialog.showMessageBoxSync = () => 1;
        dialog.showMessageBox = async () => ({
          response: 1,
          checkboxChecked: false,
        });
      });
      await app.close();
      await fixture?.close();
      await fs.rm(root, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      });
    }
  });

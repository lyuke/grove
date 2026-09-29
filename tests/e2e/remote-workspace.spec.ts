import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { git } from "../../electron/services";
import { startSSH } from "../ssh-fixture";

test("SSH configuration opens a remote project with files, Git and a real terminal", async () => {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "grove-remote-e2e-")),
  );
  const fixture = await startSSH(root);
  const repo = path.join(root, "远端 project ' quoted");
  await fs.mkdir(repo);
  await fs.writeFile(path.join(repo, "remote.txt"), "remote original\n");
  for (const args of [
    ["init", "-b", "main"],
    ["config", "user.name", "Grove Test"],
    ["config", "user.email", "test@example.test"],
    ["config", "commit.gpgsign", "false"],
    ["config", "core.hooksPath", path.join(repo, ".git/hooks")],
    ["add", "."],
    ["commit", "-m", "initial"],
  ])
    await git(repo, args);
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(
      (item): item is [string, string] => typeof item[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.GROVE_TEST_PROJECT;
  const localRepo = path.join(root, "local", path.basename(repo));
  await fs.mkdir(localRepo, { recursive: true });
  env.GROVE_TEST_PROJECT = localRepo;
  env.GROVE_USER_DATA = path.join(root, "state");
  env.KRB5CCNAME = `FILE:${path.join(root, "missing-ticket")}`;
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
    await page.getByRole("button", { name: "远端连接", exact: true }).click();
    await page.getByLabel("连接名称", { exact: true }).fill("测试 SSH");
    await page
      .getByLabel("主机或 SSH 别名", { exact: true })
      .fill("grove-test");
    await page
      .getByLabel("SSH 配置文件（可选）", { exact: true })
      .fill(fixture.configFile);
    await page
      .getByLabel("远端 Node.js 路径", { exact: true })
      .fill(process.execPath);
    await page.getByLabel("认证方式", { exact: true }).selectOption("kerberos");
    await expect(page.getByLabel("私钥路径", { exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "保存连接", exact: true }).click();
    await expect(
      page.getByText("连接配置已保存", { exact: true }),
    ).toBeVisible();
    expect(
      (await page.evaluate(() => window.grove.settings())).remotes?.[0]
        .authentication,
    ).toBe("kerberos");
    await page
      .getByRole("button", { name: "检查 Kerberos 票据", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("/usr/bin/kinit");
    await page.getByRole("button", { name: "测试连接", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("SSH 连接已断开");
    await page.getByLabel("认证方式", { exact: true }).selectOption("ssh");
    await page.getByRole("button", { name: "保存连接", exact: true }).click();
    await expect(
      page.getByText("连接配置已保存", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "测试连接", exact: true }).click();
    await expect(
      page.getByText(new RegExp(`已连接 ${os.hostname()}`)),
    ).toBeVisible();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].showInactive(),
    );
    await page.screenshot({ path: "/tmp/grove-remote-settings.png" });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].hide(),
    );
    await page.getByLabel("远端项目路径", { exact: true }).fill(repo);
    await page
      .getByRole("button", { name: "打开远端项目", exact: true })
      .click();
    await expect(page.locator(".remote-project .project-select")).toContainText(
      "SSH · 测试 SSH",
    );
    const projectId = (
      await page.evaluate(() => window.grove.settings())
    ).projects.find((p) => p.remoteId)!.id;
    await expect(page.locator(".local-project .project-location")).toHaveText(
      "本地",
    );
    await expect(page.locator(".remote-project .project-location")).toHaveText(
      "远端",
    );
    await expect(page.locator(".titlebar > .project-location")).toContainText(
      "grove-test",
    );
    await page.getByLabel("搜索项目", { exact: true }).fill("grove-test");
    await expect(page.locator(".project-select")).toHaveCount(1);
    await page.getByLabel("搜索项目", { exact: true }).fill("");
    expect(
      await page.evaluate(
        (id) => window.grove.search(id, "remote original", false),
        projectId,
      ),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "remote.txt" })]),
    );
    await page.getByRole("button", { name: "remote.txt", exact: true }).click();
    await expect(page.locator(".view-lines")).toContainText("remote original");
    await page.locator(".monaco-editor textarea").first().focus();
    await page.keyboard.press("Meta+ArrowDown");
    await page.keyboard.insertText("remote edited\n");
    await page.keyboard.press("Meta+s");
    await expect
      .poll(() => fs.readFile(path.join(repo, "remote.txt"), "utf8"))
      .toContain("remote edited");
    await page.getByRole("button", { name: "Git 变更", exact: true }).click();
    await page
      .getByRole("button", { name: "暂存 remote.txt", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "取消暂存 remote.txt", exact: true }),
    ).toBeVisible();
    await page.getByLabel("提交信息", { exact: true }).fill("remote commit");
    await page
      .getByRole("button", { name: "提交暂存内容 · 1", exact: true })
      .click();
    await expect(page.getByText("工作区干净", { exact: true })).toBeVisible();
    expect(await git(repo, ["log", "-1", "--format=%s"])).toContain(
      "remote commit",
    );
    await fs.writeFile(path.join(repo, "remote.txt"), "discard me\n");
    await expect(
      page.getByRole("button", { name: "暂存 remote.txt", exact: true }),
    ).toBeVisible({ timeout: 10000 });
    const diff = await page.evaluate(
      (id) => window.grove.gitDiff(id, "remote.txt", false),
      projectId,
    );
    expect(JSON.stringify(diff)).toContain("discard me");
    await page.evaluate(
      (id) => window.grove.gitDiscard(id, "remote.txt"),
      projectId,
    );
    expect(await fs.readFile(path.join(repo, "remote.txt"), "utf8")).toContain(
      "remote edited",
    );
    await page
      .getByRole("button", { name: "新建终端", exact: true })
      .first()
      .click();
    await expect(page.locator(".terminal-tab")).toContainText("SSH");
    await expect(
      page.locator(".terminal-pane .project-location"),
    ).toContainText("grove-test");
    const session = (await page.evaluate(() => window.grove.terminalList()))[0];
    expect(session.projectId).toBe(projectId);
    await page.evaluate(
      (id) =>
        window.grove.terminalWrite(
          id,
          "printf 'REMOTE_%s\\n' READY; pwd; printf 'from terminal\\n' > terminal.txt\r",
        ),
      session.id,
    );
    await expect
      .poll(() =>
        page.evaluate((id) => window.grove.terminalAttach(id), session.id),
      )
      .toContain("REMOTE_READY");
    await expect
      .poll(() =>
        fs.readFile(path.join(repo, "terminal.txt"), "utf8").catch(() => ""),
      )
      .toBe("from terminal\n");
    await page.getByRole("button", { name: "文件", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "terminal.txt", exact: true }),
    ).toBeVisible({ timeout: 10000 });
    await fs.writeFile(path.join(repo, "remote.txt"), "external remote edit\n");
    await expect(page.locator(".view-lines")).toContainText(
      "external remote edit",
      { timeout: 10000 },
    );
    await page.reload();
    await expect(page.locator(".remote-project .project-select")).toContainText(
      "SSH · 测试 SSH",
    );
    await expect(page.locator(".view-lines")).toContainText(
      "external remote edit",
    );
    expect((await page.evaluate(() => window.grove.terminalList()))[0].id).toBe(
      session.id,
    );
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].showInactive(),
    );
    await page.screenshot({ path: "/tmp/grove-remote-identity.png" });
    await page.locator(".local-project .project-select").click();
    await expect(page.locator(".titlebar > .project-location")).toHaveText(
      "本地本机",
    );
    await expect(page.locator(".local-label .project-location")).toHaveText(
      "本地本机",
    );
    await expect(
      page.locator(".terminal-pane .project-location"),
    ).toContainText("本地");
    await page.screenshot({ path: "/tmp/grove-local-identity.png" });
  } finally {
    const exited = new Promise((resolve) =>
      app.process().once("exit", resolve),
    );
    await app.evaluate(({ app }) => app.exit(0));
    await exited;
    await fixture.close();
    await fs.rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});

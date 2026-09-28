import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("inactive projects restore on selection and retain tabs while unavailable", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "grove-restore-"));
  const current = path.join(root, "current");
  const later = path.join(root, "later");
  const state = path.join(root, "state");
  await fs.mkdir(current);
  await fs.mkdir(state);
  await fs.writeFile(
    path.join(current, "active.txt"),
    "Active project ready\n",
  );
  await fs.writeFile(
    path.join(state, "workspace.json"),
    JSON.stringify({
      projects: [
        { id: "current", name: "Current", path: current },
        { id: "later", name: "Later", path: later },
      ],
      activeProject: "current",
      workspaces: {
        current: { tabs: ["active.txt"], active: "active.txt" },
        later: { tabs: ["later.txt"], active: "later.txt" },
      },
    }),
  );
  const env: Record<string, string> = Object.fromEntries(
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
    await expect(page.locator(".view-lines")).toContainText(
      "Active project ready",
    );
    await expect(
      page.getByText("部分文件无法恢复，请在文件树中检查路径。", {
        exact: true,
      }),
    ).toHaveCount(0);
    // Wait for a settings change to persist, then confirm the offline project's tabs survive.
    await page.evaluate(() => window.grove.saveSettings({ theme: "nord" }));
    await page.reload();
    await expect(page.locator(".view-lines")).toContainText(
      "Active project ready",
    );
    await expect
      .poll(
        async () =>
          JSON.parse(
            await fs.readFile(path.join(state, "workspace.json"), "utf8"),
          ).workspaces.later.tabs,
      )
      .toEqual(["later.txt"]);
    await fs.mkdir(later);
    await fs.writeFile(
      path.join(later, "later.txt"),
      "Restored when selected\n",
    );
    await page.locator(".project-select").filter({ hasText: "Later" }).click();
    await expect(page.locator(".view-lines")).toContainText(
      "Restored when selected",
    );
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

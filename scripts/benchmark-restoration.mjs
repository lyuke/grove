import { _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const executables = process.argv.slice(2);
if (!executables.length)
  throw new Error("Pass one or more Grove executable paths");
const root = await fs.mkdtemp(path.join(os.tmpdir(), "grove-restore-bench-"));
const current = path.join(root, "current");
const inactive = path.join(root, "inactive");
const results = [];
let app;
try {
  await fs.mkdir(current);
  await fs.mkdir(inactive);
  await fs.writeFile(
    path.join(current, "active.txt"),
    "ACTIVE_PROJECT_READY\n",
  );
  const tabs = Array.from({ length: 120 }, (_, i) => `file-${i}.txt`);
  for (const file of tabs)
    await fs.writeFile(
      path.join(inactive, file),
      "Inactive project text\n".repeat(8000),
    );
  for (let run = 0; run < 3; run++) {
    for (const executable of executables) {
      const state = path.join(root, `state-${results.length}`);
      await fs.mkdir(state);
      await fs.writeFile(
        path.join(state, "workspace.json"),
        JSON.stringify({
          projects: [
            { id: "current", name: "Current", path: current },
            { id: "inactive", name: "Inactive", path: inactive },
          ],
          activeProject: "current",
          workspaces: {
            current: { tabs: ["active.txt"], active: "active.txt" },
            inactive: { tabs, active: tabs[0] },
          },
        }),
      );
      const env = { ...process.env, GROVE_USER_DATA: state };
      delete env.ELECTRON_RUN_AS_NODE;
      const start = performance.now();
      app = await electron.launch({
        executablePath: path.resolve(executable),
        env,
      });
      const page = await app.firstWindow();
      await page
        .locator(".view-lines")
        .filter({ hasText: "ACTIVE_PROJECT_READY" })
        .waitFor();
      results.push({
        executable,
        run,
        startupToEditorMs: performance.now() - start,
      });
      const exited = new Promise((resolve) =>
        app.process().once("exit", resolve),
      );
      await app.evaluate(({ app }) => app.exit(0));
      await exited;
      app = undefined;
    }
  }
  const result = { inactiveTabs: 120, inactiveBytes: 20160000, runs: results };
  await fs.writeFile(
    "artifacts/restoration-0.1.6.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await fs.rm(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}

import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

test("window and files are usable before login shell setup finishes", async () => {
  const executable = process.env.GROVE_EXECUTABLE;
  const translated =
    process.arch === "arm64" &&
    executable &&
    execFileSync("/usr/bin/file", ["-b", executable], {
      encoding: "utf8",
    }).trim() === "Mach-O 64-bit executable x86_64";
  test.skip(
    Boolean(translated),
    "Rosetta cold initialization can outlast the 5-second shell deadline; run this timing-sensitive check natively.",
  );
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "grove-startup-"));
  const project = path.join(root, "project");
  const release = path.join(root, "release-shell");
  const bin = path.join(root, "custom-bin");
  await fs.mkdir(project);
  await fs.mkdir(bin);
  await fs.writeFile(
    path.join(project, "hello.txt"),
    "Open before shell finishes\n",
  );
  // A delayed zsh configuration must not hold up the window or file viewer.
  await fs.writeFile(
    path.join(root, ".zshrc"),
    `while [ ! -f '${release}' ]; do /bin/sleep 0.05; done
export PATH='${bin}:/usr/bin:/bin'
`,
  );
  await fs.writeFile(
    path.join(bin, "grove-test-command"),
    '#!/bin/sh\nprintf "LOGIN_PATH_READY\\n"\n',
    { mode: 0o755 },
  );
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  Object.assign(env, {
    SHELL: "/bin/zsh",
    ZDOTDIR: root,
    GROVE_USER_DATA: path.join(root, "state"),
    GROVE_TEST_PROJECT: project,
  });
  const app = await electron.launch({
    executablePath: process.env.GROVE_EXECUTABLE,
    args: [path.resolve(".")],
    env,
  });
  const child = app.process();
  try {
    const page = await app.firstWindow();
    await expect(
      page.getByRole("button", { name: "hello.txt", exact: true }),
    ).toBeVisible();
    const file = await page.evaluate(() =>
      window.grove.readFile("test-project", "hello.txt"),
    );
    expect(file.content).toContain("Open before shell finishes");
    await fs.writeFile(release, "ready");
    const terminal = await page.evaluate(() =>
      window.grove.terminalCreate("test-project"),
    );
    expect(await app.evaluate(() => process.env.PATH)).toContain(bin);
    await page.getByRole("button", { name: "hello.txt", exact: true }).click();
    await expect(page.locator(".view-lines")).toContainText(
      "Open before shell finishes",
    );
    await page.evaluate(
      (id) => window.grove.terminalWrite(id, "grove-test-command\r"),
      terminal.id,
    );
    await expect
      .poll(() =>
        page.evaluate((id) => window.grove.terminalAttach(id), terminal.id),
      )
      .toContain("LOGIN_PATH_READY");
  } finally {
    await fs.writeFile(release, "ready");
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

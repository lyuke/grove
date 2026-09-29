import { test, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import {
  RemoteClient,
  remoteTerminalCommand,
  sshArgs,
  validateRemote,
  kerberosStatus,
} from "../electron/remote";
import type { FileData, FileEntry, RemoteInfo } from "../shared/types";
import { startSSH } from "./ssh-fixture";

test("SSH arguments reject option injection and quote remote paths", () => {
  expect(() =>
    validateRemote({ id: "", name: "x", host: "-oProxyCommand=bad" }),
  ).toThrow();
  expect(() =>
    validateRemote({ id: "", name: "x", host: "host; touch bad" }),
  ).toThrow();
  expect(() =>
    validateRemote({ id: "", name: "x", host: "host", port: 70000 }),
  ).toThrow();
  expect(sshArgs({ id: "x", name: "x", host: "alias" })).toContain(
    "StrictHostKeyChecking=yes",
  );
  expect(remoteTerminalCommand("/tmp/a'b")).toBe(
    "cd '/tmp/a'\\''b' && exec \"${SHELL:-/bin/sh}\" -l",
  );
});

test("Kerberos uses effective GSSAPI-only authentication for RPC and terminal SSH", () => {
  const connection = {
    id: "test",
    name: "Devbox",
    host: "localhost",
    authentication: "kerberos" as const,
    configFile: "/dev/null",
    identityFile: "/unused/key",
  };
  for (const terminal of [false, true]) {
    const args = sshArgs(connection, terminal);
    expect(args).not.toContain("-i");
    const config = execFileSync("/usr/bin/ssh", ["-G", ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    expect(config).toContain("gssapiauthentication yes");
    expect(config).toMatch(/pubkeyauthentication (no|false)/);
    expect(config).toContain("passwordauthentication no");
    expect(config).toContain("kbdinteractiveauthentication no");
    expect(config).toContain("preferredauthentications gssapi-with-mic");
    expect(config).toContain("stricthostkeychecking true");
  }
});

test("system Kerberos check reports a missing cache without returning credentials", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "grove-krb5-"));
  try {
    const result = await kerberosStatus({
      ...process.env,
      KRB5CCNAME: `FILE:${path.join(root, "missing")}`,
    });
    expect(result.valid).toBe(false);
    expect(result.message).toContain("/usr/bin/kinit");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("real SSH agent preserves file contents, conflicts and project boundaries", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "grove-ssh-test-"));
  let fixture: Awaited<ReturnType<typeof startSSH>> | undefined;
  let client: RemoteClient | undefined;
  try {
    fixture = await startSSH(root);
    const agent = await build({
      entryPoints: ["electron/remote-agent.ts"],
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "node18",
      write: false,
    });
    client = new RemoteClient(
      {
        id: "test",
        name: "test",
        host: "grove-test",
        configFile: fixture.configFile,
        nodePath: process.execPath,
      },
      `process.env.HOME=${JSON.stringify(root)};\n` + agent.outputFiles[0].text,
    );
    const info = await client.call<RemoteInfo>("info", "");
    expect(info.hostname).toBe(os.hostname());
    const kerberosClient = new RemoteClient(
      {
        id: "kerberos",
        name: "Devbox",
        host: "grove-test",
        configFile: fixture.configFile,
        authentication: "kerberos",
        nodePath: process.execPath,
      },
      agent.outputFiles[0].text,
    );
    try {
      // This server accepts the fixture's key, but has no GSSAPI service.
      // Kerberos mode must fail rather than silently authenticate with that key.
      await expect(kerberosClient.call("info", "")).rejects.toThrow(
        "/usr/bin/kinit",
      );
    } finally {
      kerberosClient.close();
    }
    const repo = path.join(root, "中文 project ' space");
    await fs.mkdir(repo);
    const canonical = await client.call<string>("resolve", repo);
    await client.call("createFile", canonical, "nested/file.txt", false);
    const data = await client.call<FileData>(
      "readFile",
      canonical,
      "nested/file.txt",
    );
    const content = "\uFEFF你好\r\nline\r\n";
    const saved = await client.call<FileData>(
      "writeFile",
      canonical,
      "nested/file.txt",
      content,
      data.hash,
    );
    expect(await fs.readFile(path.join(repo, "nested/file.txt"), "utf8")).toBe(
      content,
    );
    await fs.writeFile(path.join(repo, "nested/file.txt"), "external");
    await expect(
      client.call(
        "writeFile",
        canonical,
        "nested/file.txt",
        "stale",
        saved.hash,
      ),
    ).rejects.toThrow("磁盘文件已更改");
    await expect(
      client.call("readFile", canonical, "../identity"),
    ).rejects.toThrow("项目目录之外");
    expect(
      (await client.call<FileEntry[]>("listFiles", canonical, ""))[0].name,
    ).toBe("nested");
    await fs.writeFile(path.join(repo, "origin.json"), "recoverable content");
    const trash = await client.call<string>(
      "trashFile",
      canonical,
      "origin.json",
    );
    expect(await fs.readFile(path.join(trash, "item"), "utf8")).toBe(
      "recoverable content",
    );
    expect(
      JSON.parse(await fs.readFile(path.join(trash, "origin.json"), "utf8"))
        .path,
    ).toBe(path.join(canonical, "origin.json"));
    await expect(fs.stat(path.join(repo, "origin.json"))).rejects.toThrow();
    client.close();
    expect((await client.call<RemoteInfo>("info", "")).hostname).toBe(
      info.hostname,
    );
    client.close();
    await fs.writeFile(path.join(root, "known_hosts"), "");
    await expect(client.call("info", "")).rejects.toThrow(
      "Host key verification failed",
    );
  } finally {
    client?.close();
    await fixture?.close();
    await fs.rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
}, 30000);

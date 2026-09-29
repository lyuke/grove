import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { execFileSync, spawn } from "node:child_process";

export async function startSSH(root: string) {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const name of ["host", "identity"])
    execFileSync(
      "ssh-keygen",
      ["-t", "ed25519", "-N", "", "-f", path.join(root, name)],
      { stdio: "ignore" },
    );
  await fs.copyFile(
    path.join(root, "identity.pub"),
    path.join(root, "authorized_keys"),
  );
  const quote = (value: string) => `"${value.replaceAll('"', '\\"')}"`;
  const serverConfig = path.join(root, "sshd_config");
  await fs.writeFile(
    serverConfig,
    [
      `Port ${port}`,
      "ListenAddress 127.0.0.1",
      `HostKey ${quote(path.join(root, "host"))}`,
      `PidFile ${quote(path.join(root, "sshd.pid"))}`,
      `AuthorizedKeysFile ${quote(path.join(root, "authorized_keys"))}`,
      "StrictModes no",
      "PasswordAuthentication no",
      "KbdInteractiveAuthentication no",
      "UsePAM no",
      `SetEnv ${quote(`PATH=${process.env.PATH}`)}`,
      "LogLevel ERROR",
    ].join("\n") + "\n",
  );
  const daemon = spawn("/usr/sbin/sshd", ["-D", "-e", "-f", serverConfig], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  let errors = "";
  daemon.stderr.on("data", (value) => {
    errors += value;
  });
  await new Promise<void>((resolve, reject) => {
    let attempts = 0;
    const connect = () => {
      if (daemon.exitCode !== null) {
        reject(new Error(errors));
        return;
      }
      const socket = net.connect(port, "127.0.0.1");
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (++attempts > 50) reject(new Error(errors || "sshd did not start"));
        else setTimeout(connect, 50);
      });
    };
    connect();
  });
  const hostKey = (await fs.readFile(path.join(root, "host.pub"), "utf8"))
    .split(" ")
    .slice(0, 2)
    .join(" ");
  await fs.writeFile(
    path.join(root, "known_hosts"),
    `[127.0.0.1]:${port} ${hostKey}\n`,
  );
  const configFile = path.join(root, "ssh_config");
  await fs.writeFile(
    configFile,
    [
      "Host grove-test",
      " HostName 127.0.0.1",
      ` Port ${port}`,
      ` User ${os.userInfo().username}`,
      ` IdentityFile ${quote(path.join(root, "identity"))}`,
      " IdentitiesOnly yes",
      ` UserKnownHostsFile ${quote(path.join(root, "known_hosts"))}`,
      " GlobalKnownHostsFile /dev/null",
    ].join("\n") + "\n",
  );
  return {
    configFile,
    logs: () => errors,
    close: async () => {
      if (daemon.exitCode !== null) return;
      const exited = new Promise((resolve) => daemon.once("exit", resolve));
      daemon.kill();
      await exited;
    },
  };
}

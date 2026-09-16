import { chmod } from "node:fs/promises";
for (const arch of ["arm64", "x64"]) {
  await chmod(
    `node_modules/node-pty/prebuilds/darwin-${arch}/spawn-helper`,
    0o755,
  );
}

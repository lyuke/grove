import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
const version = "15.2.0";
const targets = {
  arm64: [
    "aarch64-apple-darwin",
    "3750b2e93f37e0c692657da574d7019a101c0084da05a790c83fd335bad973e4",
  ],
  x64: [
    "x86_64-apple-darwin",
    "af7825fcc69a2afc7a7aea55fc9af90e26421d8f20fe59df32e233c0b8a231c1",
  ],
};
for (const [arch, [target, checksum]] of Object.entries(targets)) {
  const destination = path.resolve("resources", arch);
  if (
    await fs.access(path.join(destination, "rg")).then(
      () => true,
      () => false,
    )
  )
    continue;
  const archive = path.join(os.tmpdir(), `grove-rg-${arch}.tar.gz`);
  let buffer = await fs.readFile(archive).catch(() => null);
  if (
    !buffer ||
    createHash("sha256").update(buffer).digest("hex") !== checksum
  ) {
    execFileSync(
      "curl",
      [
        "-fL",
        "--retry",
        "2",
        `https://github.com/BurntSushi/ripgrep/releases/download/${version}/ripgrep-${version}-${target}.tar.gz`,
        "-o",
        archive,
      ],
      { stdio: "inherit" },
    );
    buffer = await fs.readFile(archive);
  }
  if (createHash("sha256").update(buffer).digest("hex") !== checksum)
    throw new Error(`ripgrep ${arch} checksum mismatch`);
  await fs.mkdir(destination, { recursive: true });
  execFileSync("tar", [
    "-xzf",
    archive,
    "--strip-components=1",
    "-C",
    destination,
    ...["rg", "LICENSE-MIT", "COPYING", "UNLICENSE"].map(
      (file) => `ripgrep-${version}-${target}/${file}`,
    ),
  ]);
  await fs.chmod(path.join(destination, "rg"), 0o755);
  console.log(`Prepared ripgrep ${version} (${arch})`);
}

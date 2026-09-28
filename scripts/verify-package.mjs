import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { listPackage } from "@electron/asar";

// Run after packaging both macOS architectures. Catch silent filter regressions.
const pkg = JSON.parse(await fs.readFile("package.json", "utf8"));
for (const [arch, directory] of [
  ["arm64", "mac-arm64"],
  ["x64", "mac"],
]) {
  const contents = path.join(
    pkg.build.directories.output,
    directory,
    "Grove.app/Contents",
  );
  const plist = JSON.parse(
    execFileSync(
      "/usr/bin/plutil",
      ["-convert", "json", "-o", "-", path.join(contents, "Info.plist")],
      { encoding: "utf8" },
    ),
  );
  assert(
    plist.CFBundleDocumentTypes.some(
      (type) =>
        type.CFBundleTypeRole === "Editor" &&
        type.LSHandlerRank === "Alternate" &&
        type.LSItemContentTypes.includes("public.text"),
    ),
    "Missing Finder Open With association",
  );
  const compressed = path.join(
    pkg.build.directories.output,
    `Grove-${pkg.version}-${arch}.tar.xz`,
  );
  const entries = execFileSync("/usr/bin/tar", ["-tf", compressed], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  assert(
    entries.includes("Grove.app/Contents/MacOS/Grove"),
    "Missing executable in compressed archive",
  );
  console.log(
    `${arch}: tar.xz ${((await fs.stat(compressed)).size / 1048576).toFixed(2)} MiB`,
  );
  const archive = path.join(contents, "Resources/app.asar");
  const files = listPackage(archive);
  assert(
    files.some((file) => /SymbolsNerdFontMono-Regular.*\.woff2$/.test(file)),
    "Missing bundled terminal icon font",
  );
  assert(
    !files.some((file) => /\.map$|\.test\.js$/.test(file)),
    "Unexpected source maps or tests",
  );
  const native = files.filter((file) =>
    /prebuilds.*(pty\.node|spawn-helper)$/.test(file),
  );
  assert.equal(native.length, 2);
  for (const file of native) {
    assert(file.includes(`darwin-${arch}/`), `Wrong architecture: ${file}`);
    await fs.access(`${archive}.unpacked${file}`);
  }
  const resources = path.join(
    contents,
    "Frameworks/Electron Framework.framework/Versions/A/Resources",
  );
  const locales = (await fs.readdir(resources))
    .filter((file) => file.endsWith(".lproj"))
    .sort();
  assert.deepEqual(locales, ["en.lproj", "zh_CN.lproj", "zh_TW.lproj"]);
  for (const license of [
    "Nord-MIT.txt",
    "Catppuccin-MIT.txt",
    "NerdFontsSymbols-MIT.txt",
  ]) {
    await fs.access(path.join(contents, "Resources/licenses", license));
  }
  const dmg = path.join(
    pkg.build.directories.output,
    `Grove-${pkg.version}-${arch}.dmg`,
  );
  console.log(
    `${arch}: payload verified, ${((await fs.stat(dmg)).size / 1048576).toFixed(2)} MiB`,
  );
}

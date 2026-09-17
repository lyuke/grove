import { build } from "esbuild";
import { rm } from "node:fs/promises";
// Drop stale maps and chunks from previous builds before packaging.
await rm("dist-electron", { recursive: true, force: true });
await build({
  entryPoints: { main: "electron/main.ts", preload: "electron/preload.ts" },
  bundle: true,
  platform: "node",
  format: "cjs",
  outdir: "dist-electron",
  outExtension: { ".js": ".cjs" },
  external: ["electron", "node-pty"],
  minify: true,
  sourcemap: false,
});

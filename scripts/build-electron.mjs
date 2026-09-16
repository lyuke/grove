import { build } from "esbuild";
await build({
  entryPoints: { main: "electron/main.ts", preload: "electron/preload.ts" },
  bundle: true,
  platform: "node",
  format: "cjs",
  outdir: "dist-electron",
  outExtension: { ".js": ".cjs" },
  external: ["electron", "node-pty"],
  sourcemap: true,
});

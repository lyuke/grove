import { build } from "esbuild";
import { rm } from "node:fs/promises";
// Drop stale maps and chunks from previous builds before packaging.
await rm("dist-electron", { recursive: true, force: true });
const agent = await build({
  entryPoints: ["electron/remote-agent.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  minify: true,
  write: false,
});
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
  define: {
    __REMOTE_AGENT_SOURCE__: JSON.stringify(agent.outputFiles[0].text),
  },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: { host: "127.0.0.1", port: 5178, strictPort: true },
  build: { chunkSizeWarningLimit: 4000 },
  test: { include: ["tests/**/*.test.ts"] },
} as any);

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @mediapipe/tasks-vision ships with a CDN loader that pulls WASM/task files at runtime.
// We self-host them instead (plan §5, edge case #3). `scripts/copy-mediapipe-assets.mjs`
// copies node_modules/@mediapipe/tasks-vision/wasm/* into public/mediapipe/ before dev/build,
// and the runtime loader points at `/mediapipe/*` — so deploys don't depend on jsdelivr/unpkg.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});

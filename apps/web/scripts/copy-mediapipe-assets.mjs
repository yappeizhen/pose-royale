#!/usr/bin/env node
/**
 * Copies MediaPipe Tasks Vision WASM runtime + task (model) files from the installed
 * @mediapipe/tasks-vision package into apps/web/public/mediapipe/ so the app can load
 * them from its own origin, avoiding the jsdelivr/unpkg CDN at runtime (plan §5, edge #3).
 *
 * Runs automatically via the `predev` and `prebuild` scripts in apps/web/package.json.
 * Safe to re-run: it overwrites existing files.
 *
 * No-op if @mediapipe/tasks-vision hasn't been installed yet — this lets a fresh clone
 * install the monorepo in any order without errors.
 */
import { cpSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, "..");
const destDir = resolve(appRoot, "public/mediapipe");
const tasksDestDir = resolve(destDir, "tasks");

// Required task assets for our shared CV package. These are downloaded once and then served
// from /mediapipe/tasks/* by our own origin (no production dependency on external CDNs).
const REQUIRED_TASK_ASSETS = [
  {
    fileName: "hand_landmarker.task",
    url: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
  },
];

/**
 * Resolve @mediapipe/tasks-vision by walking up from apps/web, because in a pnpm workspace
 * the hoisted node_modules folder sits at the repo root.
 */
function findPackageDir(pkgName, startDir) {
  let dir = startDir;
  while (true) {
    const candidate = resolve(dir, "node_modules", pkgName);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const pkgDir = findPackageDir("@mediapipe/tasks-vision", appRoot);
if (!pkgDir) {
  console.log(
    "[copy-mediapipe-assets] @mediapipe/tasks-vision not installed yet; skipping. Run `pnpm install` first.",
  );
  process.exit(0);
}

// The WASM runtime lives under the package's `wasm/` folder. Copy that wholesale.
const wasmSrc = resolve(pkgDir, "wasm");
if (!existsSync(wasmSrc) || !statSync(wasmSrc).isDirectory()) {
  console.warn(
    `[copy-mediapipe-assets] Expected ${wasmSrc} to exist — @mediapipe/tasks-vision shape changed?`,
  );
  process.exit(0);
}

mkdirSync(destDir, { recursive: true });
cpSync(wasmSrc, resolve(destDir, "wasm"), { recursive: true });
console.log(`[copy-mediapipe-assets] Copied ${wasmSrc} -> ${resolve(destDir, "wasm")}`);

mkdirSync(tasksDestDir, { recursive: true });

let hadTaskError = false;
for (const { fileName, url } of REQUIRED_TASK_ASSETS) {
  const outFile = resolve(tasksDestDir, fileName);
  const alreadyPresent = existsSync(outFile) && statSync(outFile).size > 0;
  if (alreadyPresent) {
    console.log(`[copy-mediapipe-assets] Keeping existing task asset ${outFile}`);
    continue;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} while downloading ${url}`);
    }
    const data = Buffer.from(await response.arrayBuffer());
    writeFileSync(outFile, data);
    console.log(`[copy-mediapipe-assets] Downloaded ${url} -> ${outFile}`);
  } catch (error) {
    hadTaskError = true;
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[copy-mediapipe-assets] Failed to materialize ${fileName}: ${reason}`);
  }
}

if (hadTaskError) {
  console.warn(
    "[copy-mediapipe-assets] Could not download one or more task assets. Pre-seed apps/web/public/mediapipe/tasks/ to stay fully offline.",
  );
}

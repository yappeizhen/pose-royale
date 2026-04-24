/**
 * Detector factory. The game module calls `createSignDetector()` exactly once
 * during `mount()` and treats the returned object as opaque; swapping between
 * the heuristic and ML backends is a one-line change here.
 *
 * Backend selection order:
 *
 *   1. Explicit `backend` in options (used by unit tests + debug overlays).
 *   2. `import.meta.env.VITE_LEARNSIGN_BACKEND` at Vite build time.
 *   3. Default: `"image"` — the shipped SSD model needs no training and works
 *      out of the box. If its prerequisites aren't met (no video source, or
 *      TF.js failed to load), `createSignDetector` transparently degrades to
 *      the heuristic backend.
 *
 * When `"landmark"` is selected but `modelUrl` isn't provided, the factory
 * falls back to the heuristic and logs a warning — landmark mode requires a
 * trained model artifact. See `games/learnsign/TRAINING.md`.
 */

import { HeuristicSignDetector } from "./HeuristicSignDetector.js";
import {
  ImageSignDetector,
  type ImageSignDetectorOptions,
} from "./ImageSignDetector.js";
import {
  LandmarkSignDetector,
  type LandmarkSignDetectorOptions,
} from "./LandmarkSignDetector.js";
import type { ISignDetector } from "./types.js";

export type DetectorBackend = "heuristic" | "landmark" | "image";

export interface CreateSignDetectorOptions {
  /** Force a backend, bypassing env-based selection. */
  backend?: DetectorBackend;
  /**
   * Settings for the landmark backend. Required when `backend === "landmark"`;
   * ignored otherwise. `modelUrl` is the only required field.
   */
  landmark?: LandmarkSignDetectorOptions;
  /**
   * Settings for the image backend. Required when `backend === "image"`;
   * ignored otherwise. `video` is required and typically sourced from
   * `ctx.hands.videoSource`.
   */
  image?: ImageSignDetectorOptions;
}

export function createSignDetector(
  opts: CreateSignDetectorOptions = {},
): ISignDetector {
  const backend = opts.backend ?? resolveBackendFromEnv();

  if (backend === "image") {
    if (!opts.image?.video) {
      console.warn(
        "[learnsign] backend=image selected but no video source supplied; falling back to heuristic",
      );
      return new HeuristicSignDetector();
    }
    return new ImageSignDetector(opts.image);
  }

  if (backend === "landmark") {
    if (!opts.landmark?.modelUrl) {
      console.warn(
        "[learnsign] backend=landmark selected but no modelUrl supplied; falling back to heuristic",
      );
      return new HeuristicSignDetector();
    }
    return new LandmarkSignDetector(opts.landmark);
  }

  return new HeuristicSignDetector();
}

function resolveBackendFromEnv(): DetectorBackend {
  // import.meta.env is injected by Vite at build time. In pure-Node test runs
  // (no Vite) it's undefined, which is fine — we still default to `image`
  // and `createSignDetector` will fall back to heuristic when no video source
  // is provided (e.g. from Vitest).
  const env = readViteEnv("VITE_LEARNSIGN_BACKEND");
  if (env === "heuristic") return "heuristic";
  if (env === "landmark") return "landmark";
  return "image";
}

function readViteEnv(key: string): string | undefined {
  // Access via optional chaining so SSR/Vitest runs without a real Vite bundle
  // don't explode on `import.meta.env` being undefined.
  try {
    const env = (import.meta as { env?: Record<string, string | undefined> }).env;
    return env?.[key];
  } catch {
    return undefined;
  }
}

export { HeuristicSignDetector } from "./HeuristicSignDetector.js";
export { LandmarkSignDetector, DEFAULT_LABELS } from "./LandmarkSignDetector.js";
export type { LandmarkSignDetectorOptions } from "./LandmarkSignDetector.js";
export { ImageSignDetector, DEFAULT_IMAGE_LABELS } from "./ImageSignDetector.js";
export type { ImageSignDetectorOptions } from "./ImageSignDetector.js";
export { HoldTracker } from "./HoldTracker.js";
export {
  HOLD_DURATION_MS,
  type ISignDetector,
  type LockedLetter,
  type Prediction,
} from "./types.js";
export {
  LANDMARK_VECTOR_LEN,
  normalizeHand,
  normalizeLandmarks,
} from "./normalize.js";

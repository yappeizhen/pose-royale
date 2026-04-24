/**
 * Shared detector interface for LearnSign. Two backends live behind this type:
 *
 *   - `HeuristicSignDetector` (Pass 1.5) — hand-crafted rules over MediaPipe
 *     landmarks. Zero-download, works offline, ~70% accuracy on the easy letters
 *     and noticeably weaker on the fist-variant set (M/N/S/T, X).
 *
 *   - `LandmarkSignDetector`  (Pass 2)   — TF.js MLP trained on normalized
 *     MediaPipe landmarks. ~10–20 KB weights, classifies all 24 static letters
 *     with proper training data. See `games/learnsign/TRAINING.md` for the
 *     Colab workflow.
 *
 * Both implementations hide their internals behind the exact same surface so
 * the game module (mount()) doesn't care which one it's talking to — swap at
 * runtime via `createSignDetector({ backend: ... })`.
 */

import type { HandFrame } from "@pose-royale/sdk";

export interface LockedLetter {
  /** The letter id that just locked in. Matches `LetterSpec.id` in `letters.ts`. */
  letter: string;
  /** 0..1. For the heuristic backend this is the MediaPipe hand score; for the
   *  ML backend it's the softmax probability of the winning class. */
  confidence: number;
}

export interface Prediction {
  /** Current best guess. `null` means "no stable candidate right now". */
  letter: string | null;
  /** How long (ms) `letter` has been the stable candidate. Drives the UI's
   *  hold-bar + the `consumeLock` gate. */
  heldMs: number;
  /** 0..1 — how confident the detector is in its current guess. */
  confidence: number;
}

export interface ISignDetector {
  /**
   * Feed the latest hand frame. Returns the current prediction snapshot. Safe
   * to call at up to the hand tracker's cadence (~30Hz).
   */
  update(frame: HandFrame, now?: number): Prediction;

  /**
   * Ask "have I held `target` long enough to score it?". Returns the locked
   * letter on success and resets the detector's hold state; returns `null`
   * otherwise. Game loop calls this once per frame.
   */
  consumeLock(target: string, now?: number): LockedLetter | null;

  /** Clear any in-progress hold. Called when the target letter advances. */
  reset(): void;

  /**
   * Release any GPU/WASM resources the backend allocated. No-op for the
   * heuristic; frees TF.js tensors for the ML backend.
   */
  dispose?(): void;

  /**
   * Kick off whatever async work the backend needs before it can produce
   * useful predictions (model download, TF.js bundle fetch, GPU backend warm-
   * up, etc.) and resolve when the detector is actually ready.
   *
   * Games should call this at mount() time — NOT lazily during the first
   * `update()` — so the detector is warm by the time the round countdown
   * finishes. Heuristic detectors resolve immediately; image/landmark
   * detectors do the heavy lifting. Rejects with a user-presentable error
   * message if the backend can't come up at all (e.g. TF.js failed to fetch,
   * model URL 404, WebGL unavailable).
   */
  preload?(): Promise<void>;
}

/** Shared hold duration (ms) both backends honor, so the UI progress bar is consistent. */
export const HOLD_DURATION_MS = 550;

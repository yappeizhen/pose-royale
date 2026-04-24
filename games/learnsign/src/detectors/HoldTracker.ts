/**
 * HoldTracker — shared hysteresis + hold-timer logic used by every sign detector.
 *
 * Both the heuristic and landmark backends classify each frame independently,
 * then flow their raw prediction through this tracker to debounce flicker +
 * require a steady hold before "locking" a letter. Keeps the detectors
 * themselves stateless aside from any backend-specific caches.
 *
 * Control flow per frame:
 *
 *   classifier → submit(letter, confidence) → snapshot() ──────────▶ UI
 *                                             └→ consumeLock() ──▶ score
 *
 * - Raw prediction changes are ignored until the new candidate survives
 *   `SWITCH_FRAMES` frames in a row. This kills single-frame jitter.
 * - Once a candidate is current, the first `heldMs` it hits `HOLD_DURATION_MS`
 *   while `consumeLock()` is asking for it counts as a score + reset.
 */

import {
  HOLD_DURATION_MS,
  type LockedLetter,
  type Prediction,
} from "./types.js";

/** Frames the same new candidate must be observed before we switch to it. */
const SWITCH_FRAMES = 3;

export class HoldTracker {
  private currentLetter: string | null = null;
  private heldSince: number | null = null;
  private pendingLetter: string | null = null;
  private pendingFrames = 0;
  private lastConfidence = 0;

  /**
   * Feed the latest raw classification. `letter = null` means "no stable
   * candidate this frame" — the tracker resets immediately when that happens
   * so brief dropouts erase any in-progress hold. `confidence` is echoed
   * through to the UI; the tracker itself doesn't threshold on it.
   */
  submit(letter: string | null, confidence: number, now: number): Prediction {
    this.lastConfidence = confidence;

    if (letter === null) {
      this.reset();
      return { letter: null, heldMs: 0, confidence: 0 };
    }

    if (letter === this.currentLetter) {
      // Same candidate — extend the hold.
      this.pendingLetter = null;
      this.pendingFrames = 0;
    } else if (letter === this.pendingLetter) {
      // Candidate repeating — count up toward switch.
      this.pendingFrames += 1;
      if (this.pendingFrames >= SWITCH_FRAMES) {
        this.currentLetter = letter;
        this.heldSince = now;
        this.pendingLetter = null;
        this.pendingFrames = 0;
      }
    } else {
      // New candidate — arm the pending slot.
      this.pendingLetter = letter;
      this.pendingFrames = 1;
    }

    // First-time bootstrap: if we have no current letter, adopt this one
    // immediately so the UI shows *something* while hysteresis warms up.
    if (this.currentLetter === null) {
      this.currentLetter = letter;
      this.heldSince = now;
    }

    return {
      letter: this.currentLetter,
      heldMs: this.heldSince !== null ? now - this.heldSince : 0,
      confidence,
    };
  }

  /**
   * Report the currently-held letter without feeding in a new classification.
   * Useful when the detector explicitly doesn't have a candidate this frame but
   * the caller wants to render the last known state (currently unused — kept
   * for future probe cases).
   */
  snapshot(now: number): Prediction {
    return {
      letter: this.currentLetter,
      heldMs: this.heldSince !== null ? now - this.heldSince : 0,
      confidence: this.lastConfidence,
    };
  }

  consumeLock(target: string, now: number): LockedLetter | null {
    if (this.currentLetter !== target) return null;
    if (this.heldSince === null) return null;
    if (now - this.heldSince < HOLD_DURATION_MS) return null;
    const locked: LockedLetter = { letter: target, confidence: this.lastConfidence };
    this.reset();
    return locked;
  }

  reset(): void {
    this.currentLetter = null;
    this.heldSince = null;
    this.pendingLetter = null;
    this.pendingFrames = 0;
  }
}

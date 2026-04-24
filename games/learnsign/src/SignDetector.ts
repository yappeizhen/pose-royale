/**
 * SignDetector — classifies a HandFrame into an ASL letter id, or null if uncertain.
 *
 * Pass 1 implementation is a "which fingers are extended?" heuristic over MediaPipe's
 * 21-landmark hand output. It covers the 6 letters listed in `letters.ts` which have
 * distinguishable extended-finger patterns. The detector also requires a brief hold
 * (`HOLD_MS`) of the same prediction before it "locks in" a letter — this stops flicker
 * from false positives mid-gesture and gives the UI somewhere to show progress.
 *
 * Pass 2 will replace this module's internals with a call into the LearnSign TF.js
 * SSD MobileNet v2 model. The public API stays the same so the mount() entry point
 * doesn't have to change:
 *   detector.update(frame) → null | { letter, confidence }
 *   detector.reset()
 */

import type { HandFrame, Landmark, TrackedHand } from "@pose-royale/sdk";
import { PASS_1_LETTERS, type LetterSpec } from "./letters.js";

export interface LockedLetter {
  letter: string;
  confidence: number;
}

export interface Prediction {
  /** The letter the heuristic currently thinks the user is showing. */
  letter: string | null;
  /**
   * How long (ms) the user has held that letter. Used by the UI for a fill bar that
   * tops up as they approach `HOLD_MS`.
   */
  heldMs: number;
  /** 0..1, drops toward 0 if the pose is ambiguous. */
  confidence: number;
}

/** How long (in ms) the same letter must stay stable before it counts as "locked in". */
const HOLD_MS = 550;
/** Minimum detection score from MediaPipe — hands below this are ignored. */
const MIN_HAND_SCORE = 0.55;

export class SignDetector {
  private currentLetter: string | null = null;
  private heldSince: number | null = null;
  // Hysteresis: we only switch `currentLetter` when the new prediction has been
  // stable for this many frames in a row. Without it, a single bad classification
  // frame would reset the user's hold timer every ~16ms.
  private pendingLetter: string | null = null;
  private pendingFrames = 0;
  private static readonly SWITCH_FRAMES = 3;

  /**
   * Consume one MediaPipe frame. Returns a snapshot of the current prediction so the
   * UI can render a progress bar while the user is holding the sign. If the caller
   * wants to know whether a letter has actually been locked, compare `prediction.heldMs`
   * to `HOLD_MS` or listen for `onLock` via `consumeLock()`.
   */
  update(frame: HandFrame, now = performance.now()): Prediction {
    const hand = primaryHand(frame);
    if (!hand) {
      return this.resetAndSnapshot();
    }

    const match = classifyHand(hand);
    if (match === null) {
      return this.resetAndSnapshot();
    }

    // Hysteresis: the letter we use as the "current" one only flips after a few
    // consecutive frames agreeing. This mirrors how the user perceives their own
    // hand — a one-frame blip shouldn't nuke their hold timer.
    if (match === this.currentLetter) {
      this.pendingLetter = null;
      this.pendingFrames = 0;
    } else if (match === this.pendingLetter) {
      this.pendingFrames += 1;
      if (this.pendingFrames >= SignDetector.SWITCH_FRAMES) {
        this.currentLetter = match;
        this.heldSince = now;
        this.pendingLetter = null;
        this.pendingFrames = 0;
      }
    } else {
      this.pendingLetter = match;
      this.pendingFrames = 1;
    }

    if (this.currentLetter === null) {
      this.currentLetter = match;
      this.heldSince = now;
    }

    return {
      letter: this.currentLetter,
      heldMs: this.heldSince !== null ? now - this.heldSince : 0,
      confidence: hand.score,
    };
  }

  /**
   * If the current prediction has been stable long enough for a lock-in and matches
   * `target`, return a `LockedLetter` and internally reset so the next letter can
   * start fresh. Otherwise returns null.
   */
  consumeLock(target: string, now = performance.now()): LockedLetter | null {
    if (this.currentLetter !== target) return null;
    if (this.heldSince === null) return null;
    if (now - this.heldSince < HOLD_MS) return null;
    const locked: LockedLetter = { letter: target, confidence: 1 };
    this.reset();
    return locked;
  }

  reset(): void {
    this.currentLetter = null;
    this.heldSince = null;
    this.pendingLetter = null;
    this.pendingFrames = 0;
  }

  private resetAndSnapshot(): Prediction {
    this.reset();
    return { letter: null, heldMs: 0, confidence: 0 };
  }
}

export const HOLD_DURATION_MS = HOLD_MS;

/**
 * Pick the hand we'll classify. MediaPipe already sorts by descending score so the
 * first entry is the highest-confidence hand; we just filter out low-score detections.
 */
function primaryHand(frame: HandFrame): TrackedHand | null {
  if (frame.hands.length === 0) return null;
  const hand = frame.hands[0]!;
  if (hand.score < MIN_HAND_SCORE) return null;
  if (hand.landmarks.length < 21) return null;
  return hand;
}

/**
 * Heuristic classifier: compute which of the five fingers are extended, then look for
 * an exact match against the letter specs. Returns null if no letter matches.
 *
 * Finger-extended test:
 *   - Non-thumb fingers: tip is "above" (smaller y) the PIP joint by a margin. Image
 *     coords use y-down, so "above" = smaller y. We require a margin so a gently curled
 *     finger doesn't read as extended.
 *   - Thumb: we compare tip.x to MCP.x along the hand's horizontal axis. For a Right
 *     hand (mirrored-off), extended thumb points left (tip.x < mcp.x); for a Left hand
 *     (from the camera's perspective) it's the opposite. We normalise by handedness.
 */
function classifyHand(hand: TrackedHand): string | null {
  const lm = hand.landmarks;
  const isExtended = {
    thumb: thumbExtended(lm, hand.handedness),
    index: fingerExtended(lm, 8, 6, 5),
    middle: fingerExtended(lm, 12, 10, 9),
    ring: fingerExtended(lm, 16, 14, 13),
    pinky: fingerExtended(lm, 20, 18, 17),
  };

  for (const spec of PASS_1_LETTERS) {
    if (matchesSpec(isExtended, spec)) return spec.id;
  }
  return null;
}

function matchesSpec(
  actual: { thumb: boolean; index: boolean; middle: boolean; ring: boolean; pinky: boolean },
  spec: LetterSpec,
): boolean {
  return (
    actual.thumb === spec.extended.thumb &&
    actual.index === spec.extended.index &&
    actual.middle === spec.extended.middle &&
    actual.ring === spec.extended.ring &&
    actual.pinky === spec.extended.pinky
  );
}

/**
 * A non-thumb finger is considered extended when its tip is clearly above (smaller y)
 * the PIP joint AND above the MCP joint. The PIP-only check alone is flappy because
 * during the "closing" phase of a fist the tip is still briefly above the PIP; the
 * additional MCP check stabilises it.
 */
function fingerExtended(lm: Landmark[], tipIdx: number, pipIdx: number, mcpIdx: number): boolean {
  const tip = lm[tipIdx]!;
  const pip = lm[pipIdx]!;
  const mcp = lm[mcpIdx]!;
  // Margin: fingertip must be at least 2% of frame height above the PIP.
  const MARGIN = 0.02;
  return tip.y + MARGIN < pip.y && tip.y < mcp.y;
}

/**
 * Thumb is trickier because it bends sideways rather than vertically. We compare the
 * thumb tip's horizontal distance from the wrist against the thumb-MCP's distance.
 * When the thumb is extended, the tip is further from the wrist than the MCP along
 * the wrist→MCP axis.
 *
 * Handedness correction: MediaPipe returns handedness as seen by the model (i.e.
 * already accounts for webcam mirroring), so we don't need to flip anything here.
 */
function thumbExtended(lm: Landmark[], _handedness: "Left" | "Right"): boolean {
  const wrist = lm[0]!;
  const thumbMcp = lm[2]!;
  const thumbTip = lm[4]!;
  const mcpDist = distance(wrist, thumbMcp);
  const tipDist = distance(wrist, thumbTip);
  // Extended thumb reaches noticeably further from the wrist than the MCP joint.
  return tipDist > mcpDist * 1.35;
}

function distance(a: Landmark, b: Landmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

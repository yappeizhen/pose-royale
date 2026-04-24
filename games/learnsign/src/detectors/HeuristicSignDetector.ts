/**
 * HeuristicSignDetector — landmark-rule-based ASL letter classifier.
 *
 * Scope: 24 static ASL letters (A–Y excluding J and Z).
 *
 * Approach:
 *
 *   1. Extract a feature bundle from the 21 MediaPipe hand landmarks:
 *      which fingers are extended, where the thumb is (out / across / tucked),
 *      hand orientation (up / down / sideways), which fingertip the thumb is
 *      near, whether the index is bent into a hook (for X), the index/middle
 *      spatial relationship, and whether the curled fingers form a tight fist
 *      or a loose curve (C/O).
 *
 *   2. Score every letter spec in `ALPHABET` against those features. Letters
 *      with mismatched `extended` patterns are hard-filtered out. Among the
 *      remaining candidates the one matching the most fine features wins.
 *
 *   3. Stream the raw result into the shared `HoldTracker` for hysteresis
 *      + lock-in timing.
 *
 * Tradeoff: zero download, works offline, but unreliable on fist-variant
 * letters (M/N/S/T, X) because 2D landmarks don't disambiguate thumb
 * placement well. `LandmarkSignDetector` is the proper fix.
 */

import type { HandFrame, Landmark, TrackedHand } from "@pose-royale/sdk";
import { ALPHABET, type LetterSpec, type PoseSpec } from "../letters.js";
import { HoldTracker } from "./HoldTracker.js";
import type { ISignDetector, LockedLetter, Prediction } from "./types.js";

/** Minimum detection score from MediaPipe — hands below this are ignored. */
const MIN_HAND_SCORE = 0.55;

export class HeuristicSignDetector implements ISignDetector {
  private readonly hold = new HoldTracker();

  update(frame: HandFrame, now = performance.now()): Prediction {
    const hand = primaryHand(frame);
    if (!hand) return this.hold.submit(null, 0, now);

    const features = extractFeatures(hand);
    const match = classifyStatic(features);
    return this.hold.submit(match, hand.score, now);
  }

  consumeLock(target: string, now = performance.now()): LockedLetter | null {
    return this.hold.consumeLock(target, now);
  }

  reset(): void {
    this.hold.reset();
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Feature extraction
// ──────────────────────────────────────────────────────────────────────────────

interface Features {
  extended: { thumb: boolean; index: boolean; middle: boolean; ring: boolean; pinky: boolean };
  thumbPosition: "out" | "across" | "tucked";
  orientation: "up" | "down" | "sideways";
  thumbTouches: "index" | "middle" | "ring" | "pinky" | "none";
  indexMiddle: "together" | "spread" | "crossed";
  curl: "tight" | "loose";
  indexHook: boolean;
}

function extractFeatures(hand: TrackedHand): Features {
  const lm = hand.landmarks;
  const extended = {
    thumb: isThumbExtended(lm),
    index: fingerExtended(lm, 8, 6, 5),
    middle: fingerExtended(lm, 12, 10, 9),
    ring: fingerExtended(lm, 16, 14, 13),
    pinky: fingerExtended(lm, 20, 18, 17),
  };
  return {
    extended,
    thumbPosition: classifyThumbPosition(lm),
    orientation: classifyOrientation(lm),
    thumbTouches: nearestThumbContact(lm),
    indexMiddle: classifyIndexMiddle(lm, extended),
    curl: classifyCurl(lm, extended),
    indexHook: isIndexHook(lm, extended),
  };
}

function fingerExtended(lm: Landmark[], tipIdx: number, pipIdx: number, mcpIdx: number): boolean {
  const tip = lm[tipIdx]!;
  const pip = lm[pipIdx]!;
  const mcp = lm[mcpIdx]!;
  const MARGIN = 0.02;
  return tip.y + MARGIN < pip.y && tip.y < mcp.y;
}

function isThumbExtended(lm: Landmark[]): boolean {
  const wrist = lm[0]!;
  const thumbMcp = lm[2]!;
  const thumbTip = lm[4]!;
  const mcpDist = distance(wrist, thumbMcp);
  const tipDist = distance(wrist, thumbTip);
  return tipDist > mcpDist * 1.35;
}

/**
 * Thumb tip position relative to the palm:
 *   - "across": thumb tip is horizontally on the palm side of the index MCP
 *     (crossed over the front of the fingers). Typical for S, E, B.
 *   - "tucked": thumb tip is close to or between the curled fingers (M, N, T).
 *   - "out":    thumb tip is away from the palm, the classic extended thumb.
 *     Covers A's thumb-beside-fist case too.
 */
function classifyThumbPosition(lm: Landmark[]): "out" | "across" | "tucked" {
  const thumbTip = lm[4]!;
  const indexMcp = lm[5]!;
  const pinkyMcp = lm[17]!;
  const middleMcp = lm[9]!;

  const palmSignedDx = pinkyMcp.x - indexMcp.x;
  const sign = palmSignedDx >= 0 ? 1 : -1;
  const thumbDx = (thumbTip.x - indexMcp.x) * sign;
  const palmWidth = Math.abs(palmSignedDx);
  if (palmWidth < 1e-4) return "out";

  const palmCenter = {
    x: (indexMcp.x + pinkyMcp.x + middleMcp.x) / 3,
    y: (indexMcp.y + pinkyMcp.y + middleMcp.y) / 3,
  };
  const distToPalm = Math.hypot(thumbTip.x - palmCenter.x, thumbTip.y - palmCenter.y);
  const palmSpan = distance(indexMcp, pinkyMcp);

  if (distToPalm < palmSpan * 0.55 && thumbDx > -0.2 * palmWidth) {
    return thumbDx > 0.35 * palmWidth ? "across" : "tucked";
  }
  return "out";
}

function classifyOrientation(lm: Landmark[]): "up" | "down" | "sideways" {
  const wrist = lm[0]!;
  const middleMcp = lm[9]!;
  const dx = middleMcp.x - wrist.x;
  const dy = middleMcp.y - wrist.y;
  if (Math.abs(dy) > Math.abs(dx) * 1.1) {
    return dy < 0 ? "up" : "down";
  }
  return "sideways";
}

function nearestThumbContact(lm: Landmark[]): Features["thumbTouches"] {
  const thumbTip = lm[4]!;
  const tips: { name: Features["thumbTouches"]; point: Landmark }[] = [
    { name: "index", point: lm[8]! },
    { name: "middle", point: lm[12]! },
    { name: "ring", point: lm[16]! },
    { name: "pinky", point: lm[20]! },
  ];
  const palmSpan = distance(lm[5]!, lm[17]!);
  let best: Features["thumbTouches"] = "none";
  let bestDist = palmSpan * 0.3;
  for (const t of tips) {
    const d = distance(thumbTip, t.point);
    if (d < bestDist) {
      bestDist = d;
      best = t.name;
    }
  }
  return best;
}

function classifyIndexMiddle(
  lm: Landmark[],
  extended: Features["extended"],
): "together" | "spread" | "crossed" {
  if (!extended.index || !extended.middle) return "together";
  const indexTip = lm[8]!;
  const middleTip = lm[12]!;
  const indexMcp = lm[5]!;
  const middleMcp = lm[9]!;
  const palmSpan = distance(lm[5]!, lm[17]!);

  const mcpDx = middleMcp.x - indexMcp.x;
  const tipDx = middleTip.x - indexTip.x;
  if (Math.sign(mcpDx) !== Math.sign(tipDx) && Math.abs(tipDx) > 0.02) {
    return "crossed";
  }

  const sep = distance(indexTip, middleTip);
  return sep > palmSpan * 0.5 ? "spread" : "together";
}

function classifyCurl(lm: Landmark[], extended: Features["extended"]): "tight" | "loose" {
  const palmSpan = distance(lm[5]!, lm[17]!);
  if (palmSpan < 1e-4) return "tight";

  const fingers: { name: keyof Features["extended"]; tip: number; mcp: number }[] = [
    { name: "index", tip: 8, mcp: 5 },
    { name: "middle", tip: 12, mcp: 9 },
    { name: "ring", tip: 16, mcp: 13 },
    { name: "pinky", tip: 20, mcp: 17 },
  ];
  let total = 0;
  let count = 0;
  for (const f of fingers) {
    if (extended[f.name]) continue;
    total += distance(lm[f.tip]!, lm[f.mcp]!);
    count += 1;
  }
  if (count === 0) return "tight";
  const avgRel = total / count / palmSpan;
  return avgRel < 0.55 ? "tight" : "loose";
}

function isIndexHook(lm: Landmark[], extended: Features["extended"]): boolean {
  if (!extended.index) return false;
  const mcp = lm[5]!;
  const pip = lm[6]!;
  const tip = lm[8]!;
  const v1 = { x: mcp.x - pip.x, y: mcp.y - pip.y };
  const v2 = { x: tip.x - pip.x, y: tip.y - pip.y };
  const dot = v1.x * v2.x + v1.y * v2.y;
  const mag = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  if (mag < 1e-6) return false;
  const cos = dot / mag;
  return cos > 0.25;
}

function distance(a: Landmark, b: Landmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function primaryHand(frame: HandFrame): TrackedHand | null {
  if (frame.hands.length === 0) return null;
  const hand = frame.hands[0]!;
  if (hand.score < MIN_HAND_SCORE) return null;
  if (hand.landmarks.length < 21) return null;
  return hand;
}

// ──────────────────────────────────────────────────────────────────────────────
// Static classifier
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Match the features against every letter spec and return the id of the best
 * match. Scoring: `extended` is a hard filter; each pose field the spec
 * declares contributes +1 when matched, -1 when mismatched.
 */
function classifyStatic(f: Features): string | null {
  let bestId: string | null = null;
  let bestScore = -Infinity;

  for (const spec of ALPHABET) {
    if (!matchesExtended(f.extended, spec.extended)) continue;

    const score = scorePose(f, spec.pose);
    if (score > bestScore) {
      bestScore = score;
      bestId = spec.id;
    }
  }

  return bestScore >= 0 ? bestId : null;
}

function matchesExtended(
  actual: Features["extended"],
  spec: LetterSpec["extended"],
): boolean {
  return (
    actual.thumb === spec.thumb &&
    actual.index === spec.index &&
    actual.middle === spec.middle &&
    actual.ring === spec.ring &&
    actual.pinky === spec.pinky
  );
}

function scorePose(f: Features, pose: PoseSpec | undefined): number {
  if (!pose) return 0;
  let score = 0;
  if (pose.thumbPosition !== undefined) {
    score += f.thumbPosition === pose.thumbPosition ? 1 : -1;
  }
  if (pose.orientation !== undefined) {
    score += f.orientation === pose.orientation ? 1 : -1;
  }
  if (pose.thumbTouches !== undefined) {
    score += f.thumbTouches === pose.thumbTouches ? 1 : -1;
  }
  if (pose.indexMiddle !== undefined) {
    score += f.indexMiddle === pose.indexMiddle ? 1 : -1;
  }
  if (pose.curl !== undefined) {
    score += f.curl === pose.curl ? 1 : -1;
  }
  if (pose.indexHook !== undefined) {
    score += f.indexHook === pose.indexHook ? 1 : -1;
  }
  return score;
}

import { describe, it, expect } from "vitest";
import { normalizeHand, LANDMARK_VECTOR_LEN } from "./normalize.js";
import type { Landmark, TrackedHand } from "@pose-royale/sdk";

/** Build a minimal 21-landmark hand with a fixed wrist→middle-MCP distance. */
function makeHand(handedness: "Left" | "Right" = "Right"): TrackedHand {
  const lm: Landmark[] = [];
  // Wrist at (0.5, 0.5), middle MCP at (0.5, 0.7) → vertical hand, scale = 0.2.
  for (let i = 0; i < 21; i++) lm.push({ x: 0.5, y: 0.5, z: 0 });
  lm[0] = { x: 0.5, y: 0.5, z: 0 }; // wrist
  lm[9] = { x: 0.5, y: 0.7, z: 0 }; // middle MCP
  lm[8] = { x: 0.6, y: 0.3, z: 0.01 }; // index tip off to the right and up
  return { handedness, score: 1, landmarks: lm };
}

describe("normalizeHand", () => {
  it("produces a fixed-length Float32Array with wrist at origin", () => {
    const out = normalizeHand(makeHand());
    expect(out).not.toBeNull();
    expect(out!.length).toBe(LANDMARK_VECTOR_LEN);
    // Wrist (index 0) is at (0, 0, 0) after translation.
    expect(out![0]).toBeCloseTo(0);
    expect(out![1]).toBeCloseTo(0);
    expect(out![2]).toBeCloseTo(0);
  });

  it("scales distances so wrist→middle-MCP = 1", () => {
    const out = normalizeHand(makeHand());
    // Middle MCP (index 9) is directly below wrist in y by exactly scale=0.2,
    // so its normalized y should be 1.
    expect(out![9 * 3 + 0]).toBeCloseTo(0);
    expect(out![9 * 3 + 1]).toBeCloseTo(1);
  });

  it("mirrors left hands by flipping x so the classifier is handedness-invariant", () => {
    const right = normalizeHand(makeHand("Right"))!;
    const left = normalizeHand(makeHand("Left"))!;
    // Index tip landmark 8: x values should be sign-flipped.
    const idxX_right = right[8 * 3 + 0];
    const idxX_left = left[8 * 3 + 0];
    expect(idxX_left).toBeCloseTo(-idxX_right!);
    // y values stay the same.
    expect(left[8 * 3 + 1]).toBeCloseTo(right[8 * 3 + 1]!);
  });

  it("returns null when the hand is degenerate (wrist collapsed onto middle MCP)", () => {
    const hand = makeHand();
    hand.landmarks[9] = { ...hand.landmarks[0]! };
    expect(normalizeHand(hand)).toBeNull();
  });
});

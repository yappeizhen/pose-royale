import { describe, it, expect } from "vitest";
import { HoldTracker } from "./HoldTracker.js";
import { HOLD_DURATION_MS } from "./types.js";

describe("HoldTracker", () => {
  it("adopts the first candidate immediately for UI feedback", () => {
    const h = new HoldTracker();
    const p = h.submit("A", 0.9, 0);
    expect(p.letter).toBe("A");
    expect(p.heldMs).toBe(0);
    expect(p.confidence).toBe(0.9);
  });

  it("extends the held time as long as the candidate is stable", () => {
    const h = new HoldTracker();
    h.submit("A", 1, 0);
    const p = h.submit("A", 1, 500);
    expect(p.letter).toBe("A");
    expect(p.heldMs).toBe(500);
  });

  it("requires repeated observation before switching candidates (hysteresis)", () => {
    const h = new HoldTracker();
    h.submit("A", 1, 0);
    // A single B frame should not dethrone A.
    const p1 = h.submit("B", 1, 100);
    expect(p1.letter).toBe("A");
    // Two more B frames are needed (SWITCH_FRAMES = 3 total).
    h.submit("B", 1, 150);
    const p3 = h.submit("B", 1, 200);
    expect(p3.letter).toBe("B");
    expect(p3.heldMs).toBe(0);
  });

  it("resets on null candidate so brief dropouts erase in-progress holds", () => {
    const h = new HoldTracker();
    h.submit("A", 1, 0);
    h.submit("A", 1, 300);
    const p = h.submit(null, 0, 320);
    expect(p.letter).toBeNull();
    // Re-arming after the dropout starts from t=500, not t=0.
    const p2 = h.submit("A", 1, 500);
    expect(p2.letter).toBe("A");
    expect(p2.heldMs).toBe(0);
  });

  it("consumeLock returns null until HOLD_DURATION_MS has elapsed", () => {
    const h = new HoldTracker();
    h.submit("A", 0.8, 0);
    h.submit("A", 0.8, HOLD_DURATION_MS - 1);
    expect(h.consumeLock("A", HOLD_DURATION_MS - 1)).toBeNull();
    h.submit("A", 0.8, HOLD_DURATION_MS);
    const locked = h.consumeLock("A", HOLD_DURATION_MS);
    expect(locked).not.toBeNull();
    expect(locked!.letter).toBe("A");
    expect(locked!.confidence).toBeCloseTo(0.8);
  });

  it("consumeLock only fires for the target letter", () => {
    const h = new HoldTracker();
    h.submit("A", 1, 0);
    h.submit("A", 1, HOLD_DURATION_MS);
    expect(h.consumeLock("B", HOLD_DURATION_MS)).toBeNull();
    expect(h.consumeLock("A", HOLD_DURATION_MS)).not.toBeNull();
  });

  it("resets after a successful lock so the next letter needs a fresh hold", () => {
    const h = new HoldTracker();
    h.submit("A", 1, 0);
    h.submit("A", 1, HOLD_DURATION_MS);
    h.consumeLock("A", HOLD_DURATION_MS);
    const p = h.submit("A", 1, HOLD_DURATION_MS);
    expect(p.heldMs).toBe(0);
  });
});

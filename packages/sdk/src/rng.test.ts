import { describe, expect, it } from "vitest";
import { createRng, pick, randInt, seedFromString } from "./rng.js";

describe("rng", () => {
  it("is deterministic — same seed produces the same sequence", () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 10 }, a);
    const seqB = Array.from({ length: 10 }, b);
    expect(seqA).toEqual(seqB);
  });

  it("returns values in [0, 1)", () => {
    const rng = createRng(1);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("produces different sequences for different seeds", () => {
    const a = Array.from({ length: 10 }, createRng(1));
    const b = Array.from({ length: 10 }, createRng(2));
    expect(a).not.toEqual(b);
  });

  it("seedFromString is stable for the same input", () => {
    expect(seedFromString("room-abc")).toBe(seedFromString("room-abc"));
    expect(seedFromString("room-abc")).not.toBe(seedFromString("room-abd"));
  });
});

describe("randInt", () => {
  it("returns values in [min, max)", () => {
    const rng = createRng(123);
    for (let i = 0; i < 1000; i++) {
      const v = randInt(rng, 5, 10);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThan(10);
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});

describe("pick", () => {
  it("selects one element from the array", () => {
    const rng = createRng(7);
    const items = ["a", "b", "c"];
    for (let i = 0; i < 100; i++) {
      expect(items).toContain(pick(rng, items));
    }
  });

  it("throws on empty arrays", () => {
    const rng = createRng(7);
    expect(() => pick(rng, [])).toThrow();
  });
});

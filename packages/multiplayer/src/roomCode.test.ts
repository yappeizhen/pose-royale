import { describe, expect, it } from "vitest";
import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from "./roomCode.js";

describe("generateRoomCode", () => {
  it("returns a 4-char string by default", () => {
    expect(generateRoomCode()).toHaveLength(4);
  });

  it("respects a custom length", () => {
    expect(generateRoomCode(undefined, 6)).toHaveLength(6);
  });

  it("omits ambiguous characters", () => {
    const banned = ["0", "O", "1", "I", "L"];
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode();
      for (const b of banned) expect(code).not.toContain(b);
    }
  });

  it("is deterministic with a seeded rng", () => {
    let state = 1;
    const rng = () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
    const a = generateRoomCode(rng);
    state = 1;
    const b = generateRoomCode(rng);
    expect(a).toBe(b);
  });
});

describe("normalizeRoomCode", () => {
  it("strips whitespace and uppercases", () => {
    expect(normalizeRoomCode("  ab cd  ")).toBe("ABCD");
  });
});

describe("isValidRoomCode", () => {
  it("accepts sensible codes", () => {
    expect(isValidRoomCode("ABCD")).toBe(true);
    expect(isValidRoomCode("XY23")).toBe(true);
  });

  it("rejects ambiguous or banned chars", () => {
    expect(isValidRoomCode("A0CD")).toBe(false);
    expect(isValidRoomCode("ILXY")).toBe(false);
  });

  it("rejects wrong lengths", () => {
    expect(isValidRoomCode("AB")).toBe(false);
    expect(isValidRoomCode("ABCDEFGHI")).toBe(false);
  });
});

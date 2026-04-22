import { describe, expect, it } from "vitest";
import { expectedScore, updateElo, K_FACTOR } from "./elo.js";

describe("expectedScore", () => {
  it("returns 0.5 for equal ratings", () => {
    expect(expectedScore(1200, 1200)).toBeCloseTo(0.5, 5);
  });
  it("favors higher-rated player", () => {
    expect(expectedScore(1400, 1200)).toBeGreaterThan(0.5);
  });
  it("disfavors lower-rated player", () => {
    expect(expectedScore(1000, 1200)).toBeLessThan(0.5);
  });
});

describe("updateElo", () => {
  it("rewards the winner and mirrors the delta on the loser", () => {
    const u = updateElo(1200, 1200, 1);
    expect(u.deltaA).toBeGreaterThan(0);
    expect(u.deltaB).toBe(-u.deltaA);
    expect(u.newRatingA).toBe(1200 + u.deltaA);
    expect(u.newRatingB).toBe(1200 + u.deltaB);
  });

  it("caps single-match movement at K_FACTOR", () => {
    const u = updateElo(800, 2000, 1);
    expect(Math.abs(u.deltaA)).toBeLessThanOrEqual(K_FACTOR);
  });

  it("returns 0 delta for a draw between equal ratings", () => {
    const u = updateElo(1500, 1500, 0.5);
    expect(u.deltaA).toBe(0);
    expect(u.deltaB).toBe(0);
  });
});

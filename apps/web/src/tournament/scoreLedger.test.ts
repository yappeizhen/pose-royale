import { describe, expect, it } from "vitest";
import { buildRoundResult, cumulative, leaderOf, toPoints } from "./scoreLedger.js";

describe("toPoints", () => {
  it("rounds 0..1 to 0..1000", () => {
    expect(toPoints(0)).toBe(0);
    expect(toPoints(0.5)).toBe(500);
    expect(toPoints(1)).toBe(1000);
    expect(toPoints(0.1234)).toBe(123);
  });
  it("clamps out-of-range inputs defensively", () => {
    expect(toPoints(-1)).toBe(0);
    expect(toPoints(2)).toBe(1000);
    expect(toPoints(Number.NaN)).toBe(0);
    expect(toPoints(Number.POSITIVE_INFINITY)).toBe(1000);
  });
});

describe("buildRoundResult + cumulative", () => {
  it("converts normalized scores to points and sums across rounds", () => {
    const r1 = buildRoundResult("frootninja", { p1: 0.8, p2: 0.5 });
    const r2 = buildRoundResult("ponghub", { p1: 0.3, p2: 0.9 });
    const r3 = buildRoundResult("frootninja", { p1: 1.0, p2: 0.6 });
    expect(cumulative([r1, r2, r3])).toEqual({
      p1: 800 + 300 + 1000,
      p2: 500 + 900 + 600,
    });
  });

  it("caps the theoretical maximum at 3000 per player with 3 rounds", () => {
    const rs = [1, 1, 1].map((v, i) => buildRoundResult(`g${i}`, { p1: v }));
    expect(cumulative(rs).p1).toBe(3000);
  });
});

describe("leaderOf", () => {
  it("returns a clear winner with margin", () => {
    const rs = [
      buildRoundResult("a", { p1: 0.8, p2: 0.6 }),
      buildRoundResult("b", { p1: 0.9, p2: 0.4 }),
    ];
    const result = leaderOf(rs);
    expect(result.kind).toBe("winner");
    if (result.kind === "winner") {
      expect(result.playerId).toBe("p1");
      expect(result.margin).toBe(1700 - 1000);
    }
  });

  it("returns a tie with all tied ids", () => {
    const rs = [buildRoundResult("a", { p1: 0.5, p2: 0.5 })];
    const result = leaderOf(rs);
    expect(result.kind).toBe("tie");
    if (result.kind === "tie") {
      expect(new Set(result.tiedIds)).toEqual(new Set(["p1", "p2"]));
    }
  });
});

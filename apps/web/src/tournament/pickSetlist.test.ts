import { createRng } from "@pose-royale/sdk";
import { describe, expect, it } from "vitest";
import { pickSetlist } from "./pickSetlist.js";

describe("pickSetlist", () => {
  it("returns a list of the requested length", () => {
    const list = pickSetlist({
      available: ["a", "b"],
      rounds: 3,
      rng: createRng(1),
    });
    expect(list).toHaveLength(3);
  });

  it("never picks the same game back-to-back", () => {
    for (let seed = 0; seed < 50; seed++) {
      const list = pickSetlist({
        available: ["a", "b"],
        rounds: 10,
        rng: createRng(seed),
      });
      for (let i = 1; i < list.length; i++) {
        expect(list[i]).not.toBe(list[i - 1]);
      }
    }
  });

  it("is deterministic for the same seed", () => {
    const a = pickSetlist({ available: ["a", "b", "c"], rounds: 3, rng: createRng(42) });
    const b = pickSetlist({ available: ["a", "b", "c"], rounds: 3, rng: createRng(42) });
    expect(a).toEqual(b);
  });

  it("produces different sequences for different seeds", () => {
    const a = pickSetlist({ available: ["a", "b", "c"], rounds: 5, rng: createRng(1) });
    const b = pickSetlist({ available: ["a", "b", "c"], rounds: 5, rng: createRng(9999) });
    expect(a).not.toEqual(b);
  });

  it("allows repeats when dedupe=false (v1 two-game era)", () => {
    // With 2 games and 3 rounds and no-back-to-back, a valid setlist must alternate.
    const list = pickSetlist({
      available: ["a", "b"],
      rounds: 3,
      rng: createRng(5),
    });
    expect(list.filter((g) => g === "a").length + list.filter((g) => g === "b").length).toBe(3);
  });

  it("ensures all distinct when dedupe=true", () => {
    const list = pickSetlist({
      available: ["a", "b", "c", "d"],
      rounds: 3,
      rng: createRng(5),
      dedupe: true,
    });
    expect(new Set(list).size).toBe(3);
  });

  it("throws when only one game is registered and rounds > 1", () => {
    expect(() =>
      pickSetlist({ available: ["solo"], rounds: 3, rng: createRng(1) }),
    ).toThrow(/unsatisfiable/);
  });

  it("throws when dedupe=true but not enough games", () => {
    expect(() =>
      pickSetlist({
        available: ["a", "b"],
        rounds: 3,
        rng: createRng(1),
        dedupe: true,
      }),
    ).toThrow(/dedupe=true requires/);
  });

  it("throws on empty registry", () => {
    expect(() => pickSetlist({ available: [], rounds: 3, rng: createRng(1) })).toThrow(
      /empty/,
    );
  });
});

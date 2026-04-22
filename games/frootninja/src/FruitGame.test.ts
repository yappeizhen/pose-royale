import { describe, expect, it } from "vitest";
import { FruitGame } from "./FruitGame.js";

function deterministicRng(): () => number {
  let s = 1;
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32;
    return s / 2 ** 32;
  };
}

describe("FruitGame", () => {
  it("spawns objects over time", () => {
    const g = new FruitGame({ rng: deterministicRng(), spawnEverySec: 0.1 });
    g.tick(0.5);
    expect(g.state().objects.length).toBeGreaterThan(0);
  });

  it("slices a fruit when the blade is within radius", () => {
    const g = new FruitGame({ rng: deterministicRng(), spawnEverySec: 0.1 });
    g.tick(0.2);
    const target = g.state().objects[0]!;
    const result = g.pushBlade({ x: target.x, y: target.y });
    expect(result.sliced).toContain(target);
    expect(g.rawScore()).toBeGreaterThanOrEqual(0);
  });

  it("bomb hits subtract from raw score but never below zero", () => {
    const g = new FruitGame({ rng: deterministicRng(), spawnEverySec: 0.1, bombChance: 1 });
    g.tick(0.2);
    const bomb = g.state().objects.find((o) => o.kind === "bomb")!;
    g.pushBlade({ x: bomb.x, y: bomb.y });
    expect(g.state().bombs).toBeGreaterThan(0);
    expect(g.rawScore()).toBe(0);
  });

  it("retires missed fruit and bumps the missed counter", () => {
    const g = new FruitGame({ rng: deterministicRng(), spawnEverySec: 0.1, bombChance: 0 });
    g.tick(0.2);
    // Advance far enough that everything falls through the floor.
    for (let i = 0; i < 60; i++) g.tick(0.1);
    expect(g.state().missed).toBeGreaterThan(0);
  });

  it("is deterministic given the same rng seed", () => {
    const a = new FruitGame({ rng: deterministicRng(), spawnEverySec: 0.1 });
    const b = new FruitGame({ rng: deterministicRng(), spawnEverySec: 0.1 });
    for (let i = 0; i < 20; i++) {
      a.tick(0.1);
      b.tick(0.1);
    }
    expect(a.state().objects.map((o) => [o.id, o.kind])).toEqual(
      b.state().objects.map((o) => [o.id, o.kind]),
    );
  });
});

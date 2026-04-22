import { describe, expect, it } from "vitest";
import { PongGame } from "./PongGame.js";

function deterministicRng(): () => number {
  let s = 42;
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32;
    return s / 2 ** 32;
  };
}

describe("PongGame", () => {
  it("keeps the paddle in-bounds regardless of target", () => {
    const g = new PongGame({ rng: deterministicRng() });
    g.setPaddleTarget(-1);
    for (let i = 0; i < 20; i++) g.tick(0.05);
    expect(g.state().paddleY).toBeGreaterThanOrEqual(g.paddleHalf);

    g.setPaddleTarget(2);
    for (let i = 0; i < 20; i++) g.tick(0.05);
    expect(g.state().paddleY).toBeLessThanOrEqual(1 - g.paddleHalf);
  });

  it("returns the ball when paddle meets it", () => {
    const g = new PongGame({ rng: deterministicRng(), initialSpeed: 0.5 });
    // Force ball to the paddle zone.
    const state = g.state();
    // Spin until the ball is heading left.
    let safety = 200;
    while (state.ball.vx >= 0 && safety-- > 0) g.tick(0.05);
    // Put paddle where ball will be.
    g.setPaddleTarget(g.state().ball.y);
    for (let i = 0; i < 40; i++) {
      g.setPaddleTarget(g.state().ball.y);
      g.tick(0.05);
    }
    expect(g.rawScore()).toBeGreaterThanOrEqual(1);
  });

  it("counts misses without going negative", () => {
    const g = new PongGame({ rng: deterministicRng(), initialSpeed: 1.2 });
    g.setPaddleTarget(0.95); // Intentionally far from every ball.
    for (let i = 0; i < 400; i++) g.tick(0.05);
    expect(g.state().misses).toBeGreaterThanOrEqual(0);
    expect(g.rawScore()).toBeGreaterThanOrEqual(0);
  });

  it("is deterministic given the same rng", () => {
    const a = new PongGame({ rng: deterministicRng() });
    const b = new PongGame({ rng: deterministicRng() });
    for (let i = 0; i < 30; i++) {
      a.tick(0.05);
      b.tick(0.05);
    }
    expect(a.state().ball.x).toBeCloseTo(b.state().ball.x, 5);
    expect(a.state().ball.y).toBeCloseTo(b.state().ball.y, 5);
  });
});

import { describe, expect, it, vi } from "vitest";
import { GameRuntime, type GameRuntimeOptions } from "./runtime.js";
import type { GameManifest, HandTrackerHandle, Player } from "./types.js";

const manifest: GameManifest = {
  id: "testgame",
  name: "TestGame",
  shortDescription: "",
  version: "0.0.0",
  preferredDurationSec: 30,
  minPlayers: 1,
  maxPlayers: 2,
  cvRequires: ["hands"],
  scoring: "cumulative",
  par: 100,
  demo: {
    previewUrl: "/demos/test.webm",
    howToPlay: "test",
    controls: [{ icon: "✋", label: "wave" }],
  },
};

const players: Player[] = [
  { id: "p1", name: "Alice", color: "#f00", isLocal: true },
  { id: "p2", name: "Bob", color: "#0f0", isLocal: false },
];

const hands: HandTrackerHandle = {
  latest: null,
  confidence: 0,
  ready: false,
  videoSource: null,
  subscribe: () => () => {},
};

function makeRuntime(overrides: Partial<GameRuntimeOptions> = {}) {
  const onScore = vi.fn();
  const onViolation = vi.fn();
  const rt = new GameRuntime({
    manifest,
    sessionId: "s1",
    players,
    localPlayerId: "p1",
    roundDurationSec: 30,
    startsAt: 0,
    hands,
    rng: () => 0.5,
    onScore,
    onViolation,
    ...overrides,
  });
  return { rt, onScore, onViolation };
}

describe("GameRuntime.emitScore validation", () => {
  it("accepts valid scores and normalizes against par", () => {
    const { rt, onScore } = makeRuntime();
    rt.context.emitScore({ playerId: "p1", raw: 50 });
    expect(onScore).toHaveBeenCalledWith(expect.objectContaining({ normalized: 0.5, raw: 50 }));
    expect(rt.latestNormalized()).toEqual({ p1: 0.5, p2: 0 });
  });

  it("clamps normalized to [0, 1] when raw exceeds par", () => {
    const { rt, onScore } = makeRuntime();
    rt.context.emitScore({ playerId: "p1", raw: 500 });
    expect(onScore).toHaveBeenCalledWith(expect.objectContaining({ normalized: 1 }));
    expect(rt.latestNormalized().p1).toBe(1);
  });

  it("drops negative raw values", () => {
    const { rt, onScore, onViolation } = makeRuntime();
    rt.context.emitScore({ playerId: "p1", raw: -5 });
    expect(onScore).not.toHaveBeenCalled();
    expect(onViolation).toHaveBeenCalledWith("negative", expect.any(String));
  });

  it("drops NaN raw values", () => {
    const { rt, onScore, onViolation } = makeRuntime();
    rt.context.emitScore({ playerId: "p1", raw: Number.NaN });
    expect(onScore).not.toHaveBeenCalled();
    expect(onViolation).toHaveBeenCalledWith("nan", expect.any(String));
  });

  it("drops non-finite raw values", () => {
    const { rt, onScore, onViolation } = makeRuntime();
    rt.context.emitScore({ playerId: "p1", raw: Number.POSITIVE_INFINITY });
    expect(onScore).not.toHaveBeenCalled();
    expect(onViolation).toHaveBeenCalledWith("not-finite", expect.any(String));
  });

  it("rejects scores for players not in the session", () => {
    const { rt, onScore, onViolation } = makeRuntime();
    rt.context.emitScore({ playerId: "p99", raw: 10 });
    expect(onScore).not.toHaveBeenCalled();
    expect(onViolation).toHaveBeenCalledWith("unknown-player", expect.any(String));
  });

  it("silently ignores emitScore after destroy()", () => {
    const { rt, onScore, onViolation } = makeRuntime();
    rt.destroy();
    rt.context.emitScore({ playerId: "p1", raw: 42 });
    expect(onScore).not.toHaveBeenCalled();
    expect(onViolation).toHaveBeenCalledWith("post-destroy", expect.any(String));
  });

  it("treats raw as a running total (latest wins, not additive)", () => {
    const { rt } = makeRuntime();
    rt.context.emitScore({ playerId: "p1", raw: 30 });
    rt.context.emitScore({ playerId: "p1", raw: 70 });
    expect(rt.latestNormalized().p1).toBe(0.7);
  });

  it("handles par of 0 without dividing by zero", () => {
    const { rt } = makeRuntime({
      manifest: { ...manifest, par: 0 },
    });
    rt.context.emitScore({ playerId: "p1", raw: 100 });
    expect(rt.latestNormalized().p1).toBe(0);
  });
});

describe("GameRuntime.finalize & onRoundEnd", () => {
  it("fires onRoundEnd listeners with the final normalized scores", () => {
    const { rt } = makeRuntime();
    const cb = vi.fn();
    rt.context.onRoundEnd(cb);
    rt.context.emitScore({ playerId: "p1", raw: 80 });
    rt.context.emitScore({ playerId: "p2", raw: 40 });
    const final = rt.finalize();
    expect(final).toEqual({ p1: 0.8, p2: 0.4 });
    expect(cb).toHaveBeenCalledWith(final);
  });

  it("fires listeners only once even when finalize is called twice", () => {
    const { rt } = makeRuntime();
    const cb = vi.fn();
    rt.context.onRoundEnd(cb);
    rt.finalize();
    rt.finalize();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("returns a subscription that can be cancelled before finalize", () => {
    const { rt } = makeRuntime();
    const cb = vi.fn();
    const unsub = rt.context.onRoundEnd(cb);
    unsub();
    rt.finalize();
    expect(cb).not.toHaveBeenCalled();
  });
});

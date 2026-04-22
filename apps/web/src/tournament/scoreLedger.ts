/**
 * Score ledger — the pure function that converts per-round normalized scores (0..1) into the
 * integer tournament points (0..1000) and cumulative totals (0..3000) shown on the HUD +
 * end screen (plan §1, §4).
 *
 * Kept separate from the React orchestrator so we can unit-test the math without a DOM.
 */

import type { FinalScore } from "@pose-royale/sdk";

/** One finished round's outcome. */
export interface RoundResult {
  gameId: string;
  /** Normalized 0..1 per player, straight from {@link GameRuntime.finalize}. */
  normalized: FinalScore;
  /** Derived integer points 0..1000 per player (roundTo nearest). */
  points: Readonly<Record<string, number>>;
}

export type Cumulative = Readonly<Record<string, number>>;

/**
 * Round a normalized score (0..1) to the integer points used on the scoreboard.
 * Clamped defensively — we trust the SDK to clamp already but this is the public point of
 * last resort.
 */
export function toPoints(normalized: number): number {
  if (Number.isNaN(normalized)) return 0;
  // +Infinity clamps up to 1000, -Infinity clamps down to 0 — same policy as the SDK's
  // internal clamp, so passing the raw normalized through either path gives the same answer.
  const clamped = normalized < 0 ? 0 : normalized > 1 ? 1 : normalized;
  return Math.round(clamped * 1000);
}

export function buildRoundResult(gameId: string, normalized: FinalScore): RoundResult {
  const points: Record<string, number> = {};
  for (const [pid, n] of Object.entries(normalized)) {
    points[pid] = toPoints(n);
  }
  return { gameId, normalized, points };
}

export function cumulative(rounds: readonly RoundResult[]): Cumulative {
  const acc: Record<string, number> = {};
  for (const r of rounds) {
    for (const [pid, p] of Object.entries(r.points)) {
      acc[pid] = (acc[pid] ?? 0) + p;
    }
  }
  return acc;
}

export type Leader =
  | { kind: "winner"; playerId: string; margin: number; totals: Cumulative }
  | { kind: "tie"; tiedIds: readonly string[]; totals: Cumulative };

/** Returns the leader after a set of rounds (or a tie). */
export function leaderOf(rounds: readonly RoundResult[]): Leader {
  const totals = cumulative(rounds);
  const entries = Object.entries(totals);
  if (entries.length === 0) return { kind: "tie", tiedIds: [], totals };

  let max = -Infinity;
  for (const [, v] of entries) if (v > max) max = v;
  const winners = entries.filter(([, v]) => v === max);
  if (winners.length === 1) {
    const [id] = winners[0] as [string, number];
    const others = entries.filter(([k]) => k !== id).map(([, v]) => v);
    const runnerUp = others.length > 0 ? Math.max(...others) : 0;
    return { kind: "winner", playerId: id, margin: max - runnerUp, totals };
  }
  return {
    kind: "tie",
    tiedIds: winners.map(([k]) => k),
    totals,
  };
}

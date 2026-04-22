/**
 * GameRuntime — the orchestrator-facing factory that produces a {@link GameContext} for the
 * current round.
 *
 * Enforces the SDK's scoring and lifecycle invariants in one place so every game gets them
 * for free:
 *   - `emitScore` validates (non-NaN, non-negative), clamps the derived normalized value to
 *     [0, 1], and silently drops calls after {@link GameRuntime.destroy}. In dev builds, it
 *     warns once per violation with the game id so bugs surface early.
 *   - `onRoundEnd` fires exactly once when {@link GameRuntime.finalize} is called.
 *   - `latestNormalized` exposes the running per-player score to the orchestrator for the HUD.
 */

import type {
  FinalScore,
  GameContext,
  GameManifest,
  HandTrackerHandle,
  Player,
  RoomChannel,
  ScoreEvent,
  Unsub,
} from "./types.js";

export interface GameRuntimeOptions {
  manifest: GameManifest;
  sessionId: string;
  players: readonly Player[];
  localPlayerId: string;
  roundDurationSec: number;
  startsAt: number;
  hands: HandTrackerHandle;
  net?: RoomChannel | undefined;
  rng: () => number;
  /** Hook for the orchestrator — fires on every validated emitScore. */
  onScore?: (event: Required<ScoreEvent> & { normalized: number }) => void;
  /**
   * Called when a game violates the contract (e.g. emits NaN, calls emitScore after destroy).
   * Defaults to a dev-only console.warn prefixed with the game id.
   */
  onViolation?: (kind: ViolationKind, detail: string) => void;
}

export type ViolationKind =
  | "nan"
  | "negative"
  | "not-finite"
  | "post-destroy"
  | "unknown-player";

const isDev = (() => {
  try {
    // Vite / Vitest inject these; plain Node falls back to NODE_ENV.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any;
    if (typeof g.import_meta_env?.DEV === "boolean") return g.import_meta_env.DEV as boolean;
    return (g.process?.env?.NODE_ENV ?? "development") !== "production";
  } catch {
    return true;
  }
})();

export class GameRuntime {
  readonly context: GameContext;

  private readonly manifest: GameManifest;
  private readonly playerIds: ReadonlySet<string>;
  private readonly rawByPlayer = new Map<string, number>();
  private readonly warnedKinds = new Set<ViolationKind>();
  private readonly roundEndListeners = new Set<(final: FinalScore) => void>();
  private readonly onScore?: GameRuntimeOptions["onScore"];
  private readonly onViolation: (kind: ViolationKind, detail: string) => void;

  private finalized = false;
  private destroyed = false;

  constructor(opts: GameRuntimeOptions) {
    this.manifest = opts.manifest;
    this.playerIds = new Set(opts.players.map((p) => p.id));
    this.onScore = opts.onScore;
    this.onViolation =
      opts.onViolation ??
      ((kind, detail) => {
        if (!isDev) return;
        if (this.warnedKinds.has(kind)) return;
        this.warnedKinds.add(kind);
        console.warn(`[sdk] ${opts.manifest.id}: ${kind} — ${detail}`);
      });

    for (const p of opts.players) this.rawByPlayer.set(p.id, 0);

    const context: GameContext = {
      sessionId: opts.sessionId,
      players: opts.players,
      localPlayerId: opts.localPlayerId,
      roundDurationSec: opts.roundDurationSec,
      startsAt: opts.startsAt,
      hands: opts.hands,
      ...(opts.net !== undefined ? { net: opts.net } : {}),
      rng: opts.rng,
      emitScore: (ev: ScoreEvent) => this.emit(ev),
      onRoundEnd: (cb: (final: FinalScore) => void): Unsub => {
        this.roundEndListeners.add(cb);
        return () => this.roundEndListeners.delete(cb);
      },
    };
    this.context = context;
  }

  // ───────── runtime-facing API (orchestrator only) ─────────

  /** Current normalized 0..1 scores per player — used by the HUD while the round is live. */
  latestNormalized(): FinalScore {
    const par = this.manifest.par;
    const out: Record<string, number> = {};
    for (const [pid, raw] of this.rawByPlayer) {
      out[pid] = par > 0 ? clamp01(raw / par) : 0;
    }
    return out;
  }

  /** Compute the final normalized per-player scores, fire onRoundEnd listeners once. */
  finalize(): FinalScore {
    if (this.finalized) return this.latestNormalized();
    this.finalized = true;
    const final = this.latestNormalized();
    const listeners = Array.from(this.roundEndListeners);
    this.roundEndListeners.clear();
    for (const cb of listeners) {
      try {
        cb(final);
      } catch (err) {
        if (isDev) {
          console.error(`[sdk] ${this.manifest.id}: onRoundEnd listener threw`, err);
        }
      }
    }
    return final;
  }

  /**
   * Tear down the runtime. After this, emitScore is a no-op (warned in dev), the onRoundEnd
   * listener set is cleared, and finalize() returns the last-known state as a frozen snapshot.
   * The orchestrator calls this AFTER the GameInstance.destroy() returns.
   */
  destroy(): void {
    this.destroyed = true;
    this.roundEndListeners.clear();
  }

  // ───────── private: validation + dispatch ─────────

  private emit(ev: ScoreEvent): void {
    if (this.destroyed) {
      this.onViolation("post-destroy", `emitScore called after destroy (raw=${ev.raw})`);
      return;
    }
    if (!this.playerIds.has(ev.playerId)) {
      this.onViolation(
        "unknown-player",
        `emitScore for playerId=${ev.playerId} not in players list`,
      );
      return;
    }
    if (typeof ev.raw !== "number" || Number.isNaN(ev.raw)) {
      this.onViolation("nan", `emitScore raw was NaN`);
      return;
    }
    if (!Number.isFinite(ev.raw)) {
      this.onViolation("not-finite", `emitScore raw was Infinity / -Infinity`);
      return;
    }
    if (ev.raw < 0) {
      this.onViolation("negative", `emitScore raw was negative (${ev.raw})`);
      return;
    }

    // `raw` is a running total, not a delta — latest wins.
    this.rawByPlayer.set(ev.playerId, ev.raw);

    const at = ev.at ?? performance.now();
    const normalized = this.manifest.par > 0 ? clamp01(ev.raw / this.manifest.par) : 0;
    if (this.onScore) {
      this.onScore({
        playerId: ev.playerId,
        raw: ev.raw,
        label: ev.label ?? "",
        at,
        normalized,
      });
    }
  }
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

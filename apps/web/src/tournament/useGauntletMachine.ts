/**
 * useGauntletMachine — the tournament FSM extracted from TournamentRunner.
 *
 * Keeps all phase transitions, score bookkeeping, module prefetching, and runtime
 * wiring in one place so the renderer stays a dumb function of `state → JSX`. It also
 * makes the state machine unit-testable without mounting React and gives online-play
 * wiring a single seam to sync `phase` and `roundStartsAt` across peers.
 *
 * Responsibilities
 *   - Seeded setlist + GauntletPlan (plus `gameIdForRound` for sudden-death resolution).
 *   - Phase state (`reveal` → `countdown` → `playing` → `interlude` → `final`).
 *   - Per-round GameRuntime creation + score snapshotting.
 *   - Module prefetch during countdowns.
 *   - Sudden-death pick (kept in state, base setlist stays immutable).
 *
 * Out of scope
 *   - Rendering, announcer, dev overlay, opponent bubble → TournamentRunner.tsx.
 *   - Online sync → caller subscribes to `phase` changes and pushes via ctx.net.
 */

import {
  GameRuntime,
  createRng,
  seedFromString,
  type FinalScore,
  type GameContext,
  type GameManifest,
  type GameModule,
  type HandTrackerHandle,
  type Player,
  type RoomChannel,
} from "@pose-royale/sdk";
import { useCallback, useMemo, useRef, useState } from "react";
import { DEDUPE_WHEN_REGISTRY_SIZE_GTE, GAUNTLET } from "./config.js";
import { makePlan, SUDDEN_DEATH_DURATION_MS, type GauntletPlan, type Phase } from "./phases.js";
import { pickSetlist } from "./pickSetlist.js";
import { loadGame, REGISTRY, type RegistryEntry } from "./registry.js";
import {
  buildRoundResult,
  cumulative,
  leaderOf,
  type Cumulative,
  type RoundResult,
} from "./scoreLedger.js";

export interface UseGauntletMachineOptions {
  players: readonly Player[];
  localPlayerId: string;
  sessionId: string;
  seedSource: string;
  hands: HandTrackerHandle;
  net?: RoomChannel | undefined;
  now: () => number;
}

export interface GauntletMachine {
  // ── World ───────────────────────────────────────────────────────────────
  registry: readonly RegistryEntry[];
  setlist: readonly string[];
  plan: GauntletPlan;
  manifests: readonly GameManifest[];
  seed: number;

  // ── State ───────────────────────────────────────────────────────────────
  phase: Phase;
  results: readonly RoundResult[];
  totals: Cumulative;
  liveScores: FinalScore | null;
  currentGameId: string | null;
  currentManifest: GameManifest | null;

  // ── Helpers ─────────────────────────────────────────────────────────────
  gameIdForRound: (roundIndex: number) => string | null;
  contextForRound: (
    manifest: GameManifest,
    startsAt: number,
    durationMs: number,
  ) => (el: HTMLElement) => GameContext;
  /** Live reference to the currently-mounted runtime — used for forfeit cleanup. */
  runtimeRef: React.RefObject<GameRuntime | null>;

  // ── Actions ─────────────────────────────────────────────────────────────
  startRound: (roundIndex: number) => void;
  onCountdownDone: () => void;
  onRoundDeadline: () => void;
  continueFromInterlude: () => void;
  onGameCrash: (roundIndex: number) => void;
  rematch: () => void;
}

export function useGauntletMachine(opts: UseGauntletMachineOptions): GauntletMachine {
  const { players, localPlayerId, sessionId, seedSource, hands, net, now } = opts;

  // ── Registry + setlist (seeded, randomized) ───────────────────────────
  const registry = REGISTRY;
  const setlist = useMemo(() => {
    if (registry.length === 0) return [] as readonly string[];
    const s = seedFromString(seedSource);
    const rng = createRng(s);
    return pickSetlist({
      available: registry.map((r) => r.id),
      rounds: GAUNTLET.rounds,
      rng,
      dedupe: registry.length >= DEDUPE_WHEN_REGISTRY_SIZE_GTE,
    });
  }, [registry, seedSource]);

  const seed = useMemo(() => seedFromString(seedSource), [seedSource]);
  const plan = useMemo(() => makePlan(seed, setlist), [seed, setlist]);

  const manifests = useMemo(
    () =>
      setlist
        .map((id) => registry.find((r) => r.id === id)?.manifest)
        .filter((m): m is GameManifest => m != null),
    [setlist, registry],
  );

  // ── Module cache + prefetch ───────────────────────────────────────────
  const modulesRef = useRef(new Map<string, GameModule>());
  const loadModule = useCallback(async (id: string): Promise<GameModule> => {
    const cached = modulesRef.current.get(id);
    if (cached) return cached;
    const mod = (await loadGame(id)).default;
    modulesRef.current.set(id, mod);
    return mod;
  }, []);

  // ── Core state ────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>(() =>
    registry.length === 0 ? { kind: "final" } : { kind: "reveal" },
  );
  const [results, setResults] = useState<readonly RoundResult[]>([]);
  const [suddenDeathGameId, setSuddenDeathGameId] = useState<string | null>(null);
  // Mirror of runtime.latestNormalized() for render-time use — React 19 forbids
  // reading refs during render.
  const [liveScores, setLiveScores] = useState<FinalScore | null>(null);
  const runtimeRef = useRef<GameRuntime | null>(null);

  // ── Helpers ───────────────────────────────────────────────────────────
  const gameIdForRound = useCallback(
    (roundIndex: number): string | null =>
      plan.setlist[roundIndex] ??
      (roundIndex === plan.setlist.length ? suddenDeathGameId : null),
    [plan.setlist, suddenDeathGameId],
  );

  const contextForRound = useCallback(
    (manifest: GameManifest, roundStartsAt: number, durationMs: number) =>
      (_el: HTMLElement): GameContext => {
        const rng = createRng(seed ^ manifest.id.length);
        const rt = new GameRuntime({
          manifest,
          sessionId,
          players,
          localPlayerId,
          roundDurationSec: durationMs / 1000,
          startsAt: roundStartsAt,
          hands,
          ...(net ? { net } : {}),
          rng,
          onScore: () => {
            const cur = runtimeRef.current;
            if (cur) setLiveScores(cur.latestNormalized());
          },
        });
        runtimeRef.current = rt;
        setLiveScores(rt.latestNormalized());
        return rt.context;
      },
    [seed, sessionId, players, localPlayerId, hands, net],
  );

  // ── Actions ───────────────────────────────────────────────────────────
  const startRound = useCallback(
    (roundIndex: number) => {
      setPhase({
        kind: "countdown",
        roundIndex,
        startsAt: now(),
        durationMs: plan.countdownMs,
      });
      const currentId = gameIdForRound(roundIndex);
      if (currentId) void loadModule(currentId).catch(() => {});
      const nextId = gameIdForRound(roundIndex + 1);
      if (nextId) void loadModule(nextId).catch(() => {});
    },
    [now, plan.countdownMs, loadModule, gameIdForRound],
  );

  const onCountdownDone = useCallback(() => {
    setPhase((p) => {
      if (p.kind !== "countdown") return p;
      if (p.suddenDeath) {
        return {
          kind: "playing",
          roundIndex: p.roundIndex,
          startsAt: now(),
          durationMs: SUDDEN_DEATH_DURATION_MS,
          suddenDeath: true,
        };
      }
      return {
        kind: "playing",
        roundIndex: p.roundIndex,
        startsAt: now(),
        durationMs: plan.roundDurationMs,
      };
    });
  }, [now, plan.roundDurationMs]);

  const onRoundDeadline = useCallback(() => {
    const rt = runtimeRef.current;
    if (!rt) return;
    const final: FinalScore = rt.finalize();
    setPhase((p) => {
      if (p.kind !== "playing") return p;
      const gameId = gameIdForRound(p.roundIndex) ?? "unknown";
      setResults((prev) => [...prev, buildRoundResult(gameId, final)]);
      return { kind: "interlude", justFinished: p.roundIndex };
    });
  }, [gameIdForRound]);

  const continueFromInterlude = useCallback(() => {
    setPhase((p) => {
      if (p.kind !== "interlude") return p;
      const nextIndex = p.justFinished + 1;
      if (nextIndex < plan.setlist.length) {
        startRound(nextIndex);
        return {
          kind: "countdown",
          roundIndex: nextIndex,
          startsAt: now(),
          durationMs: plan.countdownMs,
        };
      }
      // Gauntlet complete — check for tie.
      const lead = leaderOf(results);
      if (lead.kind === "tie" && lead.tiedIds.length > 1 && setlist.length > 0) {
        const rng = createRng(seed ^ 0xbadb17);
        const pickedId = setlist[Math.floor(rng() * setlist.length)] ?? setlist[0] ?? "";
        if (pickedId) {
          setSuddenDeathGameId(pickedId);
          return {
            kind: "countdown",
            roundIndex: plan.setlist.length,
            startsAt: now(),
            durationMs: plan.countdownMs,
            suddenDeath: true,
          };
        }
      }
      return { kind: "final" };
    });
  }, [plan, now, results, setlist, seed, startRound]);

  const onGameCrash = useCallback(
    (roundIndex: number) => {
      const rt = runtimeRef.current;
      const fallback: FinalScore = Object.fromEntries(players.map((p) => [p.id, 0]));
      if (rt) rt.finalize();
      const gameId = gameIdForRound(roundIndex) ?? "unknown";
      setResults((prev) => [...prev, buildRoundResult(gameId, fallback)]);
      setPhase({ kind: "interlude", justFinished: roundIndex });
    },
    [players, gameIdForRound],
  );

  const rematch = useCallback(() => {
    setResults([]);
    setSuddenDeathGameId(null);
    setLiveScores(null);
    setPhase({ kind: "reveal" });
  }, []);

  // ── Derived render-time data ──────────────────────────────────────────
  const currentGameId =
    phase.kind === "playing" || phase.kind === "countdown"
      ? gameIdForRound(phase.roundIndex)
      : null;
  const currentManifest = currentGameId
    ? (registry.find((r) => r.id === currentGameId)?.manifest ?? null)
    : null;
  const totals = cumulative(results);

  return {
    registry,
    setlist,
    plan,
    manifests,
    seed,
    phase,
    results,
    totals,
    liveScores,
    currentGameId,
    currentManifest,
    gameIdForRound,
    contextForRound,
    runtimeRef,
    startRound,
    onCountdownDone,
    onRoundDeadline,
    continueFromInterlude,
    onGameCrash,
    rematch,
  };
}

import {
  GameRuntime,
  createRng,
  seedFromString,
  type FinalScore,
  type GameContext,
  type GameInstance,
  type GameManifest,
  type GameModule,
  type HandTrackerHandle,
  type Player,
  type RoomChannel,
} from "@pose-royale/sdk";
import { BackScope, OpponentBubble, type VideoState } from "@pose-royale/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DevOverlay, type DevOverlayStats } from "./DevOverlay.js";
import { GameBoundary } from "./GameBoundary.js";
import { makePlan, SUDDEN_DEATH_DURATION_MS, type Phase } from "./phases.js";
import { pickSetlist } from "./pickSetlist.js";
import { loadGame, REGISTRY, type RegistryEntry } from "./registry.js";
import { buildRoundResult, cumulative, leaderOf, type RoundResult } from "./scoreLedger.js";
import { Countdown } from "./screens/Countdown.js";
import { FinalScreen } from "./screens/FinalScreen.js";
import { GameStage } from "./screens/GameStage.js";
import { Interlude } from "./screens/Interlude.js";
import { SetlistReveal } from "./screens/SetlistReveal.js";
import { GAUNTLET, DEDUPE_WHEN_REGISTRY_SIZE_GTE } from "./config.js";
import { Announcer } from "../fun/Announcer.js";

export interface TournamentRunnerProps {
  players: readonly Player[];
  localPlayerId: string;
  sessionId: string;
  /**
   * Seed source — typically the room code so both peers get the same setlist. Solo matches
   * pass a fresh random string.
   */
  seedSource: string;
  hands: HandTrackerHandle;
  net?: RoomChannel;
  /**
   * Clock adjusted for the server's "now". For online matches, pass `() => Date.now() + localOffset`
   * computed at room join (plan §9 edge case #8). Solo matches pass `Date.now` directly.
   */
  now?: () => number;
  /** Opponent webcam stream (from WebRTC). If provided, renders as a PIP bubble. */
  remoteVideo?: { state: VideoState; stream: MediaStream | null };
  onExit: () => void;
}

/**
 * The main tournament state machine. Implements the flow diagrammed in plan §4:
 *   Lobby → Randomize → Reveal + demo cards → Countdown → Game × N → Interlude → Final.
 *
 * Solo mode runs the same flow with a single Player; online mode reuses the same FSM and
 * syncs `currentIndex` + `roundStartsAt` across peers via the `net` channel (wiring expands
 * in M4 when the multiplayer package lands).
 */
export function TournamentRunner({
  players,
  localPlayerId,
  sessionId,
  seedSource,
  hands,
  net,
  now = Date.now,
  remoteVideo,
  onExit,
}: TournamentRunnerProps) {
  // ── Registry + setlist (seeded, randomized) ─────────────────────────────
  const registry = REGISTRY;
  const setlist = useMemo(() => {
    if (registry.length === 0) return [] as readonly string[];
    const seed = seedFromString(seedSource);
    const rng = createRng(seed);
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

  // ── Loaded game modules (cached + prefetched) ──────────────────────────
  const modulesRef = useRef(new Map<string, GameModule>());
  const loadModule = useCallback(
    async (id: string): Promise<GameModule> => {
      const cached = modulesRef.current.get(id);
      if (cached) return cached;
      const mod = (await loadGame(id)).default;
      modulesRef.current.set(id, mod);
      return mod;
    },
    [],
  );

  // ── Phase + accumulated results ────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>(() =>
    registry.length === 0 ? { kind: "final" } : { kind: "reveal" },
  );
  const [results, setResults] = useState<readonly RoundResult[]>([]);
  // Game id chosen for a sudden-death tiebreaker (set lazily when we detect a tie at the
  // end of the gauntlet). Kept out of `plan.setlist` so the base setlist stays immutable.
  const [suddenDeathGameId, setSuddenDeathGameId] = useState<string | null>(null);

  // Resolve the game id for a given round index, falling back to the sudden-death pick for
  // indices past the end of the base setlist.
  const gameIdForRound = useCallback(
    (roundIndex: number): string | null =>
      plan.setlist[roundIndex] ?? (roundIndex === plan.setlist.length ? suddenDeathGameId : null),
    [plan.setlist, suddenDeathGameId],
  );
  const runtimeRef = useRef<GameRuntime | null>(null);
  const announcerRef = useRef<Announcer | null>(null);
  if (announcerRef.current === null) announcerRef.current = new Announcer();

  // React to phase transitions with spoken cues. Kept in an effect so it never fires during
  // render and so Strict Mode double-invocations get correctly cancelled.
  useEffect(() => {
    const a = announcerRef.current;
    if (!a) return;
    if (phase.kind === "reveal" && manifests[0]) {
      a.setlistReveal(manifests[0].name);
    } else if (phase.kind === "countdown") {
      const gameId = gameIdForRound(phase.roundIndex);
      const m = gameId ? registry.find((r) => r.id === gameId)?.manifest : undefined;
      if (phase.suddenDeath) a.suddenDeath();
      else if (m) a.roundStart(m.name, phase.roundIndex, plan.setlist.length);
    } else if (phase.kind === "interlude") {
      const r = results[phase.justFinished];
      if (r) {
        let topId: string | null = null;
        let topPts = -1;
        for (const [pid, pts] of Object.entries(r.points)) {
          if (pts > topPts) {
            topPts = pts;
            topId = pid;
          }
        }
        const tied = Object.values(r.points).filter((p) => p === topPts).length > 1;
        const name = tied ? null : (players.find((p) => p.id === topId)?.name ?? null);
        a.roundWinner(name);
      }
    } else if (phase.kind === "final") {
      const lead = leaderOf(results);
      a.finalWinner(
        lead.kind === "winner"
          ? (players.find((p) => p.id === lead.playerId)?.name ?? "Player")
          : null,
      );
    }
  }, [phase, manifests, plan.setlist, registry, results, players, gameIdForRound]);
  useEffect(
    () => () => {
      announcerRef.current?.cancel();
    },
    [],
  );
  // Mirror of runtimeRef.current.latestNormalized() for render-time use (the React 19
  // hooks rule forbids reading refs during render).
  const [liveScores, setLiveScores] = useState<FinalScore | null>(null);

  // Kick off countdown for round 0 after reveal.
  const startRound = useCallback(
    (roundIndex: number) => {
      const startsAt = now() + plan.countdownMs;
      setPhase({
        kind: "countdown",
        roundIndex,
        startsAt: now(),
        durationMs: plan.countdownMs,
      });

      // Warm the module bundle during the countdown — it's free latency hiding.
      const currentId = gameIdForRound(roundIndex);
      if (currentId) void loadModule(currentId).catch(() => {});

      // Prefetch the next round's module in the background.
      const nextId = gameIdForRound(roundIndex + 1);
      if (nextId) void loadModule(nextId).catch(() => {});
      // `startsAt` above is used to compute the playing deadline once the countdown elapses.
      return startsAt;
    },
    [now, plan, loadModule, gameIdForRound],
  );

  // Transition: countdown → playing. We drive this from the Countdown onComplete callback.
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

  // On round-deadline: finalize the runtime, record the result, transition.
  const onRoundDeadline = useCallback(() => {
    const rt = runtimeRef.current;
    if (!rt) return;
    const final: FinalScore = rt.finalize();
    setPhase((p) => {
      if (p.kind !== "playing") return p;
      const gameId = gameIdForRound(p.roundIndex) ?? "unknown";
      const result = buildRoundResult(gameId, final);
      setResults((prev) => [...prev, result]);
      return { kind: "interlude", justFinished: p.roundIndex };
    });
  }, [gameIdForRound]);

  // Continue from interlude: either start next round or go to final (potentially with
  // sudden death). Sudden-death keeps the base setlist immutable — we stash the chosen
  // game id in `suddenDeathGameId` state and `gameIdForRound(setlist.length)` resolves it.
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

  // Build a GameContext for the currently-playing round. Creates a fresh GameRuntime per
  // round so scoring state doesn't leak between games.
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
            // Snapshot the runtime's current normalized scores into React state so the HUD
            // + dev overlay pick up the update without reading a ref during render.
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

  // ── Dev overlay stats ──────────────────────────────────────────────────
  const currentGameId =
    phase.kind === "playing" || phase.kind === "countdown"
      ? gameIdForRound(phase.roundIndex)
      : null;
  const currentManifest = currentGameId
    ? (registry.find((r) => r.id === currentGameId)?.manifest ?? null)
    : null;

  const devStats: DevOverlayStats = (() => {
    const base: DevOverlayStats = {
      phase: phase.kind,
      gameId: currentGameId,
      seed,
      handConfidence: hands.confidence,
    };
    if (liveScores) base.latestScores = liveScores;
    if (phase.kind === "playing" || phase.kind === "countdown") {
      base.secondsLeft = Math.max(0, (phase.startsAt + phase.durationMs - now()) / 1000);
    }
    return base;
  })();

  // ── Rendering ──────────────────────────────────────────────────────────
  const totals = cumulative(results);

  return (
    <BackScope
      action={
        phase.kind === "playing" || phase.kind === "countdown"
          ? {
              kind: "forfeit",
              solo: players.length === 1,
              onForfeit: () => {
                runtimeRef.current?.destroy();
                onExit();
              },
            }
          : { kind: "custom", label: "Exit", run: onExit }
      }
    >
      {registry.length === 0 ? (
        <EmptyRegistryNotice onExit={onExit} />
      ) : phase.kind === "reveal" ? (
        <SetlistReveal manifests={manifests} onDone={() => startRound(0)} />
      ) : phase.kind === "countdown" ? (
        <Countdown
          startsAt={phase.startsAt}
          durationMs={phase.durationMs}
          label={
            currentManifest
              ? `Round ${phase.roundIndex + 1} · ${currentManifest.name}`
              : `Round ${phase.roundIndex + 1}`
          }
          now={now}
          onComplete={onCountdownDone}
        />
      ) : phase.kind === "playing" ? (
        <PlayingPhase
          registry={registry}
          roundIndex={phase.roundIndex}
          gameId={currentGameId}
          deadline={phase.startsAt + phase.durationMs}
          now={now}
          players={players}
          contextForRound={contextForRound}
          onDeadline={onRoundDeadline}
          onCrash={() => {
            const rt = runtimeRef.current;
            const fallback: FinalScore = Object.fromEntries(players.map((p) => [p.id, 0]));
            if (rt) rt.finalize();
            const gameId = currentGameId ?? "unknown";
            setResults((prev) => [...prev, buildRoundResult(gameId, fallback)]);
            setPhase({ kind: "interlude", justFinished: phase.roundIndex });
          }}
        />
      ) : phase.kind === "interlude" ? (
        <Interlude
          players={players}
          justFinished={
            results[phase.justFinished] ?? emptyRound(gameIdForRound(phase.justFinished))
          }
          cumulative={totals}
          nextManifest={(() => {
            const nextId = gameIdForRound(phase.justFinished + 1);
            return nextId ? (registry.find((r) => r.id === nextId)?.manifest ?? null) : null;
          })()}
          heading={
            phase.justFinished + 1 < plan.setlist.length
              ? `After round ${phase.justFinished + 1} of ${plan.setlist.length}`
              : "Final round complete"
          }
          onContinue={continueFromInterlude}
        />
      ) : phase.kind === "final" ? (
        <FinalScreen
          players={players}
          cumulative={totals}
          leader={leaderOf(results)}
          onRematch={() => {
            setResults([]);
            setPhase({ kind: "reveal" });
          }}
          onHome={onExit}
          {...(phase.suddenDeathResolved !== undefined
            ? { suddenDeathResolved: phase.suddenDeathResolved }
            : {})}
        />
      ) : null}

      {remoteVideo && players.length > 1 ? (() => {
        const opp = players.find((p) => !p.isLocal);
        if (!opp) return null;
        const oppScore = liveScores ? (liveScores[opp.id] ?? null) : null;
        return (
          <OpponentBubble
            state={remoteVideo.state}
            stream={remoteVideo.stream}
            name={opp.name}
            color={opp.color}
            score={oppScore}
          />
        );
      })() : null}

      <DevOverlay stats={devStats} />
    </BackScope>
  );
}

function emptyRound(gameId: string | null): RoundResult {
  return { gameId: gameId ?? "unknown", normalized: {}, points: {} };
}

function EmptyRegistryNotice({ onExit }: { onExit: () => void }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "grid",
        placeItems: "center",
        color: "white",
        padding: "2rem",
        textAlign: "center",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem", alignItems: "center" }}>
        <h2 style={{ fontFamily: "var(--font-display)" }}>No games registered yet</h2>
        <p style={{ opacity: 0.7, maxWidth: 400 }}>
          Games get added to the registry in milestones M3 (frootninja) and M4 (ponghub). The
          tournament orchestrator is wired and will run as soon as there's something to play.
        </p>
        <button className="tournament-button" onClick={onExit}>
          Back
        </button>
      </div>
    </div>
  );
}

// Small wrapper so the async module load lives in its own component — lets us use a
// Suspense-friendly pattern without refactoring the whole FSM.
interface PlayingPhaseProps {
  registry: readonly RegistryEntry[];
  roundIndex: number;
  gameId: string | null;
  deadline: number;
  now: () => number;
  players: readonly Player[];
  contextForRound: (
    manifest: GameManifest,
    startsAt: number,
    durationMs: number,
  ) => (el: HTMLElement) => GameContext;
  onDeadline: () => void;
  onCrash: () => void;
}

function PlayingPhase({
  registry,
  roundIndex,
  gameId,
  deadline,
  now,
  players,
  contextForRound,
  onDeadline,
  onCrash,
}: PlayingPhaseProps) {
  const entry = gameId ? (registry.find((r) => r.id === gameId) ?? null) : null;
  const [module, setModule] = useState<GameModule | null>(null);

  useEffect(() => {
    let alive = true;
    if (!entry) return;
    entry
      .load()
      .then((m) => {
        if (alive) setModule(m.default);
      })
      .catch((err) => {
        console.error("[orchestrator] failed to load game module", err);
        onCrash();
      });
    return () => {
      alive = false;
    };
  }, [entry, onCrash]);

  if (!entry) {
    // Registry was mutated out from under us — this shouldn't happen but handle gracefully.
    return null;
  }

  if (!module) {
    return (
      <div className="tournament-screen">
        <span className="tournament-pill">Loading {entry.manifest.name}…</span>
      </div>
    );
  }

  const heading = `Round ${roundIndex + 1} · ${entry.manifest.name}`;

  return (
    <GameBoundary onCrash={onCrash}>
      <GameStage
        module={module}
        contextFor={contextForRound(entry.manifest, now(), deadline - now())}
        deadline={deadline}
        onDeadline={onDeadline}
        onInstance={(_inst: GameInstance) => {
          /* reserved for pause/resume wiring in M4 */
        }}
        heading={heading}
        players={players}
        now={now}
      />
    </GameBoundary>
  );
}

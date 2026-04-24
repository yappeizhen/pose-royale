import type {
  GameContext,
  GameInstance,
  GameManifest,
  GameModule,
  HandTrackerHandle,
  Player,
  RoomChannel,
} from "@pose-royale/sdk";
import { BackButton, BackScope, OpponentBubble, type VideoState } from "@pose-royale/ui";
import { useEffect, useState } from "react";
import { DevOverlay, type DevOverlayStats } from "./DevOverlay.js";
import { GameBoundary } from "./GameBoundary.js";
import { leaderOf, type RoundResult } from "./scoreLedger.js";
import { Countdown } from "./screens/Countdown.js";
import { FinalScreen } from "./screens/FinalScreen.js";
import { GameBriefing } from "./screens/GameBriefing.js";
import { GameSelector } from "./screens/GameSelector.js";
import { GameStage } from "./screens/GameStage.js";
import { Interlude } from "./screens/Interlude.js";
import { useAnnouncer } from "./useAnnouncer.js";
import { useGauntletMachine, type GauntletMachine } from "./useGauntletMachine.js";
import type { RegistryEntry } from "./registry.js";

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
 * The main tournament renderer. All state transitions live in {@link useGauntletMachine};
 * this component just walks the `phase` and mounts the right screen. Spoken cues run in
 * {@link useAnnouncer}. Online sync (M4) will subscribe to `machine.phase` and mirror
 * `roundStartsAt` across peers via `ctx.net` — no changes to the FSM required.
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
  const machine = useGauntletMachine({
    players,
    localPlayerId,
    sessionId,
    seedSource,
    hands,
    net,
    now,
  });

  useAnnouncer({
    phase: machine.phase,
    players,
    registry: machine.registry,
    setlistLength: machine.plan.setlist.length,
    gameIdForRound: machine.gameIdForRound,
    results: machine.results,
  });

  const devStats: DevOverlayStats = (() => {
    const base: DevOverlayStats = {
      phase: machine.phase.kind,
      gameId: machine.currentGameId,
      seed: machine.seed,
      handConfidence: hands.confidence,
    };
    if (machine.liveScores) base.latestScores = machine.liveScores;
    if (machine.phase.kind === "playing" || machine.phase.kind === "countdown") {
      base.secondsLeft = Math.max(
        0,
        (machine.phase.startsAt + machine.phase.durationMs - now()) / 1000,
      );
    }
    return base;
  })();

  const inGame = machine.phase.kind === "playing" || machine.phase.kind === "countdown";

  return (
    <BackScope
      action={
        inGame
          ? {
              kind: "forfeit",
              solo: players.length === 1,
              onForfeit: () => {
                machine.runtimeRef.current?.destroy();
                onExit();
              },
            }
          : { kind: "custom", label: "Exit", run: onExit }
      }
    >
      {/* Every tournament phase has the same top-left back/exit control. The BackScope
          above flips it between Exit (non-gameplay) and Forfeit (gameplay). */}
      <BackButton label={inGame ? "Forfeit" : "Exit"} />

      {machine.registry.length === 0 ? (
        <EmptyRegistryNotice onExit={onExit} />
      ) : (
        <PhaseView machine={machine} players={players} now={now} onExit={onExit} />
      )}

      {remoteVideo && players.length > 1 ? (() => {
        const opp = players.find((p) => !p.isLocal);
        if (!opp) return null;
        const oppScore = machine.liveScores ? (machine.liveScores[opp.id] ?? null) : null;
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

function PhaseView({
  machine,
  players,
  now,
  onExit,
}: {
  machine: GauntletMachine;
  players: readonly Player[];
  now: () => number;
  onExit: () => void;
}) {
  const { phase, plan, registry, results, totals, currentManifest } = machine;

  if (phase.kind === "selector") {
    const label = phase.suddenDeath
      ? "Sudden Death"
      : `Round ${phase.roundIndex + 1} of ${plan.setlist.length}`;
    const poolManifests = registry.map((r) => r.manifest);
    // Prefer the seeded target; fall back to the first registered game if anything
    // went sideways so we never leave the selector mounted with no target.
    const target = currentManifest ?? poolManifests[0];
    if (!target) return null;
    return (
      <GameSelector
        target={target}
        pool={poolManifests}
        label={label}
        durationMs={phase.durationMs}
        onDone={machine.onSelectorDone}
      />
    );
  }

  if (phase.kind === "briefing") {
    if (!currentManifest) return null;
    const label = phase.suddenDeath
      ? "Sudden Death"
      : `Round ${phase.roundIndex + 1} of ${plan.setlist.length}`;
    return (
      <GameBriefing
        manifest={currentManifest}
        label={label}
        autoReadyAfterMs={plan.briefingMinMs}
        onReady={machine.onBriefingReady}
      />
    );
  }

  if (phase.kind === "countdown") {
    return (
      <Countdown
        startsAt={phase.startsAt}
        durationMs={phase.durationMs}
        label={
          currentManifest
            ? `Round ${phase.roundIndex + 1} · ${currentManifest.name}`
            : `Round ${phase.roundIndex + 1}`
        }
        now={now}
        onComplete={machine.onCountdownDone}
      />
    );
  }

  if (phase.kind === "playing") {
    return (
      <PlayingPhase
        registry={registry}
        roundIndex={phase.roundIndex}
        gameId={machine.currentGameId}
        deadline={phase.startsAt + phase.durationMs}
        now={now}
        players={players}
        contextForRound={machine.contextForRound}
        onDeadline={machine.onRoundDeadline}
        onCrash={() => machine.onGameCrash(phase.roundIndex)}
      />
    );
  }

  if (phase.kind === "interlude") {
    const hasNextRound = phase.justFinished + 1 < plan.setlist.length;
    const isSuddenDeath = phase.justFinished >= plan.setlist.length;
    return (
      <Interlude
        players={players}
        justFinished={
          results[phase.justFinished] ??
          emptyRound(machine.gameIdForRound(phase.justFinished))
        }
        cumulative={totals}
        roundNumber={phase.justFinished + 1}
        totalRounds={plan.setlist.length}
        isSuddenDeath={isSuddenDeath}
        hasNextRound={hasNextRound}
        onContinue={machine.continueFromInterlude}
      />
    );
  }

  if (phase.kind === "final") {
    return (
      <FinalScreen
        players={players}
        cumulative={totals}
        leader={leaderOf(results)}
        onRematch={machine.rematch}
        onHome={onExit}
        {...(phase.suddenDeathResolved !== undefined
          ? { suddenDeathResolved: phase.suddenDeathResolved }
          : {})}
      />
    );
  }

  return null;
}

function emptyRound(gameId: string | null): RoundResult {
  return { gameId: gameId ?? "unknown", normalized: {}, points: {} };
}

function EmptyRegistryNotice({ onExit }: { onExit: () => void }) {
  return (
    <div className="app-backdrop" role="status">
      <div className="stack">
        <h1>No games registered yet</h1>
        <p>
          Games get added to the registry in milestones M3 (frootninja) and M4 (ponghub). The
          tournament orchestrator is wired and will run as soon as there's something to play.
        </p>
        <button className="tournament-button primary lg" onClick={onExit}>
          Back
        </button>
      </div>
    </div>
  );
}

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

  if (!entry) return null;

  if (!module) {
    return (
      <div className="tournament-screen">
        <span className="tournament-pill primary">Loading {entry.manifest.name}…</span>
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

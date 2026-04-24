import type { Player } from "@pose-royale/sdk";
import type { Cumulative, RoundResult } from "../scoreLedger.js";
import { GAUNTLET } from "../config.js";
import "./screens.css";

interface Props {
  players: readonly Player[];
  justFinished: RoundResult;
  cumulative: Cumulative;
  /** 1-indexed number of the round that just finished (1..N, or N+1 on sudden death). */
  roundNumber: number;
  /** Total scheduled rounds in the normal gauntlet (excludes sudden death). */
  totalRounds: number;
  /** True if the just-finished round was the sudden-death tiebreaker. */
  isSuddenDeath: boolean;
  /** True if another round (or sudden death) follows — controls CTA copy. */
  hasNextRound: boolean;
  onContinue: () => void;
}

/**
 * Post-round results screen. Deliberately does NOT reveal which game is next — that's
 * the selector's job to dramatise. This page is the "you just played a thing" moment:
 * a playful headline, the game badge, a tier chip that reacts to performance, per-player
 * score rows, and a little progress-pip rail so players can see how deep into the gauntlet
 * they are.
 */
export function Interlude({
  players,
  justFinished,
  cumulative,
  roundNumber,
  totalRounds,
  isSuddenDeath,
  hasNextRound,
  onContinue,
}: Props) {
  const localPlayer = players.find((p) => p.isLocal) ?? players[0];
  const localPoints = localPlayer ? (justFinished.points[localPlayer.id] ?? 0) : 0;
  const localTier = tierForPoints(localPoints);

  const headline = headlineFor({ roundNumber, totalRounds, isSuddenDeath });

  return (
    <div className="tournament-screen">
      <div className="tournament-stack interlude-stack">
        {/* Playful headline instead of the redundant "AFTER ROUND X OF Y" pill —
            players already see the game-name card below, and the progress pips at
            the bottom show how far through the gauntlet we are. */}
        <h1 className="tournament-title interlude-headline">{headline}</h1>

        {/* Game badge — big, rotated, with the game's emoji. This is the "you just
            played THIS" memory anchor. */}
        <div className="tournament-banner interlude-game-card">
          <span className="interlude-game-emoji" aria-hidden>
            {gameEmoji(justFinished.gameId)}
          </span>
          <span className="interlude-game-name">
            {formatTitle(justFinished.gameId)}
          </span>
        </div>

        {/* Tier chip — a playful "how'd you do?" verdict based on the local player's
            points. Reflects the 0..1000 normalised scale, so the bands are stable
            across games. */}
        {localPlayer && localTier ? (
          <span
            className={`interlude-tier interlude-tier--${localTier.variant}`}
            aria-label={`Performance: ${localTier.label}`}
          >
            <span aria-hidden>{localTier.emoji}</span> {localTier.label}
          </span>
        ) : null}

        {/* Score rows. Each player gets name · +delta · running total · max. The max
            context on the right makes cumulative meaningful at a glance. */}
        <div className="tournament-scoreboard interlude-scoreboard">
          {players.map((p) => {
            const delta = justFinished.points[p.id] ?? 0;
            const total = cumulative[p.id] ?? 0;
            return (
              <div
                key={p.id}
                className="row"
                style={{ borderLeft: `8px solid ${p.color}` }}
              >
                <strong>{p.name}</strong>
                <span />
                <span className="delta">+{delta}</span>
                <span className="total">
                  {total}
                  <span className="interlude-total-max">
                    {" / "}
                    {GAUNTLET.maxCumulative}
                  </span>
                </span>
              </div>
            );
          })}
        </div>

        {/* Progress pips — filled dots for completed rounds, outlined for pending.
            A fiery sudden-death pip tacks onto the end if we ever triggered SD. */}
        <div
          className="interlude-progress"
          aria-label={`Round ${Math.min(roundNumber, totalRounds)} of ${totalRounds} complete`}
        >
          {Array.from({ length: totalRounds }, (_, i) => {
            const done = i < Math.min(roundNumber, totalRounds);
            return (
              <span
                key={i}
                className={`interlude-pip${done ? " is-done" : ""}`}
                aria-hidden
              />
            );
          })}
          {isSuddenDeath ? (
            <span className="interlude-pip interlude-pip--sudden is-done" aria-hidden>
              🔥
            </span>
          ) : null}
        </div>

        <button className="tournament-button primary lg" onClick={onContinue}>
          {hasNextRound ? "Spin for next game" : "See final scores"}
        </button>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

function headlineFor({
  roundNumber,
  totalRounds,
  isSuddenDeath,
}: {
  roundNumber: number;
  totalRounds: number;
  isSuddenDeath: boolean;
}): string {
  if (isSuddenDeath) return "Sudden death settled!";
  const remaining = Math.max(0, totalRounds - roundNumber);
  if (remaining === 0) return "Gauntlet complete!";
  if (remaining === 1) return "Final round incoming!";
  if (roundNumber === 1) return "Nice warm-up!";
  return `${remaining} to go!`;
}

interface Tier {
  label: string;
  emoji: string;
  variant: "legendary" | "great" | "solid";
}

/**
 * Returns a congratulatory tier chip only for rounds worth celebrating (500+ pts).
 * Lower scores get no chip at all — a neutral-to-negative label ("OK!", "TOUGH ROUND")
 * reads as a backhanded compliment and clutters the screen without adding meaning.
 * The chip is a reward, not a judgment.
 */
function tierForPoints(points: number): Tier | null {
  if (points >= 900) return { label: "LEGENDARY!", emoji: "🔥", variant: "legendary" };
  if (points >= 700) return { label: "GREAT!", emoji: "⭐", variant: "great" };
  if (points >= 500) return { label: "SOLID", emoji: "👍", variant: "solid" };
  return null;
}

function gameEmoji(id: string): string {
  if (id === "frootninja") return "🍉";
  if (id === "ponghub") return "🏓";
  if (id === "learnsign") return "🤟";
  return "🎮";
}

function formatTitle(gameId: string): string {
  return gameId.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
}

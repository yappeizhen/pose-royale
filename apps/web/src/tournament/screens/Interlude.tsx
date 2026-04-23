import type { Player } from "@pose-royale/sdk";
import type { Cumulative, RoundResult } from "../scoreLedger.js";
import "./screens.css";

interface Props {
  players: readonly Player[];
  justFinished: RoundResult;
  cumulative: Cumulative;
  /** True if another round (or sudden death) follows — controls CTA copy. */
  hasNextRound: boolean;
  /** Shown label e.g. "After Round 1 of 3". */
  heading: string;
  onContinue: () => void;
}

/**
 * Post-round results screen. Deliberately does NOT show which game is next — that's
 * the selector's job to reveal, so keeping it hidden here preserves the randomiser's
 * drama instead of spoiling it with a "Next up: …" card.
 */
export function Interlude({
  players,
  justFinished,
  cumulative,
  hasNextRound,
  heading,
  onContinue,
}: Props) {
  return (
    <div className="tournament-screen">
      <div className="tournament-stack" style={{ gap: "var(--space-4)", width: "100%" }}>
        <span className="tournament-pill">{heading}</span>
        <div className="tournament-banner">
          <h1 className="tournament-title">{formatTitle(justFinished.gameId)}</h1>
        </div>

        <div className="tournament-scoreboard">
          {players.map((p) => (
            <div key={p.id} className="row" style={{ borderLeft: `8px solid ${p.color}` }}>
              <strong>{p.name}</strong>
              <span />
              <span className="delta">+{justFinished.points[p.id] ?? 0}</span>
              <span className="total">{cumulative[p.id] ?? 0}</span>
            </div>
          ))}
        </div>

        <button className="tournament-button primary lg" onClick={onContinue}>
          {hasNextRound ? "Spin for next game" : "See final scores"}
        </button>
      </div>
    </div>
  );
}

function formatTitle(gameId: string): string {
  return gameId.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
}

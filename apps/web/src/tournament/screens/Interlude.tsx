import type { GameManifest, Player } from "@pose-royale/sdk";
import type { Cumulative, RoundResult } from "../scoreLedger.js";
import "./screens.css";

interface Props {
  players: readonly Player[];
  justFinished: RoundResult;
  cumulative: Cumulative;
  nextManifest: GameManifest | null;
  /** Shown label e.g. "After Round 1 of 3". */
  heading: string;
  onContinue: () => void;
}

function gameAccent(id: string): string {
  if (id === "frootninja") return "game-accent-frootninja";
  if (id === "ponghub") return "game-accent-ponghub";
  return "game-accent-default";
}

function gameEmoji(id: string): string {
  if (id === "frootninja") return "🍉";
  if (id === "ponghub") return "🏓";
  return "🎮";
}

export function Interlude({
  players,
  justFinished,
  cumulative,
  nextManifest,
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

        {nextManifest ? (
          <div
            className={`tournament-demo-card ${gameAccent(nextManifest.id)}`}
            style={{ maxWidth: 460 }}
          >
            <div className="card-header">
              <span>
                {gameEmoji(nextManifest.id)} Next up
              </span>
            </div>
            <h3>{nextManifest.name}</h3>
            <p className="how-to">{nextManifest.demo.howToPlay}</p>
          </div>
        ) : null}

        <button className="tournament-button primary lg" onClick={onContinue}>
          {nextManifest ? "Ready!" : "Continue"}
        </button>
      </div>
    </div>
  );
}

function formatTitle(gameId: string): string {
  return gameId.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
}

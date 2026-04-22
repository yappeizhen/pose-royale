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

export function Interlude({ players, justFinished, cumulative, nextManifest, heading, onContinue }: Props) {
  return (
    <div className="tournament-screen">
      <div className="tournament-stack" style={{ gap: "1.25rem", width: "100%" }}>
        <span className="tournament-pill">{heading}</span>
        <h1 className="tournament-title">{formatTitle(justFinished.gameId)}</h1>

        <div className="tournament-scoreboard">
          {players.map((p) => (
            <div key={p.id} className="row" style={{ borderLeft: `6px solid ${p.color}` }}>
              <strong>{p.name}</strong>
              <span style={{ textAlign: "right", opacity: 0.75 }}>
                +{justFinished.points[p.id] ?? 0}
              </span>
              <span style={{ textAlign: "right", fontFamily: "var(--font-display)" }}>
                {cumulative[p.id] ?? 0}
              </span>
            </div>
          ))}
        </div>

        {nextManifest ? (
          <div className="tournament-demo-card" style={{ maxWidth: 460 }}>
            <span className="tournament-pill">Next up</span>
            <h3 style={{ margin: 0 }}>{nextManifest.name}</h3>
            <p style={{ margin: 0, opacity: 0.8 }}>{nextManifest.demo.howToPlay}</p>
          </div>
        ) : null}

        <button className="tournament-button" onClick={onContinue}>
          {nextManifest ? "Ready" : "Continue"}
        </button>
      </div>
    </div>
  );
}

function formatTitle(gameId: string): string {
  return gameId.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
}

import type { Player } from "@pose-royale/sdk";
import { useRef, useState } from "react";
import type { Cumulative, Leader } from "../scoreLedger.js";
import { shareCard } from "../../fun/ShareCard.js";
import "./screens.css";

interface Props {
  players: readonly Player[];
  cumulative: Cumulative;
  leader: Leader;
  onRematch: () => void;
  onHome: () => void;
  suddenDeathResolved?: boolean;
}

export function FinalScreen({
  players,
  cumulative,
  leader,
  onRematch,
  onHome,
  suddenDeathResolved,
}: Props) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  async function onShare(): Promise<void> {
    if (!cardRef.current) return;
    setShareError(null);
    setSharing(true);
    try {
      await shareCard(cardRef.current, {
        filename: "pose-royale-result.png",
        backgroundColor: "#0b1026",
      });
    } catch (err) {
      setShareError(err instanceof Error ? err.message : "Share failed");
    } finally {
      setSharing(false);
    }
  }

  return (
    <div className="tournament-screen">
      <div className="tournament-stack" style={{ gap: "var(--space-4)", width: "100%" }}>
        <div
          ref={cardRef}
          className="tournament-card gradient"
          style={{ width: "min(520px, 100%)" }}
        >
          <span className="tournament-pill">
            {suddenDeathResolved ? "Sudden death resolved" : "Final score"}
          </span>

          {leader.kind === "winner" ? (
            <h1 className="tournament-title accent">
              {players.find((p) => p.id === leader.playerId)?.name ?? "Player"} wins!
            </h1>
          ) : (
            <h1 className="tournament-title">It's a tie</h1>
          )}

          <div className="tournament-scoreboard">
            {players.map((p) => (
              <div key={p.id} className="row" style={{ borderLeft: `6px solid ${p.color}` }}>
                <strong>{p.name}</strong>
                <span />
                <span className="total final">{cumulative[p.id] ?? 0}</span>
              </div>
            ))}
          </div>

          <div className="tournament-meta" style={{ marginTop: "var(--space-2)" }}>
            pose-royale · gauntlet
          </div>
        </div>

        <div className="tournament-hstack">
          <button className="tournament-button accent" onClick={onRematch}>
            Rematch
          </button>
          <button className="tournament-button ghost" onClick={onShare} disabled={sharing}>
            {sharing ? "Preparing…" : "Share MVP"}
          </button>
          <button className="tournament-button ghost" onClick={onHome}>
            Home
          </button>
        </div>
        {shareError ? (
          <p style={{ color: "var(--color-warn)", fontSize: "var(--fs-sm)" }}>
            Couldn't share: {shareError}
          </p>
        ) : null}
      </div>
    </div>
  );
}

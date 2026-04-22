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
      <div className="tournament-stack" style={{ gap: "1.25rem", width: "100%" }}>
        <div
          ref={cardRef}
          className="tournament-share-card"
          style={{
            padding: "1.5rem",
            borderRadius: 24,
            background:
              "linear-gradient(180deg, rgba(125,211,252,0.12) 0%, rgba(255,107,154,0.12) 100%)",
            border: "1px solid rgba(255,255,255,0.12)",
            width: "min(520px, 100%)",
          }}
        >
          <span className="tournament-pill">
            {suddenDeathResolved ? "Sudden death resolved" : "Final score"}
          </span>

          {leader.kind === "winner" ? (
            <h1 className="tournament-title" style={{ color: "var(--accent-2)" }}>
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
                <span style={{ fontFamily: "var(--font-display)", fontSize: "1.5rem" }}>
                  {cumulative[p.id] ?? 0}
                </span>
              </div>
            ))}
          </div>

          <div style={{ marginTop: "1rem", opacity: 0.7, fontSize: "0.85rem" }}>
            pose-royale · gauntlet
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <button className="tournament-button" onClick={onRematch}>
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
          <p style={{ color: "#ff8", fontSize: "0.85rem" }}>Couldn't share: {shareError}</p>
        ) : null}
      </div>
    </div>
  );
}

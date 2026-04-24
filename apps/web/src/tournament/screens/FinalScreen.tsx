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
        backgroundColor: "#ffffff",
      });
    } catch (err) {
      setShareError(err instanceof Error ? err.message : "Share failed");
    } finally {
      setSharing(false);
    }
  }

  const winnerPlayer =
    leader.kind === "winner"
      ? (players.find((p) => p.id === leader.playerId) ?? null)
      : null;
  const winnerName = winnerPlayer?.name ?? null;
  // Conjugate "wins" vs "win" based on grammatical person. In solo mode the local
  // player's name is "You" (second person), which needs "WIN" — "YOU WINS" reads
  // like a Mario cartridge misprint. Any other proper name gets third-person "WINS".
  const winHeadline = winnerPlayer
    ? winnerPlayer.isLocal
      ? `${winnerName?.toUpperCase()} WIN!`
      : `${winnerName?.toUpperCase()} WINS!`
    : null;

  return (
    <div className="tournament-screen">
      <div className="tournament-stack" style={{ gap: "var(--space-4)", width: "100%" }}>
        <div
          ref={cardRef}
          className="tournament-card gradient tilt-none"
          style={{ width: "min(560px, 100%)", alignItems: "center", textAlign: "center" }}
        >
          <span className="tournament-pill accent">
            {suddenDeathResolved ? "Sudden death resolved" : "Final score"}
          </span>

          {winHeadline ? (
            <>
              <div aria-hidden style={{ fontSize: "3.5rem", lineHeight: 1 }}>
                🏆
              </div>
              <div className="tournament-banner">
                <h1 className="tournament-title">{winHeadline}</h1>
              </div>
            </>
          ) : (
            <div className="tournament-banner">
              <h1 className="tournament-title">IT'S A TIE!</h1>
            </div>
          )}

          <div className="tournament-scoreboard" style={{ marginTop: "var(--space-2)" }}>
            {players.map((p) => {
              const isWinner =
                leader.kind === "winner" && leader.playerId === p.id;
              return (
                <div
                  key={p.id}
                  className="row"
                  style={{
                    borderLeft: `8px solid ${p.color}`,
                    background: isWinner ? "#fff9d6" : undefined,
                  }}
                >
                  <strong>{p.name}</strong>
                  <span />
                  <span>{isWinner ? "🏆" : ""}</span>
                  <span className="total final">{cumulative[p.id] ?? 0}</span>
                </div>
              );
            })}
          </div>

          <div className="tournament-meta" style={{ marginTop: "var(--space-2)" }}>
            pose royale · gauntlet
          </div>
        </div>

        <div className="tournament-hstack">
          <button className="tournament-button primary lg" onClick={onRematch}>
            🔄 Rematch
          </button>
          <button
            className="tournament-button secondary"
            onClick={onShare}
            disabled={sharing}
          >
            {sharing ? "📤 Preparing…" : "📤 Share"}
          </button>
          <button className="tournament-button tertiary" onClick={onHome}>
            🏠 Home
          </button>
        </div>
        {shareError ? (
          <p className="tournament-meta" style={{ color: "var(--color-danger)" }}>
            Couldn't share: {shareError}
          </p>
        ) : null}
      </div>
    </div>
  );
}

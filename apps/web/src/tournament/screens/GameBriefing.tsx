/**
 * GameBriefing — a comic-pop how-to-play card shown between the selector reveal and
 * the countdown. Gives the player a moment to read the controls before the round starts.
 *
 * Advances when:
 *  - the player taps "Let's go!", OR
 *  - `autoReadyAfterMs` elapses (so an afk player can't stall the tournament).
 */

import type { GameManifest } from "@pose-royale/sdk";
import { useEffect, useState } from "react";
import "./screens.css";

interface Props {
  manifest: GameManifest;
  /** Pill label (e.g. "Round 1 of 3" or "Sudden Death"). */
  label: string;
  /** Auto-advance after this many ms of inactivity. */
  autoReadyAfterMs: number;
  onReady: () => void;
}

function gameAccent(id: string): string {
  if (id === "frootninja") return "game-accent-frootninja";
  if (id === "ponghub") return "game-accent-ponghub";
  if (id === "learnsign") return "game-accent-learnsign";
  return "game-accent-default";
}

function gameEmoji(id: string): string {
  if (id === "frootninja") return "🍉";
  if (id === "ponghub") return "🏓";
  if (id === "learnsign") return "🤟";
  return "🎮";
}

/**
 * Renders the manifest's preview asset. Images (png/jpg/webp/gif) drop into an `<img>`;
 * clips (webm/mp4) fall back to an auto-playing `<video>`. Gives game authors freedom to
 * ship either until we standardize on a format.
 */
function PreviewMedia({ src, alt }: { src: string; alt: string }) {
  const isVideo = /\.(webm|mp4|mov|ogg)(\?|#|$)/i.test(src);
  if (isVideo) {
    return (
      <video
        src={src}
        muted
        autoPlay
        loop
        playsInline
        className="briefing-card__video"
      />
    );
  }
  return <img src={src} alt={alt} className="briefing-card__video" />;
}

export function GameBriefing({ manifest, label, autoReadyAfterMs, onReady }: Props) {
  const [remaining, setRemaining] = useState(Math.ceil(autoReadyAfterMs / 1000));

  useEffect(() => {
    const end = performance.now() + autoReadyAfterMs;
    const tick = () =>
      setRemaining(Math.max(0, Math.ceil((end - performance.now()) / 1000)));
    tick();
    const interval = window.setInterval(tick, 1000);
    const timer = window.setTimeout(onReady, autoReadyAfterMs);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timer);
    };
  }, [autoReadyAfterMs, onReady]);

  return (
    <div className="tournament-screen">
      <div className="tournament-stack" style={{ gap: "var(--space-4)", width: "100%" }}>
        <span className="tournament-pill">{label}</span>

        <article className={`briefing-card ${gameAccent(manifest.id)}`}>
          <span className="briefing-card__header">
            <span aria-hidden>{gameEmoji(manifest.id)}</span>
            <span>How to play</span>
          </span>
          <h2 className="briefing-card__title">{manifest.name}</h2>
          <PreviewMedia
            src={manifest.demo.previewUrl}
            alt={`${manifest.name} preview`}
          />
          <p className="briefing-card__how">{manifest.demo.howToPlay}</p>
          <ul className="briefing-card__controls">
            {manifest.demo.controls.map((c, i) => (
              <li key={i}>
                <span aria-hidden>{c.icon}</span>
                <span>{c.label}</span>
              </li>
            ))}
          </ul>
        </article>

        <div className="tournament-hstack">
          <button className="tournament-button primary lg" onClick={onReady}>
            ✅ Let's Go!
          </button>
          <span className="tournament-meta">Starts in {remaining}s</span>
        </div>
      </div>
    </div>
  );
}

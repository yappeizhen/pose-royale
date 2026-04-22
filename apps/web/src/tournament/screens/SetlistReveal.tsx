import type { GameManifest } from "@pose-royale/sdk";
import { useEffect, useState } from "react";
import { DEMO_CARD_MS } from "../config.js";
import "./screens.css";

interface Props {
  /** Manifests of all games in this gauntlet, in order. */
  manifests: readonly GameManifest[];
  /** Fires when the player taps Skip OR the auto-timer elapses (plan §1, §4). */
  onDone: () => void;
  /** Override the timer window — handy for tests. */
  autoSkipMs?: number;
}

export function SetlistReveal({ manifests, onDone, autoSkipMs = DEMO_CARD_MS }: Props) {
  const [remaining, setRemaining] = useState(Math.ceil(autoSkipMs / 1000));

  useEffect(() => {
    const end = performance.now() + autoSkipMs;
    const tick = () => setRemaining(Math.max(0, Math.ceil((end - performance.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    const timeout = setTimeout(onDone, autoSkipMs);
    return () => {
      clearInterval(id);
      clearTimeout(timeout);
    };
  }, [autoSkipMs, onDone]);

  return (
    <div className="tournament-screen">
      <div className="tournament-stack" style={{ width: "100%" }}>
        <span className="tournament-pill">The Gauntlet · {manifests.length} rounds</span>
        <h1 className="tournament-title">Your setlist</h1>
        <div className="tournament-demo-grid">
          {manifests.map((m, i) => (
            <DemoCard key={`${m.id}-${i}`} manifest={m} roundIndex={i} />
          ))}
        </div>
        <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
          <span style={{ opacity: 0.6 }}>Auto-continues in {remaining}s</span>
          <button className="tournament-button" onClick={onDone}>
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}

function DemoCard({ manifest, roundIndex }: { manifest: GameManifest; roundIndex: number }) {
  return (
    <article className="tournament-demo-card">
      <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <h3>
          Round {roundIndex + 1} · {manifest.name}
        </h3>
      </header>
      <video
        src={manifest.demo.previewUrl}
        muted
        autoPlay
        loop
        playsInline
        style={{
          width: "100%",
          aspectRatio: "16 / 9",
          borderRadius: 10,
          objectFit: "cover",
          background: "#000",
        }}
      />
      <p style={{ margin: 0, opacity: 0.8 }}>{manifest.demo.howToPlay}</p>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", gap: 12, flexWrap: "wrap" }}>
        {manifest.demo.controls.map((c, i) => (
          <li key={i} style={{ fontSize: "0.85rem", opacity: 0.75 }}>
            <span aria-hidden>{c.icon}</span> {c.label}
          </li>
        ))}
      </ul>
    </article>
  );
}

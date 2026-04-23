import { useEffect, useRef, useState } from "react";

export interface DevOverlayStats {
  /** Current phase label for context. */
  phase: string;
  /** Current game id (or null between rounds). */
  gameId: string | null;
  /** Seed used for this tournament's setlist picker. */
  seed: number;
  /** MediaPipe hand-detection confidence 0..1, if a tracker is running. */
  handConfidence?: number;
  /** Firebase round-trip time in ms, if a room is active. */
  rttMs?: number;
  /** Latest normalized ScoreEvent (keyed by playerId). */
  latestScores?: Readonly<Record<string, number>>;
  /** Seconds remaining in the current round (if any). */
  secondsLeft?: number;
}

interface Props {
  stats: DevOverlayStats;
}

/**
 * Heads-up overlay (plan §1). Toggled with the `~` / backtick key in dev builds. Shows FPS
 * and the plan's called-out debug signals with zero production cost — we gate on
 * `import.meta.env.DEV` so the component renders to null in prod bundles.
 */
export function DevOverlay({ stats }: Props) {
  const [visible, setVisible] = useState(false);
  const [fps, setFps] = useState(0);
  // Initialized to 0 and set in the effect — `performance.now()` is impure so we don't read
  // it during render.
  const fpsRef = useRef({ frames: 0, last: 0 });
  const rafRef = useRef<number | null>(null);

  // Toggle on `~` / `` ` `` (same physical key; differs by shift state).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "`" || e.key === "~") setVisible((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Lightweight FPS meter — only spun up while the overlay is visible to avoid wasting cycles.
  useEffect(() => {
    if (!visible) return;
    const ref = fpsRef.current;
    ref.frames = 0;
    ref.last = performance.now();
    const tick = () => {
      ref.frames += 1;
      const now = performance.now();
      if (now - ref.last >= 500) {
        setFps(Math.round((ref.frames * 1000) / (now - ref.last)));
        ref.frames = 0;
        ref.last = now;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [visible]);

  if (!import.meta.env.DEV || !visible) return null;

  const rows: [string, string][] = [
    ["phase", stats.phase],
    ["game", stats.gameId ?? "—"],
    ["seed", String(stats.seed)],
    ["fps", String(fps)],
    ["hand conf", stats.handConfidence != null ? stats.handConfidence.toFixed(2) : "—"],
    ["rtt", stats.rttMs != null ? `${stats.rttMs} ms` : "—"],
    ["t−", stats.secondsLeft != null ? `${stats.secondsLeft.toFixed(1)}s` : "—"],
    [
      "scores",
      stats.latestScores
        ? Object.entries(stats.latestScores)
            .map(([k, v]) => `${k}:${(v * 1000).toFixed(0)}`)
            .join(" ")
        : "—",
    ],
  ];

  return (
    <div role="status" className="dev-overlay">
      <strong className="dev-overlay__title">dev · ~ to toggle</strong>
      {rows.map(([k, v]) => (
        <div key={k} className="dev-overlay__row">
          <span className="dev-overlay__key">{k}</span>
          <span>{v}</span>
        </div>
      ))}
    </div>
  );
}

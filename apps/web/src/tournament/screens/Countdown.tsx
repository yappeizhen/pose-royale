import { useEffect, useState } from "react";
import "./screens.css";

interface Props {
  /** Wall-clock ms when the countdown started (adjusted for local offset). */
  startsAt: number;
  /** Total duration, e.g. 3000 for a 3-2-1 countdown. */
  durationMs: number;
  label?: string;
  now?: () => number;
  onComplete: () => void;
}

export function Countdown({ startsAt, durationMs, label, now = Date.now, onComplete }: Props) {
  const [remaining, setRemaining] = useState(() => Math.ceil((startsAt + durationMs - now()) / 1000));

  useEffect(() => {
    let raf = 0;
    let done = false;
    const tick = () => {
      const rem = startsAt + durationMs - now();
      if (rem <= 0) {
        if (!done) {
          done = true;
          setRemaining(0);
          onComplete();
        }
        return;
      }
      setRemaining(Math.ceil(rem / 1000));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [startsAt, durationMs, now, onComplete]);

  return (
    <div className="tournament-screen" aria-live="polite">
      <div className="tournament-stack" style={{ gap: "var(--space-4)" }}>
        {label && <span className="tournament-pill primary">{label}</span>}
        <div key={remaining} className="tournament-countdown-digit">
          {remaining <= 0 ? "GO!" : remaining}
        </div>
      </div>
    </div>
  );
}

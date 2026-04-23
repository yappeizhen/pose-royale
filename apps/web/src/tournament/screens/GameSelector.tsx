/**
 * GameSelector — slot-machine reveal of "which game next?".
 *
 * The actual pick is already baked into the seeded setlist in useGauntletMachine; this
 * component is a theatrical reveal layer. It renders a vertical reel of game cells that
 * animates from the first cell to the target cell (last) with an ease-out curve so the
 * wheel feels like it's spinning fast then slowing to a stop.
 *
 * Why not pick inside this component?  Because multiplayer peers need to agree on the
 * outcome without handshakes, and the seeded pick guarantees that. The selector is cosmetic.
 */

import type { GameManifest } from "@pose-royale/sdk";
import { useEffect, useMemo, useState } from "react";
import "./screens.css";

interface Props {
  /** The game we will *end on* — from the seeded setlist. */
  target: GameManifest;
  /** All registered games cycled through during the spin. Must include `target`. */
  pool: readonly GameManifest[];
  /** Top label (e.g. "Round 2 of 3" or "Sudden Death!"). */
  label: string;
  /** Total animation length before `onDone` fires. Includes the "landed" dwell. */
  durationMs: number;
  onDone: () => void;
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

/** How long the reel dwells after landing before we fire `onDone`. */
const LANDED_DWELL_MS = 650;
/** Height of a single reel cell in pixels. Kept in sync with the CSS `--reel-cell-h`. */
const REEL_CELL_H = 80;
/** How many cells make up the reel. More = longer visible spin = more drama. */
const REEL_LENGTH = 22;

type SpinPhase = "start" | "spinning" | "landed";

export function GameSelector({ target, pool, label, durationMs, onDone }: Props) {
  // The reel is a deterministic sequence of games. We cycle through the pool (which
  // includes the target) and *always* plant the target in the final slot. The pre-target
  // slots can include the target too; with a fast spin it reads as genuine cycling rather
  // than a loaded reel, but the final rest position is what matters.
  const reelItems = useMemo<readonly GameManifest[]>(() => {
    if (pool.length === 0) return [target];
    const items: GameManifest[] = [];
    for (let i = 0; i < REEL_LENGTH - 1; i++) {
      items.push(pool[i % pool.length]!);
    }
    items.push(target);
    return items;
  }, [pool, target]);

  const [phase, setPhase] = useState<SpinPhase>("start");

  const spinMs = Math.max(400, durationMs - LANDED_DWELL_MS);

  useEffect(() => {
    // Two RAFs so the browser commits the initial `translateY` *before* flipping to the
    // spinning class that activates the transition. Without this the first render already
    // paints in-transition and we lose the spin.
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setPhase("spinning"));
    });
    const landTimer = window.setTimeout(
      () => setPhase("landed"),
      // Give the CSS transition a hair of extra time to finish before we swap to landed
      // styling so the two don't visually collide.
      spinMs + 60,
    );
    const doneTimer = window.setTimeout(onDone, durationMs);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      window.clearTimeout(landTimer);
      window.clearTimeout(doneTimer);
    };
  }, [spinMs, durationMs, onDone]);

  // Initial position: item[0] centered in the viewport (middle cell of 3).
  // End position: item[N-1] (= target) centered in the viewport.
  const initialY = REEL_CELL_H;
  const endY = REEL_CELL_H * (2 - reelItems.length);
  const translateY = phase === "start" ? initialY : endY;

  return (
    <div className="tournament-screen" aria-live="polite">
      <div className="tournament-stack" style={{ gap: "var(--space-4)" }}>
        <span className="tournament-pill primary">{label}</span>
        <div className="tournament-banner">
          <h1 className="tournament-title">
            {phase === "landed" ? "LOCKED IN!" : "NEXT UP…"}
          </h1>
        </div>

        <div
          className={`selector-reel-viewport ${gameAccent(target.id)} ${phase === "landed" ? "is-landed" : ""}`}
        >
          <span className="selector-reel-spotlight" aria-hidden />
          <div
            className="selector-reel"
            style={{
              transform: `translateY(${translateY}px)`,
              transition:
                phase === "spinning"
                  ? `transform ${spinMs}ms cubic-bezier(0.1, 0.75, 0.25, 1)`
                  : "none",
            }}
          >
            {reelItems.map((m, i) => (
              <div
                key={i}
                className={`selector-reel__cell ${gameAccent(m.id)}`}
                aria-hidden={i !== reelItems.length - 1}
              >
                <span className="selector-reel__emoji" aria-hidden>
                  {gameEmoji(m.id)}
                </span>
                <span className="selector-reel__name">{m.name}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="tournament-meta">
          {phase === "landed" ? "Read your briefing next…" : "Randomising…"}
        </p>
      </div>
    </div>
  );
}

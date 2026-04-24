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

/**
 * How long the reel dwells on the winning game after the spin stops, before we fire
 * `onDone` and move on to the briefing. Long enough for the player to read the "LOCKED
 * IN!" banner and recognise the game that was picked.
 */
const LANDED_DWELL_MS = 1_900;
/** Height of a single reel cell in pixels. Kept in sync with the CSS `--reel-cell-h`. */
const REEL_CELL_H = 80;
/** How many cells make up the reel. More = longer visible spin = more drama. */
const REEL_LENGTH = 22;

type SpinPhase = "spinning" | "landed";

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

  // The reel kicks into "spinning" immediately on mount — previously we had an idle
  // pre-spin pause, but the idle→spinning transition read as a jolt (banner + drum
  // popping in out of nowhere). Starting in motion is smoother.
  const [phase, setPhase] = useState<SpinPhase>("spinning");
  // `hasStarted` controls the reel's translateY. Starts false so the first paint shows
  // the reel at its initial position (cell[0] centred), then flips to true on the very
  // next animation frame to kick the CSS transition into the landing position. Without
  // this two-step, React would mount the element with the end transform already applied
  // and the reel would snap into place without animating.
  const [hasStarted, setHasStarted] = useState(false);

  // Total layout: [spinMs spinning] → [LANDED_DWELL_MS landed].
  // Floor the spin at 800ms so tiny `durationMs` values don't cause a teleport — the
  // bezier S-curve below needs room to breathe.
  const spinMs = Math.max(800, durationMs - LANDED_DWELL_MS);

  useEffect(() => {
    const timers: number[] = [];
    // 1. Next frame: kick off the reel translation. rAF ensures the browser paints the
    //    initial cell[0] position first so the CSS transition has somewhere to animate
    //    from.
    const rafId = requestAnimationFrame(() => setHasStarted(true));
    // 2. Spin completes → land. Small +60ms buffer so the CSS transition finishes
    //    before we swap on the "is-landed" styling.
    timers.push(window.setTimeout(() => setPhase("landed"), spinMs + 60));
    // 3. Dwell completes → caller advances the FSM.
    timers.push(window.setTimeout(onDone, durationMs));
    return () => {
      cancelAnimationFrame(rafId);
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [spinMs, durationMs, onDone]);

  // Initial position: item[0] centered in the viewport (middle cell of 3).
  // End position: item[N-1] (= target) centered in the viewport.
  const initialY = REEL_CELL_H;
  const endY = REEL_CELL_H * (2 - reelItems.length);
  const translateY = hasStarted ? endY : initialY;

  return (
    <div className="tournament-screen" aria-live="polite">
      <div className="tournament-stack" style={{ gap: "var(--space-4)" }}>
        <span className="tournament-pill primary">{label}</span>
        {/* Banner + flair are visible for the entire selector screen — there's no idle
            pre-spin pause any more, because the idle→spinning pop-in read as a jolt.
            The text swaps from "DRUMROLL, PLEASE…" to the target game's name when the
            wheel lands. */}
        <div className="tournament-banner">
          <h1 className="tournament-title">
            {phase === "spinning"
              ? "DRUMROLL, PLEASE…"
              : `${gameEmoji(target.id)} ${target.name.toUpperCase()}!`}
          </h1>
        </div>

        {/* Animated flair between the banner and the reel.
            - spinning: shaking drum + floating music notes for the drumroll
            - landed:   the drum "morphs" into a 🎉 party popper that springs in
            Keeping both phases in the same vertical slot makes it feel like one continuous
            beat → payoff motion rather than two separate screens. */}
        <SelectorFlair phase={phase} />

        <div
          className={`selector-reel-viewport ${gameAccent(target.id)} ${phase === "landed" ? "is-landed" : ""}`}
        >
          <span className="selector-reel-spotlight" aria-hidden />
          <div
            className="selector-reel"
            style={{
              transform: `translateY(${translateY}px)`,
              // cubic-bezier(0.7, 0.0, 0.2, 1.0) is a strong ease-in-out: the reel
              // starts gently, accelerates through the middle of the spin, then
              // decelerates sharply onto the target — matching how a real prize wheel
              // feels, rather than the fast-then-slow "coast" of a pure ease-out.
              transition:
                phase === "spinning"
                  ? `transform ${spinMs}ms cubic-bezier(0.7, 0.0, 0.2, 1.0)`
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

        {/* Caption only renders once the wheel lands — during idle/spinning the banner
            (or absence thereof) carries the message. */}
        {phase === "landed" ? (
          <p className="tournament-meta">Time to play! 🎮</p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Pairs with the selector's spin → land progression:
 *
 *   - "spinning" → the 🥁 shakes vigorously while four music notes (♪ ♫ ♬ ♩) float
 *     up and fade around it on staggered cycles, reading as "the drum is being played".
 *   - "landed"   → the drum morphs into a 🎉 party popper with a spring-in pop + gentle
 *     idle bounce, signalling "we've picked a game, get excited".
 *
 * `prefers-reduced-motion: reduce` short-circuits all the animations — the drum just
 * sits there politely and the party popper snaps in without the bounce.
 */
function SelectorFlair({ phase }: { phase: "spinning" | "landed" }) {
  if (phase === "landed") {
    return (
      <div className="selector-drumroll" aria-hidden>
        <span
          key="party"
          className="selector-drumroll__party"
        >
          🎉
        </span>
      </div>
    );
  }
  return (
    <div className="selector-drumroll" aria-hidden>
      <span className="selector-drumroll__note selector-drumroll__note--a">♪</span>
      <span className="selector-drumroll__note selector-drumroll__note--b">♫</span>
      <span className="selector-drumroll__drum">🥁</span>
      <span className="selector-drumroll__note selector-drumroll__note--c">♬</span>
      <span className="selector-drumroll__note selector-drumroll__note--d">♩</span>
    </div>
  );
}

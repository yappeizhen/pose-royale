import type { GameContext, GameInstance, GameModule, Player } from "@pose-royale/sdk";
import { useEffect, useRef, useState } from "react";
import "./screens.css";

interface Props {
  module: GameModule;
  contextFor(el: HTMLElement): GameContext;
  /** Deadline ms (wall-clock) when the round ends. */
  deadline: number;
  onDeadline: () => void;
  onInstance: (instance: GameInstance) => void;
  /** Header shown on top of the game — e.g. "Round 2 of 3 · Ponghub". */
  heading: string;
  players: readonly Player[];
  now?: () => number;
}

/**
 * Mounts a {@link GameModule} into a platform-owned div and drives the round's deadline.
 * All the lifecycle contracts (start, pause, destroy) are orchestrated here — games only
 * implement the verbs and never touch the timer.
 */
export function GameStage({
  module,
  contextFor,
  deadline,
  onDeadline,
  onInstance,
  heading,
  players,
  now = Date.now,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<GameInstance | null>(null);

  // Mount/destroy the game. We never re-mount on prop changes — the orchestrator rebuilds
  // the stage by remounting this component between rounds, which is safer than trying to
  // swap a live GameInstance in place.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ctx = contextFor(el);
    const instance = module.mount(el, ctx);
    instanceRef.current = instance;
    onInstance(instance);
    instance.start();
    return () => {
      try {
        instance.destroy();
      } catch (err) {
        console.error("[orchestrator] game destroy() threw", err);
      } finally {
        // Belt-and-braces: if the game left anything behind, wipe the host node.
        while (el.firstChild) el.removeChild(el.firstChild);
        instanceRef.current = null;
      }
    };
    // contextFor is intentionally omitted from deps — its identity changing mid-round would
    // otherwise remount the game.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [module]);

  // Round deadline.
  useEffect(() => {
    let raf = 0;
    let fired = false;
    const tick = () => {
      if (now() >= deadline) {
        if (!fired) {
          fired = true;
          onDeadline();
        }
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [deadline, now, onDeadline]);

  return (
    // Transparent root — the webcam background in App.tsx stays visible behind the game.
    <div className="stage-root">
      <header className="stage-header">
        <span className="title">{heading}</span>
        <StageClock deadline={deadline} now={now} />
        <div className="chips">
          {players.map((p) => (
            <span
              key={p.id}
              className="stage-chip"
              style={
                {
                  "--stage-chip-bg": `${p.color}33`,
                  "--stage-chip-fg": p.color,
                  "--stage-chip-border": `${p.color}66`,
                } as React.CSSProperties
              }
            >
              {p.name}
            </span>
          ))}
        </div>
      </header>
      <div ref={hostRef} className="stage-host" />
    </div>
  );
}

/**
 * Ticking "seconds remaining" badge pinned to the top of the stage. Polls at 200ms
 * because seconds-granular display doesn't need per-frame updates, and keeping it out
 * of the RAF loop means the game gets all of the frame budget. Turns red + pulses in
 * the final 5 seconds so the player gets a clear "hurry up" cue.
 */
function StageClock({ deadline, now }: { deadline: number; now: () => number }) {
  const [secondsLeft, setSecondsLeft] = useState(() =>
    Math.max(0, Math.ceil((deadline - now()) / 1000)),
  );

  useEffect(() => {
    // Tick immediately so the badge is correct on mount rather than waiting 200ms.
    const sync = () =>
      setSecondsLeft(Math.max(0, Math.ceil((deadline - now()) / 1000)));
    sync();
    const id = window.setInterval(sync, 200);
    return () => window.clearInterval(id);
  }, [deadline, now]);

  const isWarning = secondsLeft <= 5 && secondsLeft > 0;
  const isOver = secondsLeft <= 0;

  return (
    <span
      className={`stage-clock${isWarning ? " is-warning" : ""}${isOver ? " is-over" : ""}`}
      aria-live="polite"
      aria-label={`${secondsLeft} seconds remaining`}
    >
      <span aria-hidden>⏱</span>
      <span className="stage-clock__num">{secondsLeft}</span>
      <span className="stage-clock__unit">s</span>
    </span>
  );
}

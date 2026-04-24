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

  // Effective deadline. When the game exposes a `ready` promise, we freeze the
  // deadline at the original value until the promise resolves, then shift it
  // forward by the exact warmup duration so the player gets a full round of
  // actual play-time — not a round minus however many seconds the model took
  // to load. `null` means "not armed yet; clock is frozen at full duration".
  const [effectiveDeadline, setEffectiveDeadline] = useState<number | null>(null);
  // How long the clock should display while frozen during warmup. Captured at
  // mount time from `deadline - now()`, which is ≈ the full round duration.
  const [frozenSecondsLeft, setFrozenSecondsLeft] = useState<number | null>(null);

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

    const mountedAt = now();
    const readyPromise = instance.ready;

    if (!readyPromise) {
      // Legacy path: game is ready immediately. Arm the deadline as given.
      setEffectiveDeadline(deadline);
      instance.start();
    } else {
      // Freeze the clock at the full configured round duration while the game
      // warms up. `Math.ceil` matches the `StageClock` display formula so the
      // frozen value and the first live tick line up cleanly.
      setFrozenSecondsLeft(Math.max(0, Math.ceil((deadline - mountedAt) / 1000)));

      // Idempotent latch — both the timeout and the promise race to arm, but
      // only the first through shifts the clock and calls start().
      let armed = false;
      const arm = () => {
        if (armed) return;
        armed = true;
        const warmupMs = now() - mountedAt;
        setEffectiveDeadline(deadline + warmupMs);
        setFrozenSecondsLeft(null);
        try {
          instance.start();
        } catch (err) {
          console.error("[orchestrator] game start() threw", err);
        }
      };

      // Safety net: if the game's ready promise never settles (pathological
      // model load, broken backend), start the round anyway after 15 s. The
      // game's own error UI is responsible for telling the player what went
      // wrong; we just refuse to hang indefinitely.
      const timeoutId = window.setTimeout(() => {
        if (armed) return;
        console.warn(
          "[orchestrator] game.ready didn't settle in 15s; starting the round anyway",
        );
        arm();
      }, 15_000);

      readyPromise
        .then(() => {
          window.clearTimeout(timeoutId);
          arm();
        })
        .catch((err: unknown) => {
          window.clearTimeout(timeoutId);
          // The game's own UI is expected to surface the error; we still start
          // the round so the player isn't stuck on a loading screen.
          console.error("[orchestrator] game.ready rejected", err);
          arm();
        });
    }

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

  // Round deadline. Skipped entirely while `effectiveDeadline` is null — the
  // game is still warming up and the clock is frozen.
  useEffect(() => {
    if (effectiveDeadline === null) return;
    let raf = 0;
    let fired = false;
    const tick = () => {
      if (now() >= effectiveDeadline) {
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
  }, [effectiveDeadline, now, onDeadline]);

  return (
    // Transparent root — the webcam background in App.tsx stays visible behind the game.
    <div className="stage-root">
      <header className="stage-header">
        <span className="title">{heading}</span>
        <StageClock
          deadline={effectiveDeadline ?? deadline}
          now={now}
          frozenSecondsLeft={frozenSecondsLeft}
        />
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
 *
 * When `frozenSecondsLeft` is provided, the clock displays that number and does
 * NOT tick — used while the game is still warming up async dependencies. Once
 * cleared, the clock resumes counting down from the (now-shifted) deadline.
 */
function StageClock({
  deadline,
  now,
  frozenSecondsLeft,
}: {
  deadline: number;
  now: () => number;
  frozenSecondsLeft: number | null;
}) {
  const [secondsLeft, setSecondsLeft] = useState(() =>
    Math.max(0, Math.ceil((deadline - now()) / 1000)),
  );

  useEffect(() => {
    if (frozenSecondsLeft !== null) return;
    // Tick immediately so the badge is correct on mount rather than waiting 200ms.
    const sync = () =>
      setSecondsLeft(Math.max(0, Math.ceil((deadline - now()) / 1000)));
    sync();
    const id = window.setInterval(sync, 200);
    return () => window.clearInterval(id);
  }, [deadline, now, frozenSecondsLeft]);

  const displayed = frozenSecondsLeft ?? secondsLeft;
  const isWarming = frozenSecondsLeft !== null;
  const isWarning = !isWarming && displayed <= 5 && displayed > 0;
  const isOver = !isWarming && displayed <= 0;

  return (
    <span
      className={`stage-clock${isWarning ? " is-warning" : ""}${isOver ? " is-over" : ""}${isWarming ? " is-warming" : ""}`}
      aria-live="polite"
      aria-label={
        isWarming
          ? `Warming up; ${displayed} seconds will start after the game loads`
          : `${displayed} seconds remaining`
      }
    >
      <span aria-hidden>⏱</span>
      <span className="stage-clock__num">{displayed}</span>
      <span className="stage-clock__unit">s</span>
    </span>
  );
}

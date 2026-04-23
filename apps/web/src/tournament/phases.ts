/**
 * The tournament runs as a finite state machine. Centralizing the phase types here lets the
 * runner, the HUD, and the dev overlay all refer to one definition.
 *
 * Per-round flow:
 *   selector → briefing → countdown → playing → interlude → (selector | final)
 *
 * The full setlist is still pre-computed (seeded) at match start so multiplayer peers
 * stay synced; the selector phase is a theatrical animation that *reveals* the next pick
 * one round at a time rather than showing the whole setlist up front.
 */

import { BRIEFING_MIN_MS, COUNTDOWN_SEC, GAUNTLET, SELECTOR_SEC, SUDDEN_DEATH_SEC } from "./config.js";

export type Phase =
  /**
   * Animated random-selector — visualizes the seeded pick for the upcoming round.
   * `startsAt` + `durationMs` gate the animation; when it lands, we advance to `briefing`.
   */
  | {
      kind: "selector";
      roundIndex: number;
      startsAt: number;
      durationMs: number;
      suddenDeath?: boolean;
    }
  /**
   * How-to-play card for the picked game. Waits for the player's "Let's go!" tap.
   * (Auto-advances after `BRIEFING_MIN_MS` in solo mode if the player idles, so a
   * distracted player can't stall the tournament forever.)
   */
  | {
      kind: "briefing";
      roundIndex: number;
      shownAt: number;
      suddenDeath?: boolean;
    }
  /** Count "3, 2, 1, GO". `startsAt` is when the countdown began. */
  | {
      kind: "countdown";
      roundIndex: number;
      startsAt: number;
      durationMs: number;
      suddenDeath?: boolean;
    }
  /** Game mounted, running. `startsAt` is the wall-clock moment the round began. */
  | {
      kind: "playing";
      roundIndex: number;
      startsAt: number;
      durationMs: number;
      suddenDeath?: boolean;
    }
  /** Between rounds — show scores + preview the next demo card. */
  | { kind: "interlude"; justFinished: number }
  /** Final scores + MVP + rematch. `suddenDeathResolved` flags if we got here via sudden death. */
  | { kind: "final"; suddenDeathResolved?: boolean };

export interface GauntletPlan {
  seed: number;
  setlist: readonly string[];
  roundDurationMs: number;
  countdownMs: number;
  selectorMs: number;
  briefingMinMs: number;
}

export function makePlan(seed: number, setlist: readonly string[]): GauntletPlan {
  return {
    seed,
    setlist,
    roundDurationMs: GAUNTLET.durationSec * 1000,
    countdownMs: COUNTDOWN_SEC * 1000,
    selectorMs: SELECTOR_SEC * 1000,
    briefingMinMs: BRIEFING_MIN_MS,
  };
}

export const SUDDEN_DEATH_DURATION_MS = SUDDEN_DEATH_SEC * 1000;

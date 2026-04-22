/**
 * The tournament runs as a finite state machine. Centralizing the phase types here lets the
 * runner, the HUD, and the dev overlay all refer to one definition.
 */

import { COUNTDOWN_SEC, GAUNTLET, SUDDEN_DEATH_SEC } from "./config.js";

export type Phase =
  /** Showing the seeded setlist + demo cards. Advance on Skip or timeout. */
  | { kind: "reveal" }
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
}

export function makePlan(seed: number, setlist: readonly string[]): GauntletPlan {
  return {
    seed,
    setlist,
    roundDurationMs: GAUNTLET.durationSec * 1000,
    countdownMs: COUNTDOWN_SEC * 1000,
  };
}

export const SUDDEN_DEATH_DURATION_MS = SUDDEN_DEATH_SEC * 1000;

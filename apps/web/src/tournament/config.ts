/**
 * Tournament constants that the plan calls out as tweakable but stable for v1 (plan §1).
 * Keeping them in one file so we don't hunt through code to change round counts later.
 */

export const GAUNTLET = {
  /** Number of games per tournament. */
  rounds: 3,
  /** Duration of each round, in seconds. */
  durationSec: 30,
  /** Max cumulative score = rounds * 1000. */
  maxCumulative: 3 * 1000,
} as const;

/** Demo-card reveal lifetime, in ms — or until the player hits Skip, whichever comes first. */
export const DEMO_CARD_MS = 60_000;

/** Countdown from "3" to "GO!". */
export const COUNTDOWN_SEC = 3;

/** Sudden-death round length. */
export const SUDDEN_DEATH_SEC = 15;

/** Heartbeat cadence for the "opponent disconnected?" check. */
export const HEARTBEAT_MS = 3_000;

/** Grace window before an opponent who stops heartbeating auto-forfeits remaining rounds. */
export const DISCONNECT_GRACE_MS = 15_000;

/**
 * Once the registry contains at least this many games we enable strict no-repeat picking.
 * During the 2-game era (v1) we allow repeats but never back-to-back (plan §1).
 */
export const DEDUPE_WHEN_REGISTRY_SIZE_GTE = GAUNTLET.rounds;

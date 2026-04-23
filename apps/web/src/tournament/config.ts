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

/** How long the animated game-selector runs before landing on the pre-picked game. */
export const SELECTOR_SEC = 2.6;

/**
 * Briefing-card idle timeout — if the player doesn't tap "Let's go!" within this window,
 * we auto-advance to the countdown. Long enough to read the how-to, short enough that an
 * afk player can't freeze the tournament.
 */
export const BRIEFING_MIN_MS = 45_000;

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

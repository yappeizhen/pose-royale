/**
 * Clock-offset measurement. The RTDB publishes `serverTimeOffset` as a live value under
 * `/.info/serverTimeOffset`. Subtracting it from `Date.now()` gives the server's "now",
 * which we use to drive synchronized countdowns and round deadlines (plan §9 edge case #8).
 */

import { onValue, ref, type Database } from "firebase/database";

export interface ClockHandle {
  /** Estimated server epoch-ms at the moment you call. */
  now(): number;
  /** Last measured offset (ms) — positive means the server is ahead of the client. */
  offset(): number;
  /** Stop listening. */
  dispose(): void;
}

export function attachClock(db: Database): ClockHandle {
  let offset = 0;
  const unsub = onValue(ref(db, ".info/serverTimeOffset"), (snap) => {
    const v = snap.val();
    if (typeof v === "number") offset = v;
  });
  return {
    now: () => Date.now() + offset,
    offset: () => offset,
    dispose: () => unsub(),
  };
}

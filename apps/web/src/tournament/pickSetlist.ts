/**
 * Seeded setlist picker. Both peers get the same sequence for the same seed, so we don't need
 * to serialize the setlist over the wire (plan §4).
 *
 * Rules (plan §1):
 *  - Length = `rounds` (default 3).
 *  - Never back-to-back repeats — even during the 2-game era, the picker rejects a candidate
 *    equal to the previous slot.
 *  - If the registry has `dedupe: true` (≥ `rounds` games available), every slot is distinct.
 *  - If only one game is registered, the picker throws (you can't run a Gauntlet with one game
 *    because the no-back-to-back rule is unsatisfiable).
 */

import { randInt } from "@pose-royale/sdk";

export interface PickSetlistOptions {
  /** Registered game ids, in any stable order. */
  available: readonly string[];
  /** How many rounds to pick. */
  rounds: number;
  /** Deterministic RNG (created from the shared seed). */
  rng: () => number;
  /**
   * When true, every slot is distinct (requires `available.length >= rounds`).
   * Defaults to `false` (v1 behavior with 2 games). Flip on in the registry layer once
   * we have enough games.
   */
  dedupe?: boolean;
}

export function pickSetlist({
  available,
  rounds,
  rng,
  dedupe = false,
}: PickSetlistOptions): string[] {
  if (rounds <= 0) return [];
  if (available.length === 0) {
    throw new Error("pickSetlist(): registry is empty");
  }
  if (available.length === 1 && rounds > 1) {
    throw new Error(
      "pickSetlist(): cannot build a multi-round setlist from only one game — " +
        "the no-back-to-back rule would be unsatisfiable.",
    );
  }
  if (dedupe && available.length < rounds) {
    throw new Error(
      `pickSetlist(): dedupe=true requires available.length (${available.length}) >= rounds (${rounds}).`,
    );
  }

  const setlist: string[] = [];
  const used = new Set<string>();

  for (let i = 0; i < rounds; i++) {
    // Build the candidate pool: everything except the previous slot, and (if dedupe) the set
    // of already-used ids.
    const previous = setlist[i - 1];
    const pool = available.filter((id) => {
      if (id === previous) return false;
      if (dedupe && used.has(id)) return false;
      return true;
    });
    if (pool.length === 0) {
      // Shouldn't happen given the length guards above, but defend explicitly.
      throw new Error(
        `pickSetlist(): ran out of candidates at slot ${i}; available=${available.join(",")} dedupe=${dedupe}`,
      );
    }
    const pick = pool[randInt(rng, 0, pool.length)];
    if (pick === undefined) throw new Error("pickSetlist(): unexpected undefined");
    setlist.push(pick);
    if (dedupe) used.add(pick);
  }

  return setlist;
}

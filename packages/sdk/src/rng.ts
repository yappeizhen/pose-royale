/**
 * Seeded random number generator. Both peers in a match construct one from the same seed
 * (delivered through Firebase) so the randomized setlist, spawn sequences, and any
 * in-game randomness stay in lockstep without extra sync traffic (plan §4).
 *
 * Uses mulberry32 — tiny, fast, good distribution, no dependencies.
 */

/** Mix a string (e.g. a room code) into a 32-bit integer seed. */
export function seedFromString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Force unsigned 32-bit
  return h >>> 0;
}

/** Create a deterministic `() => number` returning values in [0, 1). */
export function createRng(seed: number): () => number {
  // mulberry32 state must be a 32-bit unsigned int.
  let state = seed >>> 0;
  return function rng() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [min, max). */
export function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min)) + min;
}

/** Pick one element uniformly. Throws on empty arrays — caller checks length. */
export function pick<T>(rng: () => number, items: readonly T[]): T {
  if (items.length === 0) throw new Error("pick(): empty array");
  const v = items[randInt(rng, 0, items.length)];
  // noUncheckedIndexedAccess: we just bounded the index; a runtime check keeps TS happy.
  if (v === undefined) throw new Error("pick(): unexpected undefined");
  return v;
}

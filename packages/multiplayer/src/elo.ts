/**
 * Tournament ELO math (plan §5, §10). Classic ELO with a k-factor of 24 — modest volatility
 * so a single bad game doesn't crater a rank, but wins still feel earned. Draws share points.
 */

export const K_FACTOR = 24;

export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

export interface EloUpdate {
  newRatingA: number;
  newRatingB: number;
  deltaA: number;
  deltaB: number;
}

/**
 * Compute the ELO delta for a finished match.
 *   outcomeA = 1  → A won
 *   outcomeA = 0.5 → draw
 *   outcomeA = 0  → A lost
 */
export function updateElo(ratingA: number, ratingB: number, outcomeA: 0 | 0.5 | 1): EloUpdate {
  const expA = expectedScore(ratingA, ratingB);
  const deltaA = Math.round(K_FACTOR * (outcomeA - expA));
  // Normalize signed-zero so consumers comparing with `Object.is(n, 0)` behave sensibly.
  const deltaB = deltaA === 0 ? 0 : -deltaA;
  return {
    newRatingA: ratingA + deltaA,
    newRatingB: ratingB + deltaB,
    deltaA,
    deltaB,
  };
}

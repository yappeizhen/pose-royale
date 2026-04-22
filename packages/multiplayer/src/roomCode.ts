/**
 * 4-character room code generator. Avoids visually-confusable characters (0/O, 1/I, etc.)
 * so players can read codes to each other without mistakes.
 */

// 28 unambiguous uppercase letters + digits: 28^4 = 614k — plenty of space; collisions are
// resolved at create-time by retrying.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateRoomCode(rng: () => number = Math.random, length = 4): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    const idx = Math.floor(rng() * ALPHABET.length);
    out += ALPHABET[idx] ?? "A";
  }
  return out;
}

export function normalizeRoomCode(input: string): string {
  return input.replace(/\s+/g, "").toUpperCase();
}

export function isValidRoomCode(input: string): boolean {
  const normalized = normalizeRoomCode(input);
  if (normalized.length < 3 || normalized.length > 8) return false;
  for (const c of normalized) {
    if (!ALPHABET.includes(c)) return false;
  }
  return true;
}

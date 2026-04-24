/**
 * ASL alphabet metadata for LearnSign.
 *
 * Scope: 24 static letters (A–Y excluding J and Z). This matches ngzhili/LearnSign's
 * trained-model coverage — J and Z are intrinsically motion-based signs in ASL
 * (you trace the letter shape in the air) and can't be classified from a static
 * hand snapshot, so they're out of scope for the heuristic detector.
 *
 * Pass 1.5 (this file) uses a richer hand-landmark feature set than Pass 1. The
 * trade-off is honesty: M/N/S/T/X all look like fist variants with subtle thumb
 * differences from 2D landmarks alone, so detection there will be flaky. The
 * in-game Skip button is the user's escape hatch for those; Pass 2 will replace
 * the heuristic with a learned landmark classifier for real accuracy.
 */

/**
 * Which fingers are extended? Used as the primary coarse filter — letters with
 * different extension patterns never collide.
 */
export interface ExtendedSpec {
  thumb: boolean;
  index: boolean;
  middle: boolean;
  ring: boolean;
  pinky: boolean;
}

/**
 * Fine-grained pose features used to discriminate letters that share an extension
 * pattern. All fields are optional — a letter only declares the features it cares
 * about. `undefined` means "don't require anything specific".
 */
export interface PoseSpec {
  /** Thumb tip position relative to the palm center. */
  thumbPosition?: "out" | "across" | "tucked";
  /** Hand orientation — where the fingers point. */
  orientation?: "up" | "down" | "sideways";
  /** Which fingertip the thumb is pinched/near. */
  thumbTouches?: "index" | "middle" | "ring" | "pinky" | "none";
  /** Distance category between the index and middle fingertips. */
  indexMiddle?: "together" | "spread" | "crossed";
  /** Are the non-extended fingers fully curled (as in a tight fist) or loosely curved (as in C/O)? */
  curl?: "tight" | "loose";
  /** Special: index finger is bent into a hook (for X). */
  indexHook?: boolean;
}

/**
 * A letter's full spec: required extension pattern + optional fine features.
 * Scope is static-only — motion letters (J, Z) aren't in `ALPHABET`.
 */
export interface LetterSpec {
  id: string;
  extended: ExtendedSpec;
  pose?: PoseSpec;
  hint: string;
}

const E = Object.freeze({
  all: (): ExtendedSpec => ({ thumb: false, index: false, middle: false, ring: false, pinky: false }),
  only: (parts: Partial<ExtendedSpec>): ExtendedSpec => ({
    thumb: false,
    index: false,
    middle: false,
    ring: false,
    pinky: false,
    ...parts,
  }),
});

export const ALPHABET: readonly LetterSpec[] = [
  // Hints are written to stand alone — no "like other-letter" references, since
  // players see one card at a time and can't cross-reference. Kept to ~40 chars
  // each so two comfortable lines fit in the prompt card at any viewport.

  // Fist-shaped letters — all start from E.all() and differ in thumb position.
  {
    id: "A",
    extended: E.all(),
    pose: { thumbPosition: "out", curl: "tight" },
    hint: "Make a fist with thumb straight down the side",
  },
  {
    id: "E",
    extended: E.all(),
    pose: { thumbPosition: "across", curl: "tight" },
    hint: "Curl fingers down to touch the thumb",
  },
  {
    id: "S",
    extended: E.all(),
    pose: { thumbPosition: "across", curl: "tight" },
    hint: "Tight fist, thumb wrapped over the front",
  },
  {
    id: "M",
    extended: E.all(),
    pose: { thumbPosition: "tucked", curl: "tight" },
    hint: "Three fingers draped over a tucked thumb",
  },
  {
    id: "N",
    extended: E.all(),
    pose: { thumbPosition: "tucked", curl: "tight" },
    hint: "Two fingers draped over a tucked thumb",
  },
  {
    id: "T",
    extended: E.all(),
    pose: { thumbPosition: "tucked", curl: "tight" },
    hint: "Fist with thumb poking up between index and middle",
  },

  // Single-finger extensions.
  {
    id: "D",
    extended: E.only({ index: true }),
    pose: { orientation: "up", thumbTouches: "middle" },
    hint: "Index up, thumb meets the middle fingertip",
  },
  {
    id: "X",
    extended: E.only({ index: true }),
    pose: { orientation: "up", indexHook: true },
    hint: "Bend the index finger into a little hook",
  },
  {
    id: "I",
    extended: E.only({ pinky: true }),
    pose: { orientation: "up" },
    hint: "Pinky straight up, everything else curled",
  },
  {
    id: "G",
    extended: E.only({ index: true, thumb: true }),
    pose: { orientation: "sideways" },
    hint: "Index points sideways, thumb rests on top",
  },

  // Thumb-out pairs.
  {
    id: "L",
    extended: E.only({ thumb: true, index: true }),
    pose: { orientation: "up" },
    hint: "Thumb out, index up — forms an L shape",
  },

  // Index + middle extended.
  {
    id: "V",
    extended: E.only({ index: true, middle: true }),
    pose: { indexMiddle: "spread", orientation: "up" },
    hint: "Peace sign — index and middle spread wide",
  },
  {
    id: "U",
    extended: E.only({ index: true, middle: true }),
    pose: { indexMiddle: "together", orientation: "up" },
    hint: "Index and middle straight up, pressed together",
  },
  {
    id: "R",
    extended: E.only({ index: true, middle: true }),
    pose: { indexMiddle: "crossed", orientation: "up" },
    hint: "Cross the middle finger over the index",
  },
  {
    id: "H",
    extended: E.only({ index: true, middle: true }),
    pose: { indexMiddle: "together", orientation: "sideways" },
    hint: "Index and middle sideways, held together",
  },
  {
    id: "K",
    extended: E.only({ thumb: true, index: true, middle: true }),
    pose: { indexMiddle: "spread", orientation: "up" },
    hint: "Index up, middle forward, thumb in the gap",
  },
  {
    id: "P",
    extended: E.only({ thumb: true, index: true, middle: true }),
    pose: { indexMiddle: "spread", orientation: "down" },
    hint: "Middle finger down, index forward, thumb between",
  },
  {
    id: "Q",
    extended: E.only({ thumb: true, index: true }),
    pose: { orientation: "down" },
    hint: "Thumb and index pointing straight down",
  },

  // Three fingers up.
  {
    id: "W",
    extended: E.only({ index: true, middle: true, ring: true }),
    pose: { orientation: "up" },
    hint: "Three fingers up — index, middle, and ring",
  },
  {
    id: "F",
    extended: E.only({ middle: true, ring: true, pinky: true }),
    pose: { thumbTouches: "index", orientation: "up" },
    hint: "Pinch thumb and index, other three up",
  },

  // Four fingers up.
  {
    id: "B",
    extended: E.only({ index: true, middle: true, ring: true, pinky: true }),
    pose: { thumbPosition: "across", orientation: "up" },
    hint: "Flat palm facing out, thumb tucked across",
  },

  // Thumb + pinky out.
  {
    id: "Y",
    extended: E.only({ thumb: true, pinky: true }),
    hint: "Hang loose — thumb and pinky extended",
  },

  // Loose curved letters — all four fingers curved without being tight.
  {
    id: "C",
    extended: E.all(),
    pose: { curl: "loose", thumbPosition: "out" },
    hint: "Curve the whole hand into a C shape",
  },
  {
    id: "O",
    extended: E.all(),
    pose: { curl: "loose", thumbTouches: "index" },
    hint: "Fingertips meet the thumb to form an O",
  },
];

/** Convenience lookup table for rendering hints in-game. */
export const LETTER_BY_ID: Record<string, LetterSpec> = Object.fromEntries(
  ALPHABET.map((l) => [l.id, l]),
);

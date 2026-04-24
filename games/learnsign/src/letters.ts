/**
 * ASL letter metadata for the LearnSign minigame.
 *
 * Pass 1 ships a subset of 6 letters whose handshapes are trivially distinguishable
 * via a simple "which fingers are extended?" heuristic on MediaPipe's 21-landmark
 * output. Adding more letters here without upgrading the detector will produce
 * noise/confusion (e.g. M/N/S all look like fist variants from landmarks alone).
 *
 * Pass 2 will swap the detector for the LearnSign TF.js model; at that point we'll
 * expand this to the full 24-letter set (excl. J/Z which need temporal motion).
 */
export interface LetterSpec {
  /** Uppercase ASCII letter. */
  id: string;
  /**
   * Which fingers should be extended to form this sign. Thumb, Index, Middle, Ring, Pinky.
   * Used by the heuristic detector (SignDetector.ts).
   */
  extended: {
    thumb: boolean;
    index: boolean;
    middle: boolean;
    ring: boolean;
    pinky: boolean;
  };
  /** One-liner hint shown under the target card so players know what to do. */
  hint: string;
}

export const PASS_1_LETTERS: readonly LetterSpec[] = [
  {
    id: "A",
    extended: { thumb: false, index: false, middle: false, ring: false, pinky: false },
    hint: "Closed fist, thumb along the side",
  },
  {
    id: "B",
    extended: { thumb: false, index: true, middle: true, ring: true, pinky: true },
    hint: "Flat palm, fingers up, thumb tucked",
  },
  {
    id: "L",
    extended: { thumb: true, index: true, middle: false, ring: false, pinky: false },
    hint: "L-shape: thumb + index extended",
  },
  {
    id: "V",
    extended: { thumb: false, index: true, middle: true, ring: false, pinky: false },
    hint: "Peace sign: index + middle up",
  },
  {
    id: "W",
    extended: { thumb: false, index: true, middle: true, ring: true, pinky: false },
    hint: "Three fingers up: index + middle + ring",
  },
  {
    id: "Y",
    extended: { thumb: true, index: false, middle: false, ring: false, pinky: true },
    hint: "Hang-loose: thumb + pinky extended",
  },
];

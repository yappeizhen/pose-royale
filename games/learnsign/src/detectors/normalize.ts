/**
 * Landmark normalization shared between inference and the training Colab.
 *
 * The ML classifier is a tiny MLP that takes a fixed-length feature vector of
 * normalized landmark coordinates. Keeping the normalization identical between
 * training and runtime is the #1 source of "it worked in Colab, it's 5% at
 * runtime" bugs — so this function is the single source of truth. The
 * `training/preprocess.py` script in TRAINING.md mirrors it byte-for-byte.
 *
 * Normalization steps (each one fixes a real-world failure mode):
 *
 *   1. Translate so wrist (landmark 0) is the origin. Removes sensitivity to
 *      where in the frame the hand is.
 *
 *   2. Scale by the wrist → middle-MCP distance (0 → 9). Removes sensitivity to
 *      how close the hand is to the camera. We use the middle MCP instead of
 *      the palm span because it's the most stable landmark across hand poses.
 *
 *   3. Mirror left hands onto the right-hand reference frame by flipping x.
 *      MediaPipe's handedness is already corrected upstream in HandTracker —
 *      we trust the `handedness` field here. Without this step a model trained
 *      on right-handed signers refuses to recognize left-handed ones (and vice
 *      versa) because `L` and a mirrored `L` have opposite x gradients.
 *
 *   4. Flatten to a single 63-length Float32Array ([x0,y0,z0, x1,y1,z1, …]).
 *      Matches the input tensor shape the Colab notebook exports with.
 */

import type { Landmark, TrackedHand } from "@pose-royale/sdk";

/** Number of floats the classifier expects as input. 21 landmarks × 3 coords. */
export const LANDMARK_VECTOR_LEN = 21 * 3;

/**
 * Normalize a tracked hand into the 63-length feature vector the classifier
 * consumes. Returns `null` if the hand is degenerate (wrist and middle-MCP
 * collapsed onto each other), which shouldn't happen with real data but keeps
 * us defensive against edge-case hand frames.
 */
export function normalizeHand(hand: TrackedHand): Float32Array | null {
  const lm = hand.landmarks;
  if (lm.length < 21) return null;

  const wrist = lm[0]!;
  const middleMcp = lm[9]!;

  const scale = Math.hypot(
    middleMcp.x - wrist.x,
    middleMcp.y - wrist.y,
  );
  if (scale < 1e-5) return null;

  // Mirror left-handed signs onto the right-handed reference frame. See §3 above.
  const mirror = hand.handedness === "Left" ? -1 : 1;

  const out = new Float32Array(LANDMARK_VECTOR_LEN);
  for (let i = 0; i < 21; i++) {
    const p = lm[i]!;
    const dx = (p.x - wrist.x) / scale;
    const dy = (p.y - wrist.y) / scale;
    const dz = p.z / scale;
    out[i * 3 + 0] = dx * mirror;
    out[i * 3 + 1] = dy;
    out[i * 3 + 2] = dz;
  }
  return out;
}

/** Convenience: normalize directly from a flat landmark array (for tests). */
export function normalizeLandmarks(
  landmarks: Landmark[],
  handedness: "Left" | "Right",
): Float32Array | null {
  return normalizeHand({
    handedness,
    score: 1,
    landmarks,
  });
}

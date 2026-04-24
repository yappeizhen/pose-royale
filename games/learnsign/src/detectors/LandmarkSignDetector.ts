/**
 * LandmarkSignDetector — TF.js classifier that turns normalized MediaPipe
 * landmarks into a 24-way softmax over the static ASL alphabet.
 *
 * Input:  Float32Array of length 63 (21 landmarks × 3 coords), produced by
 *         `normalizeHand()` so the classifier is translation-, scale-, and
 *         handedness-invariant. See `normalize.ts` for the exact spec — the
 *         training Colab must apply the same transform.
 *
 * Output: softmax over `LABELS`, which defaults to the 24 static letters in
 *         alphabetical order. Pass a custom `labels` option if your Colab uses
 *         a different class order (the order is baked into the model's final
 *         linear layer, so it must match).
 *
 * Runtime:
 *   - Model loads lazily on first `update()` so a failing fetch doesn't crash
 *     the game before the first frame arrives.
 *   - If the model fails to load (bad URL, CORS, device OOM) the detector
 *     degrades gracefully: every frame returns `{ letter: null }` and the game
 *     module is expected to have swapped in a fallback detector.
 *
 * Why landmarks + MLP instead of images + CNN:
 *   - We already run MediaPipe HandLandmarker once per video frame in the
 *     shared `HandTracker`. Reusing its output is ~zero extra work.
 *   - A 63→64→32→24 MLP weighs ~10–20 KB and runs in <1 ms. An image CNN
 *     trained on raw frames would be 100–1000× bigger and contend with
 *     MediaPipe for the WebGL context.
 *   - Same-frame inference means the bounding-box overlay and the classifier
 *     prediction are never out of sync.
 */

import type { HandFrame, TrackedHand } from "@pose-royale/sdk";
import { loadTfjsClassifier, type TfjsClassifier } from "@pose-royale/cv";
import { HoldTracker } from "./HoldTracker.js";
import { LANDMARK_VECTOR_LEN, normalizeHand } from "./normalize.js";
import type { ISignDetector, LockedLetter, Prediction } from "./types.js";

/** Default class-index → letter id mapping. Must match the training Colab. */
export const DEFAULT_LABELS: readonly string[] = [
  "A", "B", "C", "D", "E", "F", "G", "H", "I",
  "K", "L", "M", "N", "O", "P", "Q", "R", "S",
  "T", "U", "V", "W", "X", "Y",
];

export interface LandmarkSignDetectorOptions {
  /** URL to the `model.json` produced by `tensorflowjs_converter`. Required. */
  modelUrl: string;
  /** Override the label order if your model was trained with a different one. */
  labels?: readonly string[];
  /**
   * Minimum softmax probability before a prediction is accepted. Predictions
   * below this threshold are treated as "no candidate" and won't accumulate
   * hold time. 0.6 is a reasonable starting point; tune against your training
   * Colab's validation set.
   */
  minConfidence?: number;
  /** Minimum MediaPipe hand score before we bother running the classifier. */
  minHandScore?: number;
}

export class LandmarkSignDetector implements ISignDetector {
  private readonly hold = new HoldTracker();
  private readonly labels: readonly string[];
  private readonly minConfidence: number;
  private readonly minHandScore: number;
  private readonly modelUrl: string;

  private classifier: TfjsClassifier<Float32Array, Float32Array> | null = null;
  private loadPromise: Promise<void> | null = null;
  private loadFailed = false;

  /** Latest prediction kept around so `update()` is sync even though inference isn't. */
  private lastPrediction: { letter: string | null; confidence: number } = {
    letter: null,
    confidence: 0,
  };
  /** Flip-flop so we don't queue multiple inferences while one is in flight. */
  private inflight = false;

  constructor(opts: LandmarkSignDetectorOptions) {
    this.modelUrl = opts.modelUrl;
    this.labels = opts.labels ?? DEFAULT_LABELS;
    this.minConfidence = opts.minConfidence ?? 0.6;
    this.minHandScore = opts.minHandScore ?? 0.55;
  }

  update(frame: HandFrame, now = performance.now()): Prediction {
    if (this.loadFailed) return this.hold.submit(null, 0, now);

    // Kick off model load on first frame.
    if (this.classifier === null && this.loadPromise === null) {
      this.loadPromise = this.loadClassifier();
    }

    const hand = primaryHand(frame, this.minHandScore);

    // While the model is still downloading/compiling we report "no candidate".
    // That keeps the hold bar empty; once the model lands, real predictions
    // start flowing in.
    if (!this.classifier || !hand) {
      return this.hold.submit(null, 0, now);
    }

    const input = normalizeHand(hand);
    if (!input) return this.hold.submit(null, 0, now);

    // Inference is async (TF.js awaits tensor→host download under the hood).
    // We fire-and-forget: the classifier writes back into `lastPrediction`
    // which feeds the synchronous `hold.submit()` call below. This creates a
    // one-frame lag between camera → classification, which is imperceptible
    // (~16-33 ms) and avoids starving the hand-tracker loop.
    if (!this.inflight) {
      this.inflight = true;
      this.classifier
        .predict(input)
        .then((probs) => {
          this.lastPrediction = this.argmaxWithConfidence(probs);
        })
        .catch((err) => {
          // Inference failure is almost certainly fatal (shader compile issue,
          // lost WebGL context). Fall through to "no candidate" forever — the
          // game module will continue on the heuristic if it was chained.
          console.error("[learnsign] landmark inference failed", err);
          this.loadFailed = true;
        })
        .finally(() => {
          this.inflight = false;
        });
    }

    const { letter, confidence } = this.lastPrediction;
    const accepted = letter !== null && confidence >= this.minConfidence ? letter : null;
    return this.hold.submit(accepted, confidence, now);
  }

  consumeLock(target: string, now = performance.now()): LockedLetter | null {
    return this.hold.consumeLock(target, now);
  }

  reset(): void {
    this.hold.reset();
    this.lastPrediction = { letter: null, confidence: 0 };
  }

  dispose(): void {
    this.classifier?.dispose();
    this.classifier = null;
  }

  // ────── private ──────

  private async loadClassifier(): Promise<void> {
    try {
      this.classifier = await loadTfjsClassifier<Float32Array, Float32Array>({
        modelUrl: this.modelUrl,
        backend: "webgl",
      });
      // Warm-up inference on zeros so the first real frame doesn't pay the
      // WebGL shader-compile tax mid-game.
      await this.classifier.predict(new Float32Array(LANDMARK_VECTOR_LEN));
    } catch (err) {
      console.error("[learnsign] landmark classifier failed to load", err);
      this.loadFailed = true;
      this.classifier = null;
    }
  }

  private argmaxWithConfidence(probs: Float32Array): {
    letter: string | null;
    confidence: number;
  } {
    if (probs.length !== this.labels.length) {
      console.warn(
        "[learnsign] model output length %d does not match labels length %d",
        probs.length,
        this.labels.length,
      );
      return { letter: null, confidence: 0 };
    }
    let best = 0;
    let bestVal = probs[0] ?? 0;
    for (let i = 1; i < probs.length; i++) {
      const v = probs[i] ?? 0;
      if (v > bestVal) {
        bestVal = v;
        best = i;
      }
    }
    return { letter: this.labels[best] ?? null, confidence: bestVal };
  }
}

function primaryHand(frame: HandFrame, minScore: number): TrackedHand | null {
  if (frame.hands.length === 0) return null;
  const hand = frame.hands[0]!;
  if (hand.score < minScore) return null;
  if (hand.landmarks.length < 21) return null;
  return hand;
}

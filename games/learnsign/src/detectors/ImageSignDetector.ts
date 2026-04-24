/**
 * ImageSignDetector — uses the LearnSign SSD MobileNet v2 model directly.
 *
 * This is the "zero-training" path: the model lives in
 * `apps/web/public/models/learnsign/model.json` already (downloaded from the
 * ngzhili/LearnSign repo, ~12 MB across three weight shards). We feed it the
 * live webcam `<video>` element, it returns SSD detections with per-class
 * scores, and we pick the top detection's class as the current letter.
 *
 * Why this is a different detector from the landmark one:
 *   - Input is a raw RGB image tensor `[1, H, W, 3]`, not the 63-float landmark
 *     vector — so we can't share `normalize.ts` with the landmark path.
 *   - The model does its own hand detection internally (that's the "D" in SSD),
 *     so it runs heavier per-frame work than the landmark MLP and duplicates
 *     some of what `HandTracker` already does. That's the trade-off for not
 *     needing to train anything.
 *   - Outputs are a *set* of detections with NMS applied — so we use
 *     `executeAsync` rather than `predict`, and we take the top-confidence
 *     detection above a score threshold.
 *
 * Runtime posture (keeps the main thread responsive):
 *   - Model loads lazily on first `update()`.
 *   - We run inference at most once every `INFERENCE_EVERY_N_FRAMES` hand
 *     frames (default 3). At ~30 Hz that's ~10 inferences/second, which keeps
 *     GPU headroom for the rest of the game while still feeling responsive
 *     (lock-in is 550 ms, so we have 5+ predictions per hold).
 *   - Inference is async + fire-and-forget; the sync `update()` returns the
 *     latest cached prediction through the shared `HoldTracker`.
 */

import type { HandFrame } from "@pose-royale/sdk";
import { HoldTracker } from "./HoldTracker.js";
import type { ISignDetector, LockedLetter, Prediction } from "./types.js";

/**
 * Default class-id → letter mapping for the LearnSign SSD MobileNet export.
 * Index 0 is the SSD background class. Indices 1–24 are the 24 static
 * letters in alphabetical order, matching the `label_map.pbtxt` the
 * ngzhili/LearnSign repo trains against. If you export a model with a
 * different label order, pass a matching `labels` option.
 */
export const DEFAULT_IMAGE_LABELS: readonly (string | null)[] = [
  null, // 0 = background
  "A", "B", "C", "D", "E", "F", "G", "H", "I",
  "K", "L", "M", "N", "O", "P", "Q", "R", "S",
  "T", "U", "V", "W", "X", "Y",
];

export interface ImageSignDetectorOptions {
  /** URL to the `model.json`. Defaults to the committed LearnSign path. */
  modelUrl?: string;
  /** Read-only video source, typically `ctx.hands.videoSource`. */
  video: HTMLVideoElement;
  /** Class-id → letter (or null for background). Must be length 25 for the stock model. */
  labels?: readonly (string | null)[];
  /** Minimum SSD detection score before we accept a prediction. Default 0.5. */
  minDetectionScore?: number;
  /** Run inference every Nth `update()` call. Default 3 (≈10 Hz at 30 Hz camera). */
  inferenceEveryNFrames?: number;
  /**
   * Resize the video frame to this width before inference (height scales to
   * match aspect ratio). Smaller = faster, less accurate. 320 matches the
   * model's training resolution and is a good default.
   */
  inputWidth?: number;
}

interface GraphModel {
  executeAsync(input: TfTensor): Promise<TfTensor | TfTensor[]>;
  dispose(): void;
}
interface TfTensor {
  data(): Promise<Float32Array>;
  dispose(): void;
}
interface TfBrowser {
  fromPixels(
    pixels: HTMLCanvasElement | HTMLVideoElement | ImageData,
    numChannels?: number,
  ): TfTensor;
}
interface TfModule {
  loadGraphModel(url: string): Promise<GraphModel>;
  browser: TfBrowser;
  ready(): Promise<void>;
  setBackend(name: string): Promise<boolean>;
  tidy<T>(fn: () => T): T;
  cast(t: TfTensor, dtype: string): TfTensor;
  expandDims(t: TfTensor, axis?: number): TfTensor;
}

/**
 * Preferred CDN for the "TF.js isn't installed locally" fallback. esm.sh
 * publishes a real ES module with CORS headers so `import()` works directly;
 * jsdelivr/unpkg ship UMD bundles that need a script tag.
 */
const DEFAULT_TFJS_CDN = "https://esm.sh/@tensorflow/tfjs@4.22.0";

let tfModulePromise: Promise<TfModule> | null = null;

/**
 * Resolve `@tensorflow/tfjs`:
 *   1. Try the bundler-resolved local package (installed via `pnpm add`).
 *   2. If that fails (common in offline / registry-503 scenarios), fall back
 *      to an ESM CDN so the image backend still works end-to-end without
 *      forcing a hard dependency.
 *
 * The CDN fallback adds a one-time ~1 MB cold-fetch; subsequent loads are
 * service-worker cached by the CDN. You should still install locally for
 * production — the CDN is explicitly a dev-unblock path.
 */
async function loadTf(cdnUrl = DEFAULT_TFJS_CDN): Promise<TfModule> {
  if (!tfModulePromise) {
    const localSpecifier = "@tensorflow/tfjs";
    tfModulePromise = (
      import(/* @vite-ignore */ localSpecifier) as Promise<TfModule>
    )
      .catch(async (localErr: unknown) => {
        console.warn(
          "[learnsign] @tensorflow/tfjs not installed locally; fetching from CDN (%s). " +
            "Install locally for prod: `pnpm -w add @tensorflow/tfjs`.",
          cdnUrl,
          localErr,
        );
        return (await import(/* @vite-ignore */ cdnUrl)) as TfModule;
      })
      .catch((err: unknown) => {
        throw new Error(
          "[learnsign] Could not load @tensorflow/tfjs from local install OR from CDN. " +
            "Either install it (`pnpm -w add @tensorflow/tfjs`) or set " +
            "VITE_LEARNSIGN_BACKEND=heuristic.\n" +
            String(err),
        );
      });
  }
  return tfModulePromise;
}

export class ImageSignDetector implements ISignDetector {
  private readonly hold = new HoldTracker();
  private readonly labels: readonly (string | null)[];
  private readonly minDetectionScore: number;
  private readonly inferenceEveryNFrames: number;
  private readonly inputWidth: number;
  private readonly modelUrl: string;
  private readonly video: HTMLVideoElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly canvasCtx: CanvasRenderingContext2D;

  private tf: TfModule | null = null;
  private model: GraphModel | null = null;
  private loadPromise: Promise<void> | null = null;
  private loadFailed = false;
  private loadError: Error | null = null;

  private frameCounter = 0;
  private inflight = false;
  private lastPrediction: { letter: string | null; confidence: number } = {
    letter: null,
    confidence: 0,
  };

  constructor(opts: ImageSignDetectorOptions) {
    this.video = opts.video;
    this.modelUrl = opts.modelUrl ?? "/models/learnsign/model.json";
    this.labels = opts.labels ?? DEFAULT_IMAGE_LABELS;
    this.minDetectionScore = opts.minDetectionScore ?? 0.5;
    this.inferenceEveryNFrames = Math.max(1, opts.inferenceEveryNFrames ?? 3);
    this.inputWidth = Math.max(64, opts.inputWidth ?? 320);

    // Offscreen canvas sized on first inference. Re-using one canvas keeps us
    // off the GC treadmill — the GPU pipeline can stall hard under churn.
    this.canvas = document.createElement("canvas");
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("[learnsign] 2D canvas context unavailable");
    this.canvasCtx = ctx;
  }

  update(frame: HandFrame, now = performance.now()): Prediction {
    if (this.loadFailed) return this.hold.submit(null, 0, now);

    if (this.model === null && this.loadPromise === null) {
      this.loadPromise = this.loadModel();
    }

    // No hand in the frame → don't bother running the heavy SSD pipeline.
    // The SSD can detect hands without our help, but running it on empty
    // frames just wastes GPU cycles and produces garbage detections that
    // flicker the UI. We defer to MediaPipe's cheap hand tracker as a gate.
    if (frame.hands.length === 0) {
      this.lastPrediction = { letter: null, confidence: 0 };
      return this.hold.submit(null, 0, now);
    }

    this.frameCounter += 1;
    const shouldInfer =
      this.model !== null &&
      !this.inflight &&
      this.frameCounter % this.inferenceEveryNFrames === 0 &&
      this.video.readyState >= 2; // HAVE_CURRENT_DATA

    if (shouldInfer) {
      this.inflight = true;
      this.runInference()
        .then((result) => {
          this.lastPrediction = result;
        })
        .catch((err) => {
          console.error("[learnsign] image inference failed", err);
          this.loadFailed = true;
        })
        .finally(() => {
          this.inflight = false;
        });
    }

    const { letter, confidence } = this.lastPrediction;
    return this.hold.submit(letter, confidence, now);
  }

  consumeLock(target: string, now = performance.now()): LockedLetter | null {
    return this.hold.consumeLock(target, now);
  }

  reset(): void {
    this.hold.reset();
    this.lastPrediction = { letter: null, confidence: 0 };
  }

  dispose(): void {
    this.model?.dispose();
    this.model = null;
  }

  /**
   * Kick off the model load (and warm up TF.js) explicitly — should be called
   * at game mount time so the round timer never ticks on a cold detector. Idempotent: subsequent calls return the same in-flight promise. Rejects if
   * the load fails so the game UI can surface a clear error instead of
   * silently stalling.
   */
  preload(): Promise<void> {
    if (this.loadPromise === null) {
      this.loadPromise = this.loadModel();
    }
    return this.loadPromise.then(() => {
      if (this.loadFailed) {
        throw this.loadError ?? new Error("[learnsign] image backend load failed");
      }
    });
  }

  // ────── private ──────

  private async loadModel(): Promise<void> {
    try {
      this.tf = await loadTf();
      // WebGL is ~10× faster than WASM for SSD — but some Linux/VM setups
      // have flaky WebGL, so we fall back gracefully. CPU is last-resort.
      try {
        await this.tf.setBackend("webgl");
      } catch {
        try {
          await this.tf.setBackend("wasm");
        } catch {
          await this.tf.setBackend("cpu");
        }
      }
      await this.tf.ready();
      this.model = await this.tf.loadGraphModel(this.modelUrl);

      // Warm up with a single dummy inference. TF.js graph models compile
      // shader programs lazily on first execution; that first call can add
      // 200–800ms of latency which we don't want hitting the player mid-round.
      // We render a blank canvas at a modest size, run once, throw the result
      // away. Costs ~1 inference worth of time, amortized over the match.
      await this.warmup();

      console.info("[learnsign] loaded SSD image model from %s", this.modelUrl);
    } catch (err) {
      console.error("[learnsign] image model failed to load", err);
      this.loadFailed = true;
      this.loadError = err instanceof Error ? err : new Error(String(err));
      this.model = null;
    }
  }

  private async warmup(): Promise<void> {
    const model = this.model;
    const tf = this.tf;
    if (!model || !tf) return;
    const w = this.inputWidth;
    const h = Math.round(w * 0.75);
    const warmupCanvas = document.createElement("canvas");
    warmupCanvas.width = w;
    warmupCanvas.height = h;
    const wctx = warmupCanvas.getContext("2d");
    if (!wctx) return;
    wctx.fillStyle = "#808080";
    wctx.fillRect(0, 0, w, h);
    const input = tf.tidy((): TfTensor => {
      const pixels = tf.browser.fromPixels(warmupCanvas, 3);
      const batched = tf.expandDims(pixels, 0);
      return tf.cast(batched, "int32");
    });
    let outputs: TfTensor | TfTensor[];
    try {
      outputs = await model.executeAsync(input);
    } finally {
      input.dispose();
    }
    for (const t of Array.isArray(outputs) ? outputs : [outputs]) t.dispose();
  }

  /**
   * Observable load state, used by the game UI to render a banner when the
   * image backend can't start (so "didn't work" becomes a diagnosable error
   * rather than a silent no-detection).
   */
  getStatus(): {
    state: "loading" | "ready" | "failed";
    error?: Error;
  } {
    if (this.loadFailed) return { state: "failed", error: this.loadError ?? new Error("unknown") };
    if (this.model !== null) return { state: "ready" };
    return { state: "loading" };
  }

  private async runInference(): Promise<{
    letter: string | null;
    confidence: number;
  }> {
    const model = this.model;
    const tf = this.tf;
    if (!model || !tf) return { letter: null, confidence: 0 };

    // Draw the current video frame into our offscreen canvas at a reduced
    // width. Keeping height proportional preserves aspect ratio — the SSD
    // tolerates variable sizes (the model signature is [1, -1, -1, 3]).
    const videoW = this.video.videoWidth;
    const videoH = this.video.videoHeight;
    if (videoW === 0 || videoH === 0) return { letter: null, confidence: 0 };

    const outW = this.inputWidth;
    const outH = Math.round((videoH / videoW) * outW);
    if (this.canvas.width !== outW || this.canvas.height !== outH) {
      this.canvas.width = outW;
      this.canvas.height = outH;
    }
    this.canvasCtx.drawImage(this.video, 0, 0, outW, outH);

    // Build the uint8 image tensor and run SSD. `executeAsync` is required
    // because SSD graphs contain NonMaxSuppression ops that don't lower into
    // a synchronous TF.js graph.
    const inputTensor = tf.tidy((): TfTensor => {
      const pixels = tf.browser.fromPixels(this.canvas, 3);
      const batched = tf.expandDims(pixels, 0);
      const uint8 = tf.cast(batched, "int32");
      return uint8;
    });

    let outputs: TfTensor | TfTensor[];
    try {
      outputs = await model.executeAsync(inputTensor);
    } finally {
      inputTensor.dispose();
    }

    try {
      const arr = Array.isArray(outputs) ? outputs : [outputs];
      // The SSD head returns multiple tensors in no guaranteed order. We need:
      //   - detection_multiclass_scores: shape [1, 100, 25]  (per-class probs)
      //   - detection_scores            : shape [1, 100]     (top-class score)
      // We identify them by their last-dim size since label order is stable
      // for a given export.
      const scoresTensor = arr.find(
        (t) => guessLastDim(t) === this.labels.length,
      );
      const topScoreTensor = arr.find((t) => guessLastDim(t) === 1);

      if (!scoresTensor) {
        console.warn(
          "[learnsign] no detection_multiclass_scores tensor found in model output",
        );
        return { letter: null, confidence: 0 };
      }

      const scores = await scoresTensor.data();
      const topScores = topScoreTensor ? await topScoreTensor.data() : null;

      // Walk detections in order — SSD returns them sorted by confidence
      // after NMS. First detection above the threshold wins.
      const numDetections = 100;
      const classCount = this.labels.length;
      for (let i = 0; i < numDetections; i++) {
        const topScore = topScores ? topScores[i] ?? 0 : 1;
        if (topScore < this.minDetectionScore) break;

        // Argmax across classes, skipping background.
        let bestClass = -1;
        let bestClassScore = -Infinity;
        for (let c = 1; c < classCount; c++) {
          const s = scores[i * classCount + c] ?? 0;
          if (s > bestClassScore) {
            bestClassScore = s;
            bestClass = c;
          }
        }
        const letter =
          bestClass >= 0 && bestClass < this.labels.length
            ? this.labels[bestClass] ?? null
            : null;
        if (letter !== null) return { letter, confidence: bestClassScore };
      }
      return { letter: null, confidence: 0 };
    } finally {
      for (const t of Array.isArray(outputs) ? outputs : [outputs]) {
        t.dispose();
      }
    }
  }
}

/**
 * Best-effort last-dim extractor so we can sniff which tensor is which in the
 * SSD output. TF.js `Tensor` objects have a `.shape` field at runtime but our
 * minimal type doesn't declare it — we reach for it via an unknown cast.
 */
function guessLastDim(t: TfTensor): number | null {
  const shape = (t as unknown as { shape?: readonly number[] }).shape;
  if (!shape || shape.length === 0) return null;
  const last = shape[shape.length - 1];
  return typeof last === "number" ? last : null;
}

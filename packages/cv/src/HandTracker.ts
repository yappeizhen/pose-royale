import type { HandFrame, HandTrackerHandle, Landmark, TrackedHand, Unsub } from "@pose-royale/sdk";
import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from "@mediapipe/tasks-vision";

export interface HandTrackerOptions {
  /** The user's webcam stream. Obtained once in the shell's CameraGate and reused everywhere. */
  stream: MediaStream;
  /**
   * Where the MediaPipe WASM runtime lives. Defaults to `/mediapipe/wasm`, which apps/web
   * self-hosts via `scripts/copy-mediapipe-assets.mjs` (plan §5, edge case #3). Override only
   * if you're embedding the package in an app with a different public base path.
   */
  wasmBase?: string;
  /**
   * The hand landmarker model (.task file). Defaults to Google's public GCS URL. Callers that
   * want full offline support can mirror this into their own static assets.
   */
  modelAssetPath?: string;
  /** Detect up to N hands. Default 2 — matches what frootninja + ponghub need. */
  numHands?: number;
  /** Minimum confidence (0..1) to report a detection. Default 0.5. */
  minHandDetectionConfidence?: number;
  /** Minimum confidence (0..1) to continue tracking a detected hand. Default 0.5. */
  minHandPresenceConfidence?: number;
  /** Minimum confidence (0..1) for handedness classification. Default 0.5. */
  minTrackingConfidence?: number;
}

const DEFAULT_MODEL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task";

/**
 * Shared MediaPipe HandLandmarker. Exactly one lives per session — the orchestrator creates
 * it once (after CameraGate unlocks a stream) and passes the handle to every game via
 * `GameContext.hands`. Games never initialize their own camera or tracker.
 *
 * The tracker drives itself on `requestVideoFrameCallback` when available, falling back to
 * `requestAnimationFrame` on browsers that don't have rVFC (older Safari). Detection latency
 * tracks camera framerate rather than animation framerate so the hand data stays fresh.
 */
export class HandTracker implements HandTrackerHandle {
  private _latest: HandFrame | null = null;
  private _confidence = 0;
  private _ready = false;
  private readonly subs = new Set<(frame: HandFrame) => void>();

  private landmarker: HandLandmarker | null = null;
  private readonly video: HTMLVideoElement;
  private readonly ownsVideo: boolean;
  private rafId: number | null = null;
  private vfcId: number | null = null;
  private destroyed = false;
  private paused = false;
  private lastTimestamp = -1;

  private constructor(
    video: HTMLVideoElement,
    ownsVideo: boolean,
  ) {
    this.video = video;
    this.ownsVideo = ownsVideo;
  }

  /**
   * Build and warm up a tracker. Resolves once the model has loaded AND the attached video
   * element has at least one decoded frame — so the first `subscribe()` listener is
   * guaranteed to receive live data.
   */
  static async create(opts: HandTrackerOptions): Promise<HandTracker> {
    const video = document.createElement("video");
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = opts.stream;

    const tracker = new HandTracker(video, true);

    // Kick the video element and wait for its first frame.
    await video.play();
    if (video.readyState < 2) {
      await new Promise<void>((resolve) => {
        const onReady = () => {
          video.removeEventListener("loadeddata", onReady);
          resolve();
        };
        video.addEventListener("loadeddata", onReady, { once: true });
      });
    }

    // Resolve + load the MediaPipe vision tasks WASM.
    const wasmBase = opts.wasmBase ?? "/mediapipe/wasm";
    const fileset = await FilesetResolver.forVisionTasks(wasmBase);
    tracker.landmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: opts.modelAssetPath ?? DEFAULT_MODEL,
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numHands: opts.numHands ?? 2,
      minHandDetectionConfidence: opts.minHandDetectionConfidence ?? 0.5,
      minHandPresenceConfidence: opts.minHandPresenceConfidence ?? 0.5,
      minTrackingConfidence: opts.minTrackingConfidence ?? 0.5,
    });

    tracker.startDetectionLoop();
    return tracker;
  }

  get latest(): HandFrame | null {
    return this._latest;
  }

  get confidence(): number {
    return this._confidence;
  }

  get ready(): boolean {
    return this._ready;
  }

  /**
   * Expose the internal `<video>` element — read-only — so games that need
   * raw frame access (e.g. LearnSign's image classifier) can draw from it.
   * Returns `null` after `destroy()` so stale holders don't keep drawing from
   * a freed element.
   */
  get videoSource(): HTMLVideoElement | null {
    return this.destroyed ? null : this.video;
  }

  subscribe(cb: (frame: HandFrame) => void): Unsub {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.paused = true;

    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.vfcId != null) {
      // cancelVideoFrameCallback exists alongside requestVideoFrameCallback, but lib.dom
      // doesn't type it everywhere yet — cast through unknown to pick it up.
      (
        this.video as HTMLVideoElement & {
          cancelVideoFrameCallback?: (handle: number) => void;
        }
      ).cancelVideoFrameCallback?.(this.vfcId);
      this.vfcId = null;
    }
    this.landmarker?.close();
    this.landmarker = null;

    if (this.ownsVideo) {
      this.video.srcObject = null;
      this.video.pause();
    }
    this.subs.clear();
  }

  // ────── private ──────

  private startDetectionLoop(): void {
    const step = (_now: number, _metadata?: unknown) => {
      if (this.destroyed) return;
      if (!this.paused) this.detectFrame();
      this.scheduleNext();
    };

    // Prefer requestVideoFrameCallback when the browser supports it — it fires once per
    // decoded camera frame instead of once per animation frame, which keeps CPU usage low
    // when the display refresh rate exceeds the webcam's output rate.
    const rvfc = (
      this.video as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: (now: number, metadata: unknown) => void) => number;
      }
    ).requestVideoFrameCallback;

    this.scheduleNext = () => {
      if (this.destroyed) return;
      if (rvfc) {
        this.vfcId = rvfc.call(this.video, step);
      } else {
        this.rafId = requestAnimationFrame((now) => step(now));
      }
    };
    this.scheduleNext();
  }

  private scheduleNext: () => void = () => {};

  private detectFrame(): void {
    const lm = this.landmarker;
    if (!lm) return;
    // MediaPipe requires strictly increasing timestamps in VIDEO mode.
    const ts = performance.now();
    if (ts <= this.lastTimestamp) return;
    this.lastTimestamp = ts;
    let result: HandLandmarkerResult;
    try {
      result = lm.detectForVideo(this.video, ts);
    } catch {
      // Detection can throw if the video tears down mid-call (e.g. user revoked camera perms).
      return;
    }
    const frame = toHandFrame(result, ts);
    this._latest = frame;
    this._confidence = frame.hands[0]?.score ?? 0;
    this._ready = true;
    for (const cb of this.subs) {
      try {
        cb(frame);
      } catch (err) {
        console.error("[cv] hand subscriber threw", err);
      }
    }
  }
}

function toHandFrame(result: HandLandmarkerResult, timestamp: number): HandFrame {
  const handednesses = result.handednesses ?? [];
  const landmarksArr = result.landmarks ?? [];

  const hands: TrackedHand[] = landmarksArr.map((landmarks, idx) => {
    const h = handednesses[idx]?.[0];
    // MediaPipe's handedness classifier assumes a mirrored/selfie input. We feed it the
    // raw webcam stream (the shell mirrors only the *displayed* video), so the labels
    // come back from MediaPipe's reference frame and read as the user's opposite hand.
    // Swap here so downstream games can treat "Right" as the user's actual right hand as
    // they see it on screen.
    const raw = h?.categoryName;
    const handedness: TrackedHand["handedness"] =
      raw === "Left" ? "Right" : raw === "Right" ? "Left" : "Right";
    const score = h?.score ?? 0;
    return {
      handedness,
      score,
      landmarks: landmarks.map(
        (lm): Landmark => ({ x: lm.x, y: lm.y, z: lm.z ?? 0 }),
      ),
    };
  });
  // Sort by confidence so `hands[0]` is always the strongest detection.
  hands.sort((a, b) => b.score - a.score);

  return { timestamp, hands };
}

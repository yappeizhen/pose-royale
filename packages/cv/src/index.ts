// @pose-royale/cv — Shared computer-vision primitives. Single MediaPipe HandLandmarker
// instance, optional TFJS classifier host. Consumed by the orchestrator (warm-up) and
// exposed to games via `GameContext.hands`.

export const CV_VERSION = "0.1.0";

export { HandTracker } from "./HandTracker.js";
export type { HandTrackerOptions } from "./HandTracker.js";

export { loadTfjsClassifier } from "./TfjsModelHost.js";
export type { TfjsClassifier, TfjsModelHostOptions } from "./TfjsModelHost.js";

/**
 * Back-compat re-export shim. The real detector code lives in `./detectors/`;
 * this module exists so older imports keep resolving while we migrate callers.
 *
 * New code should import from `./detectors` directly:
 *
 *   import { createSignDetector, HOLD_DURATION_MS } from "./detectors";
 */

export {
  createSignDetector,
  HeuristicSignDetector,
  LandmarkSignDetector,
  HoldTracker,
  HOLD_DURATION_MS,
  type DetectorBackend,
  type CreateSignDetectorOptions,
  type ISignDetector,
  type LandmarkSignDetectorOptions,
  type LockedLetter,
  type Prediction,
} from "./detectors/index.js";

// Legacy alias: the old name for the heuristic class.
export { HeuristicSignDetector as SignDetector } from "./detectors/HeuristicSignDetector.js";

// @pose-royale/sdk — the Game contract and its runtime helpers.
// See src/types.ts for the interfaces every game implements.

export const SDK_VERSION = "0.1.0";

export type {
  CvCapability,
  DemoCard,
  FinalScore,
  GameContext,
  GameInstance,
  GameManifest,
  GameModule,
  HandFrame,
  HandTrackerHandle,
  Landmark,
  Player,
  RoomChannel,
  ScoreEvent,
  ScoringMode,
  TrackedHand,
  Unsub,
  VideoState,
} from "./types.js";

export { GameRuntime } from "./runtime.js";
export type { GameRuntimeOptions, ViolationKind } from "./runtime.js";

export { createRng, seedFromString, randInt, pick } from "./rng.js";

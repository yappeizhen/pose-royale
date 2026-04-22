// @pose-royale/ui — Design-system components shared across the shell and games.
// Full design system lands across M0–M5. These primitives are locked in from day 1:
//   - CameraGate: blocks entry without a working webcam (plan §9 edge case #2).
//   - BackButton + BackScope: mandatory on every screen (plan §1).
export { CameraGate } from "./CameraGate.js";
export type { CameraGateProps } from "./CameraGate.js";
export { BackButton } from "./BackButton.js";
export type { BackButtonProps } from "./BackButton.js";
export { BackScope, useBackAction } from "./BackScope.js";
export type { BackAction } from "./BackScope.js";
export { OpponentBubble } from "./OpponentBubble.js";
export type { OpponentBubbleProps, VideoState } from "./OpponentBubble.js";

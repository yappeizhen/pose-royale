/**
 * HandController — translates SDK `HandFrame` input into a PongHub `PaddleState`.
 *
 * Ported from the original pingpong `useHandController` hook + `palmDetector` +
 * `swipeDetector`. Keeps the same two-stage "acquire → track" lock, an open-palm gate,
 * and a velocity-smoothed swipe detector — all the bits that make the original paddle
 * feel crisp without jittering when the hand drifts or curls.
 *
 * Coordinate frame: MediaPipe returns raw (un-mirrored) camera landmarks. The webcam
 * is displayed mirrored in the shell, so we flip X once here (`1 - x`) so that moving
 * the right hand right makes the paddle go right.
 */

import type { HandFrame, Landmark, TrackedHand } from "@pose-royale/sdk";
import type { Handedness, PaddleState } from "./types.js";

const DEFAULT_GRACE_PERIOD = 300;
const ACQUIRE_OPEN_FRAMES_REQUIRED = 6;
const TRACKING_LOST_REACQUIRE_MS = 700;
const MIN_TRACKING_CONFIDENCE = 0.35;

const SWIPE_HISTORY_SIZE = 6;
const MIN_SWIPE_SPEED = 0.025;
const SWIPE_SMOOTHING = 0.4;

type TrackingPhase = "acquiring" | "tracking";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface PalmPosition {
  x: number;
  y: number;
  z: number;
  isOpen: boolean;
  confidence: number;
}

interface SwipeState {
  isSwinging: boolean;
  velocity: { x: number; y: number };
  speed: number;
  direction: { x: number; y: number };
}

function detectOpenPalm(landmarks: Landmark[]): boolean {
  const fingerTips = [8, 12, 16, 20];
  const fingerPIPs = [6, 10, 14, 18];
  const fingerMCPs = [5, 9, 13, 17];

  let extendedCount = 0;
  for (let i = 0; i < 4; i++) {
    const tip = landmarks[fingerTips[i]!];
    const pip = landmarks[fingerPIPs[i]!];
    const mcp = landmarks[fingerMCPs[i]!];
    if (!tip || !pip || !mcp) continue;
    const tipToMcp = Math.hypot(tip.x - mcp.x, tip.y - mcp.y);
    const pipToMcp = Math.hypot(pip.x - mcp.x, pip.y - mcp.y);
    if (tipToMcp > pipToMcp * 1.5) extendedCount++;
  }
  return extendedCount >= 3;
}

function extractPalm(hand: TrackedHand): PalmPosition {
  if (hand.landmarks.length < 21) {
    return { x: 0.5, y: 0.5, z: 0.5, isOpen: false, confidence: 0 };
  }
  const [wrist, , , , , indexBase, , , , middleBase, , , , ringBase, , , , pinkyBase] =
    hand.landmarks;
  if (!wrist || !indexBase || !middleBase || !ringBase || !pinkyBase) {
    return { x: 0.5, y: 0.5, z: 0.5, isOpen: false, confidence: 0 };
  }
  const x = (wrist.x + indexBase.x + middleBase.x + ringBase.x + pinkyBase.x) / 5;
  const y = (wrist.y + indexBase.y + middleBase.y + ringBase.y + pinkyBase.y) / 5;
  const z = (wrist.z + indexBase.z + middleBase.z + ringBase.z + pinkyBase.z) / 5;
  return {
    x: clamp(x, 0, 1),
    y: clamp(y, 0, 1),
    z,
    isOpen: detectOpenPalm(hand.landmarks),
    confidence: hand.score,
  };
}

function pickPrimaryHand(
  hands: TrackedHand[],
  preferred: Handedness,
): TrackedHand | null {
  if (hands.length === 0) return null;
  if (hands.length === 1) return hands[0]!;
  const preferredHand = hands.find((h) => h.handedness === preferred);
  if (preferredHand) return preferredHand;
  return hands.reduce((best, cur) => (cur.score > best.score ? cur : best));
}

/** Mirror X to account for the mirrored webcam background. */
function palmToPaddle(palm: PalmPosition): { x: number; y: number } {
  const x = 1 - palm.x;
  const y = 1 - palm.y;
  return { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
}

class SwipeDetector {
  private positionHistory: Array<{ x: number; y: number; time: number }> = [];
  private lastVelocity = { x: 0, y: 0 };

  update(palm: PalmPosition | null, requireOpenPalm = true): SwipeState {
    const now = performance.now();

    if (!palm || (requireOpenPalm && !palm.isOpen)) {
      this.positionHistory = [];
      this.lastVelocity = { x: 0, y: 0 };
      return {
        isSwinging: false,
        velocity: { x: 0, y: 0 },
        speed: 0,
        direction: { x: 0, y: 0 },
      };
    }

    this.positionHistory.push({ x: palm.x, y: palm.y, time: now });
    if (this.positionHistory.length > SWIPE_HISTORY_SIZE) {
      this.positionHistory.shift();
    }
    if (this.positionHistory.length < 2) {
      return {
        isSwinging: false,
        velocity: { x: 0, y: 0 },
        speed: 0,
        direction: { x: 0, y: 0 },
      };
    }

    const oldest = this.positionHistory[0]!;
    const newest = this.positionHistory[this.positionHistory.length - 1]!;
    const timeDelta = (newest.time - oldest.time) / 1000;
    if (timeDelta <= 0) {
      return {
        isSwinging: false,
        velocity: this.lastVelocity,
        speed: 0,
        direction: { x: 0, y: 0 },
      };
    }

    const rawVelX = (newest.x - oldest.x) / timeDelta;
    const rawVelY = (newest.y - oldest.y) / timeDelta;
    const velX =
      this.lastVelocity.x * (1 - SWIPE_SMOOTHING) + rawVelX * SWIPE_SMOOTHING;
    const velY =
      this.lastVelocity.y * (1 - SWIPE_SMOOTHING) + rawVelY * SWIPE_SMOOTHING;
    this.lastVelocity = { x: velX, y: velY };

    const speed = Math.sqrt(velX * velX + velY * velY);
    const isSwinging = speed > MIN_SWIPE_SPEED;
    const direction =
      speed > 0.001 ? { x: velX / speed, y: velY / speed } : { x: 0, y: 0 };

    return {
      isSwinging,
      velocity: { x: velX, y: velY },
      speed,
      direction,
    };
  }

  reset(): void {
    this.positionHistory = [];
    this.lastVelocity = { x: 0, y: 0 };
  }
}

function computeGestureFeatures(
  hand: TrackedHand,
  mirrored: boolean,
): {
  faceTilt: { x: number; y: number };
  brushBias: { x: number; y: number };
} {
  if (hand.landmarks.length < 21) {
    return { faceTilt: { x: 0, y: 0 }, brushBias: { x: 0, y: 0 } };
  }
  const wrist = hand.landmarks[0]!;
  const indexMcp = hand.landmarks[5]!;
  const middleMcp = hand.landmarks[9]!;
  const pinkyMcp = hand.landmarks[17]!;

  const depthTilt = clamp((wrist.z - middleMcp.z) * 8, -1, 1);
  const sideTilt = clamp((indexMcp.y - pinkyMcp.y) * 3, -1, 1);
  const handednessSign = hand.handedness === "Right" ? 1 : -1;
  // `brushBias.x` + `faceTilt.y` drive sideways aim; flipping for mirrored display so
  // "swinging to the right" actually steers the ball to the right on-screen.
  const mirrorSign = mirrored ? -1 : 1;
  return {
    faceTilt: {
      x: depthTilt,
      y: sideTilt * handednessSign * mirrorSign,
    },
    brushBias: {
      x: clamp((indexMcp.x - pinkyMcp.x) * 3, -1, 1) * mirrorSign,
      y: clamp((middleMcp.y - wrist.y) * -4, -1, 1),
    },
  };
}

export interface HandControllerOptions {
  preferredHand?: Handedness;
  gracePeriodMs?: number;
}

export class HandController {
  private preferredHand: Handedness;
  private gracePeriodMs: number;
  private swipeDetector = new SwipeDetector();
  private trackingPhase: TrackingPhase = "acquiring";
  private openPalmStabilityFrames = 0;
  private lockedHand: Handedness | null = null;
  private lastTrackingTime = 0;
  private lastPosition = { x: 0.5, y: 0.5 };
  private lastActiveTime = 0;
  private lastSwipe: SwipeState = {
    velocity: { x: 0, y: 0 },
    isSwinging: false,
    speed: 0,
    direction: { x: 0, y: 0 },
  };
  private currentState: PaddleState = {
    position: { x: 0.5, y: 0.5 },
    velocity: { x: 0, y: 0 },
    isActive: false,
    isSwinging: false,
    swipeSpeed: 0,
    faceTilt: { x: 0, y: 0 },
    brush: { x: 0, y: 0 },
    swingEnergy: 0,
    hand: null,
  };

  constructor(options: HandControllerOptions = {}) {
    this.preferredHand = options.preferredHand ?? "Right";
    this.gracePeriodMs = options.gracePeriodMs ?? DEFAULT_GRACE_PERIOD;
  }

  getState(): PaddleState {
    return this.currentState;
  }

  /** Feed one SDK hand frame. Returns the resulting paddle state (already mirrored). */
  processFrame(handFrame: HandFrame | null): PaddleState {
    const now = performance.now();

    const resetToAcquireMode = (): void => {
      this.trackingPhase = "acquiring";
      this.openPalmStabilityFrames = 0;
      this.lockedHand = null;
    };

    const emitIdle = (): PaddleState => {
      const timeSinceActive = now - this.lastActiveTime;
      const inGrace = timeSinceActive < this.gracePeriodMs;
      const state: PaddleState = {
        position: this.lastPosition,
        velocity: inGrace ? this.lastSwipe.velocity : { x: 0, y: 0 },
        isActive: inGrace,
        isSwinging: inGrace && this.lastSwipe.isSwinging,
        swipeSpeed: inGrace ? this.lastSwipe.speed : 0,
        faceTilt: inGrace
          ? (this.currentState.faceTilt ?? { x: 0, y: 0 })
          : { x: 0, y: 0 },
        brush: inGrace
          ? (this.currentState.brush ?? { x: 0, y: 0 })
          : { x: 0, y: 0 },
        swingEnergy: inGrace ? (this.currentState.swingEnergy ?? 0) : 0,
        hand: null,
      };
      this.currentState = state;
      return state;
    };

    if (!handFrame) {
      this.swipeDetector.update(null);
      if (now - this.lastTrackingTime > TRACKING_LOST_REACQUIRE_MS) {
        resetToAcquireMode();
      }
      return emitIdle();
    }

    const primary = pickPrimaryHand(handFrame.hands, this.preferredHand);
    if (!primary) {
      this.swipeDetector.update(null);
      if (now - this.lastTrackingTime > TRACKING_LOST_REACQUIRE_MS) {
        resetToAcquireMode();
      }
      return emitIdle();
    }

    const palm = extractPalm(primary);
    const position = palmToPaddle(palm);
    const handMatchesLock =
      !this.lockedHand || primary.handedness === this.lockedHand;
    const isTrackable =
      primary.score >= MIN_TRACKING_CONFIDENCE && handMatchesLock;

    if (this.trackingPhase === "acquiring") {
      if (palm.isOpen && isTrackable) {
        this.lockedHand = primary.handedness;
        this.openPalmStabilityFrames += 1;
        if (this.openPalmStabilityFrames >= ACQUIRE_OPEN_FRAMES_REQUIRED) {
          this.trackingPhase = "tracking";
          this.lastTrackingTime = now;
        }
      } else {
        this.openPalmStabilityFrames = 0;
      }
    }

    if (this.trackingPhase === "tracking") {
      if (isTrackable) {
        this.lastTrackingTime = now;
      } else if (now - this.lastTrackingTime > TRACKING_LOST_REACQUIRE_MS) {
        resetToAcquireMode();
        this.swipeDetector.update(null);
      }
    }

    const hasControl = this.trackingPhase === "tracking" && isTrackable;
    const swipe = this.swipeDetector.update(hasControl ? palm : null, !hasControl);
    const gesture = computeGestureFeatures(primary, true);

    const brushX = clamp(
      swipe.velocity.x * 0.95 +
        gesture.brushBias.x * 0.45 +
        gesture.faceTilt.y * 0.35,
      -1,
      1,
    );
    const brushY = clamp(
      -swipe.velocity.y * 0.95 +
        gesture.brushBias.y * 0.45 +
        gesture.faceTilt.x * 0.35,
      -1,
      1,
    );
    const swingEnergy = clamp(
      swipe.speed * 1.45 + (swipe.isSwinging ? 0.16 : 0),
      0,
      1,
    );

    this.lastPosition = position;
    if (hasControl) {
      this.lastActiveTime = now;
      this.lastSwipe = swipe;
    }

    const state: PaddleState = {
      position,
      velocity: swipe.velocity,
      isActive: hasControl,
      isSwinging: swipe.isSwinging,
      swipeSpeed: swipe.speed,
      faceTilt: hasControl ? gesture.faceTilt : { x: 0, y: 0 },
      brush: hasControl ? { x: brushX, y: brushY } : { x: 0, y: 0 },
      swingEnergy: hasControl ? swingEnergy : 0,
      hand: hasControl ? primary.handedness : null,
    };
    this.currentState = state;
    return state;
  }
}

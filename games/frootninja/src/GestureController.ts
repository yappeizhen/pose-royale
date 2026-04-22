import type { HandFrame, Landmark } from "@pose-royale/sdk";
import type { GestureEvent, Handedness } from "./FruitGame.js";

/**
 * Slice gesture detector — vendored from yappeizhen/frootninja. Watches the index-finger
 * tip (MediaPipe landmark 8) and emits a "slice" GestureEvent when motion across a frame
 * clears a speed + distance threshold, with per-hand cooldown so one swipe = one slice.
 */
const INDEX_FINGER_TIP = 8;

export interface GestureControllerConfig {
  sliceSpeedThreshold: number;
  minDistance: number;
  cooldownMs: number;
}

const defaultConfig: GestureControllerConfig = {
  sliceSpeedThreshold: 1.35,
  minDistance: 0.012,
  cooldownMs: 250,
};

interface MotionState {
  lastPoint?: Landmark;
  lastTimestamp?: number;
  lastGestureAt?: number;
}

export class GestureController {
  private config: GestureControllerConfig;
  private handStates = new Map<Handedness, MotionState>();
  private idCounter = 0;

  constructor(config: Partial<GestureControllerConfig> = {}) {
    this.config = { ...defaultConfig, ...config };
  }

  reset() {
    this.handStates.clear();
  }

  processFrame(frame: HandFrame | null): GestureEvent[] {
    if (!frame) {
      this.reset();
      return [];
    }

    const events: GestureEvent[] = [];
    frame.hands.forEach((hand) => {
      const tip = hand.landmarks[INDEX_FINGER_TIP];
      if (!tip) return;

      const state = this.ensureState(hand.handedness);
      const timestamp = frame.timestamp;
      if (state.lastPoint === undefined || state.lastTimestamp === undefined) {
        state.lastPoint = tip;
        state.lastTimestamp = timestamp;
        return;
      }

      const dtMs = timestamp - state.lastTimestamp;
      if (dtMs <= 0) {
        state.lastPoint = tip;
        state.lastTimestamp = timestamp;
        return;
      }

      const dtSeconds = dtMs / 1000;
      const dx = tip.x - state.lastPoint.x;
      const dy = tip.y - state.lastPoint.y;
      const distance = Math.hypot(dx, dy);
      const speed = distance / dtSeconds;

      if (
        distance >= this.config.minDistance &&
        speed >= this.config.sliceSpeedThreshold &&
        this.isOffCooldown(state, timestamp)
      ) {
        const directionMagnitude = Math.max(distance, Number.EPSILON);
        const direction = {
          x: dx / directionMagnitude,
          y: dy / directionMagnitude,
        };
        const strength = Math.min(
          1,
          (speed - this.config.sliceSpeedThreshold) / this.config.sliceSpeedThreshold,
        );
        events.push({
          id: `slice-${hand.handedness}-${this.idCounter++}`,
          type: "slice",
          hand: hand.handedness,
          speed,
          strength,
          direction,
          timestamp,
          origin: { x: tip.x, y: tip.y, z: tip.z },
        });
        state.lastGestureAt = timestamp;
      }

      state.lastPoint = tip;
      state.lastTimestamp = timestamp;
    });

    return events;
  }

  private ensureState(hand: Handedness): MotionState {
    if (!this.handStates.has(hand)) {
      this.handStates.set(hand, {});
    }
    return this.handStates.get(hand)!;
  }

  private isOffCooldown(state: MotionState, timestamp: number) {
    if (state.lastGestureAt === undefined) return true;
    return timestamp - state.lastGestureAt >= this.config.cooldownMs;
  }
}

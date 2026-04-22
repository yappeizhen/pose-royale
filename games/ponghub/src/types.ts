/**
 * Local ping-pong types. We keep these self-contained so the engine is not coupled to
 * the SDK's HandFrame types — the GameModule wrapper translates SDK input into these.
 */

export type Handedness = "Left" | "Right";

export type Player = "player1" | "player2";

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface Vector2 {
  x: number;
  y: number;
}

export interface BallState {
  position: Vector3;
  velocity: Vector3;
  spin: Vector2;
  lastHitBy: Player | null;
  isInPlay: boolean;
}

export interface PaddleState {
  /** Normalized 0..1 on the table's screen-space. */
  position: Vector2;
  velocity: Vector2;
  isActive: boolean;
  isSwinging: boolean;
  swipeSpeed: number;
  hand: Handedness | null;
  /** Forward/back tilt + side tilt derived from palm depth and finger MCPs. */
  faceTilt?: Vector2;
  /** Brush direction encoding the swing's "slicing" feel. */
  brush?: Vector2;
  /** Clamped 0..1 burst of energy from the swing. */
  swingEnergy?: number;
}

export interface PointEvent {
  winner: Player;
  reason: "out-of-bounds" | "net-fault" | "double-bounce" | "miss";
}

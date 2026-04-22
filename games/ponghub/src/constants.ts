/**
 * Physical constants for PongHub. Values are sourced verbatim from the original
 * pingpong game so the table dimensions, ball behaviour, and camera feel identical.
 */

export const TABLE = {
  WIDTH: 1.525,
  LENGTH: 2.74,
  HEIGHT: 0.76,
  NET_HEIGHT: 0.1525,
  LINE_WIDTH: 0.02,
  COLOR: 0x1565c0,
  SURFACE_COLOR: 0x1976d2,
  EDGE_COLOR: 0x0d47a1,
  LINE_COLOR: 0xffffff,
} as const;

export const BALL = {
  RADIUS: 0.02,
  MASS: 0.0027,
  COLOR: 0xfaebd7,
  INITIAL_SPEED: 2.45,
  MAX_SPEED: 6.2,
  BOUNCE_COEFFICIENT: 0.89,
  SPIN_FACTOR: 0.16,
} as const;

export const PADDLE = {
  RADIUS: 0.1,
  THICKNESS: 0.01,
  COLOR: 0xffdd00,
  OPPONENT_COLOR: 0xf44336,
  HIT_ZONE: 0.18,
  ACTIVE_OPACITY: 0.9,
  INACTIVE_OPACITY: 0.4,
} as const;

export const PHYSICS = {
  GRAVITY: -7.2,
  AIR_RESISTANCE: 0.995,
  TIME_STEP: 1 / 120,
  TABLE_FRICTION: 0.86,
} as const;

export const CAMERA = {
  FOV: 50,
  NEAR: 0.1,
  FAR: 100,
  POSITION: { x: 0, y: 2.0, z: 2.8 },
  LOOK_AT: { x: 0, y: TABLE.HEIGHT, z: -0.1 },
} as const;

export const GAME = {
  COUNTDOWN_SECONDS: 3,
  SERVE_DELAY_MS: 900,
  RALLY_TIMEOUT_MS: 10000,
} as const;

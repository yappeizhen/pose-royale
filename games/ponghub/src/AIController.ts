/**
 * AIController — port of the original pingpong AI. Predicts the ball's trajectory a few
 * steps ahead, picks an intercept point, and eases the paddle toward it with some
 * tunable reaction delay / prediction error. Output is a `PaddleState` the physics
 * module can consume like any other paddle.
 */

import { TABLE, PHYSICS, BALL } from "./constants.js";
import type { BallState, PaddleState } from "./types.js";

const AI_CONFIG = {
  reactionDelay: 16,
  speed: 0.21,
  predictionError: 0.01,
  anticipation: 0.9,
  aggression: 0.72,
  trackingAccuracy: 0.92,
  maxReturnAim: 0.12,
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class AIController {
  private targetX = 0.5;
  private targetY = 0.5;
  private targetDepth = 0;
  private lastUpdateTime = 0;
  private currentPaddle: PaddleState & { depth: number } = {
    position: { x: 0.5, y: 0.5 },
    velocity: { x: 0, y: 0 },
    isActive: true,
    isSwinging: true,
    swipeSpeed: 0.5,
    hand: "Right",
    depth: 0,
  };
  private lastBallZ = 0;
  private rallyCount = 0;
  private returnAimX = 0;
  private lastBallState: BallState | null = null;
  private rng: () => number;

  constructor(rng: () => number) {
    this.rng = rng;
  }

  update(ballState: BallState, deltaTime: number): PaddleState & { depth: number } {
    const now = performance.now();

    if (ballState.isInPlay && ballState.velocity.z > 0 && this.lastBallZ <= 0) {
      this.rallyCount++;
      const randomAim = (this.rng() - 0.5) * AI_CONFIG.aggression * 0.95;
      this.returnAimX = clamp(
        randomAim,
        -AI_CONFIG.maxReturnAim,
        AI_CONFIG.maxReturnAim,
      );
    }
    this.lastBallZ = ballState.velocity.z;

    const ballChanged =
      !this.lastBallState ||
      Math.abs(ballState.position.x - this.lastBallState.position.x) > 0.01 ||
      Math.abs(ballState.position.z - this.lastBallState.position.z) > 0.01;
    this.lastBallState = {
      position: { ...ballState.position },
      velocity: { ...ballState.velocity },
      spin: { ...ballState.spin },
      lastHitBy: ballState.lastHitBy,
      isInPlay: ballState.isInPlay,
    };

    if (now - this.lastUpdateTime > AI_CONFIG.reactionDelay || ballChanged) {
      this.lastUpdateTime = now;
      this.calculateTarget(ballState);
    }

    this.moveTowardsTarget(deltaTime, ballState);

    const ballSpeed = Math.sqrt(
      ballState.velocity.x ** 2 +
        ballState.velocity.y ** 2 +
        ballState.velocity.z ** 2,
    );
    this.currentPaddle.swipeSpeed =
      0.58 + AI_CONFIG.aggression * 0.52 + Math.min(ballSpeed * 0.06, 0.45);

    return { ...this.currentPaddle };
  }

  private calculateTarget(ball: BallState): void {
    if (!ball.isInPlay) {
      this.targetX = 0.5;
      this.targetY = 0.5;
      this.targetDepth = 0;
      this.rallyCount = 0;
      return;
    }

    const ballMovingTowardsAI = ball.velocity.z < 0;

    if (ballMovingTowardsAI) {
      const prediction = this.predictBallTrajectory(ball);
      const error = (this.rng() - 0.5) * 2 * AI_CONFIG.predictionError;
      const blendFactor = AI_CONFIG.trackingAccuracy;
      const directX = 0.5 + ball.position.x / TABLE.WIDTH;
      const predictedX = prediction.x;

      this.targetX = Math.max(
        0.05,
        Math.min(0.95, predictedX * blendFactor + directX * (1 - blendFactor) + error),
      );
      this.targetY = Math.max(
        0.15,
        Math.min(0.85, prediction.y + error * 0.2),
      );

      const distanceToIntercept = Math.abs(ball.position.z - prediction.z);
      const timeToIntercept =
        distanceToIntercept / Math.max(Math.abs(ball.velocity.z), 0.5);

      if (timeToIntercept < 0.3) {
        this.targetDepth = Math.max(
          -0.2,
          Math.min(0.35, prediction.depth + 0.02),
        );
      } else {
        this.targetDepth = 0;
      }
    } else {
      const anticipatedX = this.anticipateReturnPosition(ball);
      this.targetX = 0.5 + (anticipatedX - 0.5) * AI_CONFIG.anticipation;
      this.targetY = 0.4;
      this.targetDepth = 0.03;
    }
  }

  private predictBallTrajectory(
    ball: BallState,
  ): { x: number; y: number; z: number; depth: number } {
    const tableHalfLength = TABLE.LENGTH / 2;
    const baselineZ = -tableHalfLength - 0.15;

    if (ball.velocity.z >= 0) {
      return { x: 0.5, y: 0.5, z: baselineZ, depth: 0 };
    }

    let simX = ball.position.x;
    let simY = ball.position.y;
    let simZ = ball.position.z;
    let velX = ball.velocity.x;
    let velY = ball.velocity.y;
    let velZ = ball.velocity.z;

    const dt = 0.008;
    const tableHalfWidth = TABLE.WIDTH / 2;
    let steps = 0;
    const maxSteps = 600;
    let bestIntercept = { x: simX, y: simY, z: baselineZ, depth: 0 };
    let foundIntercept = false;

    while (steps < maxSteps && simZ > baselineZ - 0.5) {
      velY += PHYSICS.GRAVITY * dt;
      velX *= Math.pow(PHYSICS.AIR_RESISTANCE, dt * 60);
      velY *= Math.pow(PHYSICS.AIR_RESISTANCE, dt * 60);
      velZ *= Math.pow(PHYSICS.AIR_RESISTANCE, dt * 60);

      simX += velX * dt;
      simY += velY * dt;
      simZ += velZ * dt;

      if (
        simY <= TABLE.HEIGHT + BALL.RADIUS &&
        velY < 0 &&
        simZ > -tableHalfLength &&
        simZ < tableHalfLength &&
        Math.abs(simX) < tableHalfWidth
      ) {
        simY = TABLE.HEIGHT + BALL.RADIUS;
        velY = -velY * BALL.BOUNCE_COEFFICIENT;
        velX *= PHYSICS.TABLE_FRICTION;
        velZ *= PHYSICS.TABLE_FRICTION;
      }

      const inAIZone = simZ < -0.05 && simZ > baselineZ - 0.4;
      const atHittableHeight =
        simY > TABLE.HEIGHT - 0.05 && simY < TABLE.HEIGHT + 0.6;

      if (inAIZone && atHittableHeight && velZ < 0 && !foundIntercept) {
        bestIntercept = {
          x: simX,
          y: simY,
          z: simZ,
          depth: (baselineZ - simZ) / tableHalfLength,
        };
        foundIntercept = true;
      }

      if (simZ < baselineZ - 0.3 && !foundIntercept) {
        bestIntercept = {
          x: simX,
          y: Math.max(TABLE.HEIGHT, simY),
          z: simZ,
          depth: Math.max(-0.3, (baselineZ - simZ) / tableHalfLength),
        };
        break;
      }

      steps++;
    }

    bestIntercept.x = Math.max(
      -tableHalfWidth,
      Math.min(tableHalfWidth, bestIntercept.x),
    );
    bestIntercept.y = Math.max(
      TABLE.HEIGHT,
      Math.min(TABLE.HEIGHT + 0.5, bestIntercept.y),
    );

    const normalizedX = 0.5 + bestIntercept.x / TABLE.WIDTH;
    const normalizedY = Math.max(
      0.15,
      Math.min(0.85, (bestIntercept.y - TABLE.HEIGHT) / 0.4),
    );

    return {
      x: normalizedX,
      y: normalizedY,
      z: bestIntercept.z,
      depth: bestIntercept.depth,
    };
  }

  private anticipateReturnPosition(ball: BallState): number {
    const ballNormX = 0.5 + ball.position.x / TABLE.WIDTH;
    if (this.rallyCount > 1) {
      return 0.5 + (0.5 - ballNormX) * 0.4 * AI_CONFIG.anticipation;
    }
    return 0.5;
  }

  private moveTowardsTarget(deltaTime: number, ball: BallState): void {
    const baseSpeed = AI_CONFIG.speed * deltaTime * 60;

    const dx = this.targetX - this.currentPaddle.position.x;
    const dy = this.targetY - this.currentPaddle.position.y;
    const dDepth = this.targetDepth - this.currentPaddle.depth;

    const distance = Math.sqrt(dx * dx + dy * dy + dDepth * dDepth);

    if (distance > 0.003) {
      const ballApproaching = ball.velocity.z < 0;
      const ballDistance = ballApproaching
        ? Math.abs(ball.position.z + TABLE.LENGTH / 2)
        : 1;
      const ballSpeed = Math.sqrt(
        ball.velocity.x ** 2 + ball.velocity.y ** 2 + ball.velocity.z ** 2,
      );

      let urgency = 1.0;
      if (ballApproaching) {
        urgency =
          1.0 +
          Math.min(
            1.85,
            0.75 / Math.max(ballDistance, 0.22) + ballSpeed * 0.13,
          );
      }

      const adjustedSpeed = baseSpeed * urgency;

      const moveX = (dx / distance) * Math.min(adjustedSpeed, Math.abs(dx) * 1.5);
      const moveY = (dy / distance) * Math.min(adjustedSpeed, Math.abs(dy) * 1.5);
      const moveDepth =
        (dDepth / distance) *
        Math.min(adjustedSpeed * 0.8, Math.abs(dDepth) * 1.5);

      this.currentPaddle.position = {
        x: Math.max(0.03, Math.min(0.97, this.currentPaddle.position.x + moveX)),
        y: Math.max(0.08, Math.min(0.92, this.currentPaddle.position.y + moveY)),
      };
      this.currentPaddle.depth = Math.max(
        -0.3,
        Math.min(0.5, this.currentPaddle.depth + moveDepth),
      );
    }

    this.currentPaddle.velocity = {
      x: clamp(this.returnAimX * AI_CONFIG.aggression, -0.12, 0.12),
      y: 0,
    };

    this.currentPaddle.faceTilt = {
      x: 0.05,
      y: this.currentPaddle.velocity.x * 0.8,
    };
    this.currentPaddle.brush = {
      x: this.currentPaddle.velocity.x * 0.5,
      y: 0.08,
    };
    this.currentPaddle.swingEnergy = 0.62;

    this.currentPaddle.isActive = true;
    this.currentPaddle.isSwinging = true;
  }

  reset(): void {
    this.targetX = 0.5;
    this.targetY = 0.5;
    this.targetDepth = 0;
    this.currentPaddle.position = { x: 0.5, y: 0.5 };
    this.currentPaddle.velocity = { x: 0, y: 0 };
    this.currentPaddle.depth = 0;
    this.rallyCount = 0;
    this.lastBallZ = 0;
    this.returnAimX = 0;
    this.lastBallState = null;
  }
}

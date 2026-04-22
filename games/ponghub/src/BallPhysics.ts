/**
 * BallPhysics — ported from the original pingpong game. Handles gravity, air resistance,
 * spin, table/net collision, paddle collision, and out-of-bounds scoring decisions. The
 * module is pure: given paddle states it mutates the ball state it owns and returns a
 * `point` result whenever a rally ends.
 */

import { TABLE, BALL, PHYSICS, PADDLE } from "./constants.js";
import type { BallState, PaddleState, Player } from "./types.js";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class BallPhysics {
  private state: BallState;
  private tableHalfLength = TABLE.LENGTH / 2;
  private tableHalfWidth = TABLE.WIDTH / 2;
  private bouncedOnPlayerSide: { player1: boolean; player2: boolean } = {
    player1: false,
    player2: false,
  };
  private rng: () => number;

  constructor(rng: () => number, initialState?: Partial<BallState>) {
    this.rng = rng;
    this.state = {
      position: { x: 0, y: TABLE.HEIGHT + 0.2, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      spin: { x: 0, y: 0 },
      lastHitBy: null,
      isInPlay: false,
      ...initialState,
    };
  }

  getState(): BallState {
    return { ...this.state };
  }

  setState(state: Partial<BallState>): void {
    this.state = { ...this.state, ...state };
  }

  serve(player: Player): void {
    // Player 1 is at +z (near camera), Player 2 (AI) is at -z (far side).
    const startZ =
      player === "player1"
        ? this.tableHalfLength * 0.85
        : -this.tableHalfLength * 0.85;

    const serveSpeed = BALL.INITIAL_SPEED + 1.05 + this.rng() * 0.55;
    const velocityZ = player === "player1" ? -serveSpeed : serveSpeed;
    const upwardVelocity = 2.2 + this.rng() * 0.45;

    this.state = {
      position: {
        x: (this.rng() - 0.5) * 0.2,
        y: TABLE.HEIGHT + 0.3,
        z: startZ,
      },
      velocity: {
        x: (this.rng() - 0.5) * 0.3,
        y: upwardVelocity,
        z: velocityZ,
      },
      spin: { x: 0, y: 0 },
      lastHitBy: player,
      isInPlay: true,
    };

    this.bouncedOnPlayerSide = { player1: false, player2: false };
  }

  update(
    deltaTime: number,
    player1Paddle: PaddleState,
    player2Paddle: PaddleState,
  ): { point?: { winner: Player; reason: string } } {
    if (!this.state.isInPlay) return {};

    const subSteps = Math.ceil(deltaTime / PHYSICS.TIME_STEP);
    const dt = deltaTime / subSteps;

    for (let i = 0; i < subSteps; i++) {
      this.applyGravity(dt);
      this.applyAirResistance();
      this.applySpin(dt);
      this.updatePosition(dt);

      const tableResult = this.checkTableCollision();
      if (tableResult.point) return { point: tableResult.point };

      this.checkPaddleCollision(player1Paddle, "player1");
      this.checkPaddleCollision(player2Paddle, "player2");

      const boundsResult = this.checkOutOfBounds();
      if (boundsResult.point) return { point: boundsResult.point };
    }

    return {};
  }

  private applyGravity(dt: number): void {
    this.state.velocity.y += PHYSICS.GRAVITY * dt;
  }

  private applyAirResistance(): void {
    this.state.velocity.x *= PHYSICS.AIR_RESISTANCE;
    this.state.velocity.y *= PHYSICS.AIR_RESISTANCE;
    this.state.velocity.z *= PHYSICS.AIR_RESISTANCE;
  }

  private applySpin(dt: number): void {
    this.state.velocity.x += this.state.spin.x * BALL.SPIN_FACTOR * dt;
    this.state.velocity.z += this.state.spin.y * BALL.SPIN_FACTOR * dt;
  }

  private updatePosition(dt: number): void {
    this.state.position.x += this.state.velocity.x * dt;
    this.state.position.y += this.state.velocity.y * dt;
    this.state.position.z += this.state.velocity.z * dt;
  }

  private checkTableCollision(): {
    point?: { winner: Player; reason: string };
  } {
    const { position, velocity } = this.state;
    const ballBottom = position.y - BALL.RADIUS;

    if (ballBottom <= TABLE.HEIGHT && velocity.y < 0) {
      const onTable =
        Math.abs(position.x) <= this.tableHalfWidth &&
        Math.abs(position.z) <= this.tableHalfLength;

      if (onTable) {
        position.y = TABLE.HEIGHT + BALL.RADIUS;
        velocity.y = -velocity.y * BALL.BOUNCE_COEFFICIENT;
        velocity.x *= PHYSICS.TABLE_FRICTION;
        velocity.z *= PHYSICS.TABLE_FRICTION;

        const onPlayer1Side = position.z > 0;
        const onPlayer2Side = position.z < 0;

        if (onPlayer1Side) {
          if (this.bouncedOnPlayerSide.player1) {
            return { point: { winner: "player2", reason: "double-bounce" } };
          }
          this.bouncedOnPlayerSide.player1 = true;
        }
        if (onPlayer2Side) {
          if (this.bouncedOnPlayerSide.player2) {
            return { point: { winner: "player1", reason: "double-bounce" } };
          }
          this.bouncedOnPlayerSide.player2 = true;
        }
      }
    }

    if (
      Math.abs(position.z) < 0.05 &&
      position.y < TABLE.HEIGHT + TABLE.NET_HEIGHT &&
      position.y > TABLE.HEIGHT
    ) {
      const hitNet = Math.abs(position.x) <= this.tableHalfWidth;
      if (hitNet) {
        velocity.z = -velocity.z * 0.3;
        velocity.y = Math.abs(velocity.y) * 0.5;
        const winner = this.state.lastHitBy === "player1" ? "player2" : "player1";
        return { point: { winner, reason: "net-fault" } };
      }
    }

    return {};
  }

  private checkPaddleCollision(
    paddle: PaddleState & { depth?: number },
    player: Player,
  ): void {
    if (!paddle.isActive) return;

    // AI can move forward/back with depth; player stays at baseline.
    const aiDepthOffset =
      player === "player2" && paddle.depth ? paddle.depth * this.tableHalfLength : 0;
    const paddleZ =
      player === "player1"
        ? this.tableHalfLength + 0.15
        : -this.tableHalfLength - 0.15 + aiDepthOffset;
    const paddleX = (paddle.position.x - 0.5) * TABLE.WIDTH;
    const paddleY = TABLE.HEIGHT + 0.12 + paddle.position.y * 0.35;

    const dx = this.state.position.x - paddleX;
    const dy = this.state.position.y - paddleY;
    const dz = this.state.position.z - paddleZ;

    const distanceXY = Math.sqrt(dx * dx + dy * dy);
    const hitZone = PADDLE.HIT_ZONE * 1.2;
    const depthTolerance = 0.32;

    const approachingPaddle =
      (player === "player1" && this.state.velocity.z > 0) ||
      (player === "player2" && this.state.velocity.z < 0);

    const hasBouncedOnReceiverSide =
      player === "player1"
        ? this.bouncedOnPlayerSide.player1
        : this.bouncedOnPlayerSide.player2;

    const canHit = paddle.isActive || paddle.isSwinging;

    if (
      distanceXY < hitZone &&
      Math.abs(dz) < depthTolerance &&
      approachingPaddle &&
      canHit &&
      hasBouncedOnReceiverSide
    ) {
      const direction = player === "player1" ? -1 : 1;
      const incomingSpeed = Math.sqrt(
        this.state.velocity.x ** 2 +
          this.state.velocity.y ** 2 +
          this.state.velocity.z ** 2,
      );
      const faceTilt = paddle.faceTilt ?? { x: 0, y: 0 };
      const brush = paddle.brush ?? { x: 0, y: 0 };
      const swingEnergy = Math.max(
        0,
        Math.min(1, paddle.swingEnergy ?? paddle.swipeSpeed),
      );
      const handHeightBias = clamp(0.5 - paddle.position.y, -0.35, 0.35);
      const handLateralBias = clamp(paddle.position.x - 0.5, -0.45, 0.45);

      const swingBoost = Math.min(
        paddle.swipeSpeed * (player === "player1" ? 7.5 : 6.8),
        1.1,
      );
      const gestureSpeedBonus =
        Math.max(0, swingEnergy - 0.2) * 0.35 +
        Math.abs(brush.y) * 0.08 +
        Math.abs(faceTilt.x) * 0.06;

      const baseSpeed = Math.max(incomingSpeed * 0.85, 2.4);
      const rawSpeed = Math.min(
        baseSpeed + 0.5 + swingBoost + swingEnergy * 0.45 + gestureSpeedBonus,
        BALL.MAX_SPEED,
      );
      const newSpeed = rawSpeed;

      const offsetX = dx / hitZone;
      const offsetY = dy / hitZone;

      const rawAimX = paddle.velocity.x * (player === "player1" ? 0.4 : 0.5);
      const aimX =
        player === "player1"
          ? Math.max(
              -0.12,
              Math.min(0.12, Math.abs(rawAimX) < 0.02 ? 0 : rawAimX),
            )
          : rawAimX;

      let xVelocity: number;
      if (player === "player1") {
        xVelocity =
          (offsetX * 0.3 +
            aimX * 0.32 +
            brush.x * 0.08 +
            faceTilt.y * 0.1) *
          newSpeed;
      } else {
        xVelocity =
          (aimX * 0.78 +
            offsetX * 0.26 +
            faceTilt.y * 0.1 +
            brush.x * 0.07) *
          newSpeed;
      }

      this.state.velocity = {
        x: xVelocity,
        y:
          1.45 +
          Math.abs(offsetY) * newSpeed * 0.1 +
          swingBoost * 0.12 +
          faceTilt.x * 0.5 +
          brush.y * 0.14 +
          handHeightBias * 0.25,
        z: direction * newSpeed * (0.95 + swingEnergy * 0.08),
      };

      const spinX =
        offsetX * 0.7 +
        aimX * 0.9 +
        brush.x * 0.7 +
        faceTilt.y * 0.5 +
        handLateralBias * 0.35;
      const spinY =
        offsetY * 0.8 +
        brush.y * 0.9 +
        faceTilt.x * 0.6 +
        handHeightBias * 0.55;
      this.state.spin = {
        x: clamp(spinX, -2.8, 2.8),
        y: clamp(spinY, -2.8, 2.8),
      };

      this.state.lastHitBy = player;
      this.bouncedOnPlayerSide = { player1: false, player2: false };
    }
  }

  private checkOutOfBounds(): {
    point?: { winner: Player; reason: string };
  } {
    const { position } = this.state;

    if (Math.abs(position.x) > this.tableHalfWidth + 0.4) {
      const winner = this.state.lastHitBy === "player1" ? "player2" : "player1";
      this.state.isInPlay = false;
      return { point: { winner, reason: "out-of-bounds" } };
    }

    const pastPlayer1End = position.z > this.tableHalfLength + 0.5;
    const pastPlayer2End = position.z < -this.tableHalfLength - 0.5;

    if (pastPlayer2End) {
      if (this.bouncedOnPlayerSide.player2) {
        this.state.isInPlay = false;
        return { point: { winner: "player1", reason: "miss" } };
      }
      this.state.isInPlay = false;
      return { point: { winner: "player2", reason: "out-of-bounds" } };
    }

    if (pastPlayer1End) {
      if (this.bouncedOnPlayerSide.player1) {
        this.state.isInPlay = false;
        return { point: { winner: "player2", reason: "miss" } };
      }
      this.state.isInPlay = false;
      return { point: { winner: "player1", reason: "out-of-bounds" } };
    }

    if (position.y < -0.2) {
      const onPlayer1Side = position.z > 0;
      const onPlayer2Side = position.z < 0;

      if (onPlayer2Side && this.bouncedOnPlayerSide.player2) {
        this.state.isInPlay = false;
        return { point: { winner: "player1", reason: "miss" } };
      }
      if (onPlayer1Side && this.bouncedOnPlayerSide.player1) {
        this.state.isInPlay = false;
        return { point: { winner: "player2", reason: "miss" } };
      }

      const winner = this.state.lastHitBy === "player1" ? "player2" : "player1";
      this.state.isInPlay = false;
      return { point: { winner, reason: "out-of-bounds" } };
    }

    return {};
  }

  reset(): void {
    this.state = {
      position: { x: 0, y: TABLE.HEIGHT + 0.2, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      spin: { x: 0, y: 0 },
      lastHitBy: null,
      isInPlay: false,
    };
    this.bouncedOnPlayerSide = { player1: false, player2: false };
  }
}

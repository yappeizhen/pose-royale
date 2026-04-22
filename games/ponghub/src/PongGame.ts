/**
 * PongGame — single-player Pong logic. Pure state + physics, so it's testable without a canvas.
 * The player paddle sits on the left edge of the field. A simple AI paddle on the right does
 * tracking with a small reaction lag; the ball bounces forever until the player misses, at
 * which point the ball resets to center. One point per successful player return.
 *
 * Coordinates are normalized 0..1 for both axes (like FruitGame) so rendering can scale to
 * any canvas size.
 */

export interface PongGameOptions {
  rng: () => number;
  /** Half-height of each paddle in normalized units. Default 0.1. */
  paddleHalfHeight?: number;
  /** Paddle x position on each side (left/right). Default 0.04 / 0.96. */
  paddleInset?: number;
  /** Initial ball speed (normalized/sec). Default 0.7. */
  initialSpeed?: number;
  /** Speed multiplier per successful return. Default 1.06. */
  rallyAcceleration?: number;
  /** AI tracking speed (normalized/sec). Default 0.55. */
  aiSpeed?: number;
  /** Ball radius in normalized units. Default 0.02. */
  ballRadius?: number;
}

export interface PongState {
  paddleY: number;
  aiPaddleY: number;
  ball: { x: number; y: number; vx: number; vy: number };
  returns: number;
  misses: number;
  rallyMultiplier: number;
}

export class PongGame {
  private readonly rng: () => number;
  private readonly paddleHalfHeight: number;
  private readonly leftX: number;
  private readonly rightX: number;
  private readonly initialSpeed: number;
  private readonly rallyAcceleration: number;
  private readonly aiSpeed: number;
  private readonly ballRadius: number;

  private paddleY: number;
  private paddleTarget: number;
  private aiY: number;

  private ballX: number;
  private ballY: number;
  private ballVx: number;
  private ballVy: number;

  private returnsCount = 0;
  private missesCount = 0;
  private rallyMul = 1;

  constructor(opts: PongGameOptions) {
    this.rng = opts.rng;
    this.paddleHalfHeight = opts.paddleHalfHeight ?? 0.1;
    const inset = opts.paddleInset ?? 0.04;
    this.leftX = inset;
    this.rightX = 1 - inset;
    this.initialSpeed = opts.initialSpeed ?? 0.7;
    this.rallyAcceleration = opts.rallyAcceleration ?? 1.06;
    this.aiSpeed = opts.aiSpeed ?? 0.55;
    this.ballRadius = opts.ballRadius ?? 0.02;

    this.paddleY = 0.5;
    this.paddleTarget = 0.5;
    this.aiY = 0.5;

    this.ballX = 0.5;
    this.ballY = 0.5;
    const { vx, vy } = this.initialVelocity();
    this.ballVx = vx;
    this.ballVy = vy;
  }

  /** Consumer supplies the latest palm-y in normalized field coords. */
  setPaddleTarget(y: number): void {
    this.paddleTarget = clamp(y, this.paddleHalfHeight, 1 - this.paddleHalfHeight);
  }

  tick(dtSec: number): void {
    // Ease the paddle toward the target so CV jitter doesn't jackhammer the rendering.
    this.paddleY += (this.paddleTarget - this.paddleY) * Math.min(1, dtSec * 12);

    // AI paddle chases ball with a max speed. Intentionally imperfect so scoring is possible.
    const aiTarget = clamp(this.ballY, this.paddleHalfHeight, 1 - this.paddleHalfHeight);
    const dir = Math.sign(aiTarget - this.aiY);
    const step = this.aiSpeed * dtSec;
    this.aiY = Math.abs(aiTarget - this.aiY) <= step ? aiTarget : this.aiY + dir * step;

    // Advance ball.
    this.ballX += this.ballVx * dtSec;
    this.ballY += this.ballVy * dtSec;

    // Top/bottom wall bounce.
    if (this.ballY < this.ballRadius) {
      this.ballY = this.ballRadius;
      this.ballVy = Math.abs(this.ballVy);
    } else if (this.ballY > 1 - this.ballRadius) {
      this.ballY = 1 - this.ballRadius;
      this.ballVy = -Math.abs(this.ballVy);
    }

    // Left paddle — player.
    if (this.ballX - this.ballRadius <= this.leftX && this.ballVx < 0) {
      if (Math.abs(this.ballY - this.paddleY) <= this.paddleHalfHeight + this.ballRadius) {
        this.ballX = this.leftX + this.ballRadius;
        this.ballVx = Math.abs(this.ballVx) * this.rallyAcceleration;
        // Add a dash of english: the further from paddle center, the sharper the angle.
        const offset = (this.ballY - this.paddleY) / this.paddleHalfHeight;
        this.ballVy += offset * 0.35;
        this.returnsCount += 1;
        this.rallyMul *= this.rallyAcceleration;
      } else if (this.ballX < -0.05) {
        this.missed();
      }
    }

    // Right paddle — AI.
    if (this.ballX + this.ballRadius >= this.rightX && this.ballVx > 0) {
      if (Math.abs(this.ballY - this.aiY) <= this.paddleHalfHeight + this.ballRadius) {
        this.ballX = this.rightX - this.ballRadius;
        this.ballVx = -Math.abs(this.ballVx);
        const offset = (this.ballY - this.aiY) / this.paddleHalfHeight;
        this.ballVy += offset * 0.3;
      } else if (this.ballX > 1.05) {
        // AI miss — count as a player return since they scored.
        this.returnsCount += 1;
        this.rallyMul *= this.rallyAcceleration;
        this.resetBall(-1);
      }
    }
  }

  private missed(): void {
    this.missesCount += 1;
    this.rallyMul = 1;
    this.resetBall(+1);
  }

  private resetBall(towardPlayer: -1 | 1): void {
    this.ballX = 0.5;
    this.ballY = 0.3 + this.rng() * 0.4;
    const speed = this.initialSpeed;
    const angle = (this.rng() - 0.5) * 0.8;
    this.ballVx = speed * towardPlayer * (towardPlayer === -1 ? 1 : -1);
    this.ballVy = speed * angle;
  }

  private initialVelocity(): { vx: number; vy: number } {
    const speed = this.initialSpeed;
    const angle = (this.rng() - 0.5) * 0.6;
    const dir = this.rng() < 0.5 ? -1 : 1;
    return { vx: speed * dir, vy: speed * angle };
  }

  state(): PongState {
    return {
      paddleY: this.paddleY,
      aiPaddleY: this.aiY,
      ball: { x: this.ballX, y: this.ballY, vx: this.ballVx, vy: this.ballVy },
      returns: this.returnsCount,
      misses: this.missesCount,
      rallyMultiplier: this.rallyMul,
    };
  }

  rawScore(): number {
    return this.returnsCount;
  }

  get paddleHalf(): number {
    return this.paddleHalfHeight;
  }

  get leftPaddleX(): number {
    return this.leftX;
  }

  get rightPaddleX(): number {
    return this.rightX;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

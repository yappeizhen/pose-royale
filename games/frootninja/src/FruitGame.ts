/**
 * FruitGame — the pure game logic for Frootninja. Headless + unit-testable. Physics is
 * plain arcade: projectiles spawn at the bottom of the field with an upward velocity and a
 * constant downward gravity. Fingertip positions (normalized 0..1 into the field) sweep
 * through and any object whose center-distance falls under a `sliceRadius` in the last
 * `sliceWindowMs` is sliced.
 *
 * The rendering layer (in index.ts) draws what `state()` returns each frame. This split
 * keeps the game loop independent of DOM APIs, which makes the leak test trivial.
 */

export type ObjectKind = "fruit" | "bomb";

export interface FieldObject {
  id: number;
  kind: ObjectKind;
  x: number; // field-normalized 0..1
  y: number; // field-normalized 0..1 (0 = top, 1 = bottom)
  vx: number; // normalized / sec
  vy: number; // normalized / sec (negative = upward)
  spawnedAt: number; // ms
  sliced: boolean;
  missed: boolean;
}

export interface BladeSample {
  x: number;
  y: number;
  t: number; // ms
}

export interface FruitGameOptions {
  rng: () => number;
  /** Gravity in normalized units/sec². Default 2.2 — feels arcadey. */
  gravity?: number;
  /** Mean seconds between spawns. Default 0.55s. */
  spawnEverySec?: number;
  /** Probability any given spawn is a bomb. Default 0.12. */
  bombChance?: number;
  /** Hit radius (normalized) between blade sample and object center. Default 0.07. */
  sliceRadius?: number;
  /** Blade samples older than this (ms) don't count as a slice. Default 140ms. */
  sliceWindowMs?: number;
}

export interface FruitGameState {
  objects: readonly FieldObject[];
  sliced: number;
  missed: number;
  bombs: number;
}

export class FruitGame {
  private readonly rng: () => number;
  private readonly gravity: number;
  private readonly spawnEverySec: number;
  private readonly bombChance: number;
  private readonly sliceRadius: number;
  private readonly sliceWindowMs: number;

  private elapsedMs = 0;
  private nextSpawnAt = 0;
  private nextId = 1;
  private objects: FieldObject[] = [];
  private blade: BladeSample[] = [];

  private _sliced = 0;
  private _missed = 0;
  private _bombHits = 0;

  constructor(opts: FruitGameOptions) {
    this.rng = opts.rng;
    this.gravity = opts.gravity ?? 2.2;
    this.spawnEverySec = opts.spawnEverySec ?? 0.55;
    this.bombChance = opts.bombChance ?? 0.12;
    this.sliceRadius = opts.sliceRadius ?? 0.07;
    this.sliceWindowMs = opts.sliceWindowMs ?? 140;
    this.nextSpawnAt = this.jitteredNextSpawn(0);
  }

  /** Advance the simulation by `dt` seconds. */
  tick(dtSec: number): void {
    this.elapsedMs += dtSec * 1000;

    // Spawn loop — run as many times as we missed in a slow frame.
    while (this.elapsedMs >= this.nextSpawnAt) {
      this.spawnOne();
      this.nextSpawnAt += this.jitteredInterval();
    }

    for (const obj of this.objects) {
      if (obj.sliced) continue;
      obj.x += obj.vx * dtSec;
      obj.y += obj.vy * dtSec;
      obj.vy += this.gravity * dtSec;
      if (!obj.missed && obj.y > 1.1 && obj.vy > 0) {
        obj.missed = true;
        if (obj.kind === "fruit") this._missed += 1;
      }
    }

    // Retire objects off-screen so the array doesn't grow unbounded. 500 cap as a safety net.
    this.objects = this.objects
      .filter((o) => o.y < 1.4 || !o.missed)
      .slice(-500);

    // Age out blade samples older than the slice window. They're useful for rendering the
    // trail too, so the caller can read `bladeTrail()` directly.
    const cutoff = this.elapsedMs - this.sliceWindowMs;
    this.blade = this.blade.filter((s) => s.t >= cutoff);
  }

  /**
   * Feed a blade sample — normalized 0..1 field coordinates and an absolute timestamp (ms).
   * Returns the list of slice events produced this call so the renderer can play FX.
   */
  pushBlade(
    sample: Omit<BladeSample, "t"> & { t?: number },
  ): { sliced: FieldObject[]; hitBomb: boolean } {
    const t = sample.t ?? this.elapsedMs;
    this.blade.push({ x: sample.x, y: sample.y, t });

    const slicedThis: FieldObject[] = [];
    let hitBomb = false;
    for (const obj of this.objects) {
      if (obj.sliced || obj.missed) continue;
      const dx = obj.x - sample.x;
      const dy = obj.y - sample.y;
      if (dx * dx + dy * dy <= this.sliceRadius * this.sliceRadius) {
        obj.sliced = true;
        slicedThis.push(obj);
        if (obj.kind === "fruit") this._sliced += 1;
        else {
          this._bombHits += 1;
          hitBomb = true;
        }
      }
    }
    return { sliced: slicedThis, hitBomb };
  }

  state(): FruitGameState {
    return {
      objects: this.objects,
      sliced: this._sliced,
      missed: this._missed,
      bombs: this._bombHits,
    };
  }

  /** Running raw score = fruits sliced minus bomb hits (never negative). */
  rawScore(): number {
    return Math.max(0, this._sliced - this._bombHits);
  }

  bladeTrail(): readonly BladeSample[] {
    return this.blade;
  }

  private spawnOne(): void {
    const kind: ObjectKind = this.rng() < this.bombChance ? "bomb" : "fruit";
    const x = 0.1 + this.rng() * 0.8;
    // Upward launch velocity tuned so fruits peak somewhere above the midline.
    const vy = -(1.2 + this.rng() * 0.4);
    const vx = (this.rng() - 0.5) * 0.4;
    this.objects.push({
      id: this.nextId++,
      kind,
      x,
      y: 1.05,
      vx,
      vy,
      spawnedAt: this.elapsedMs,
      sliced: false,
      missed: false,
    });
  }

  private jitteredInterval(): number {
    // 0.5x..1.5x mean, uniform. Keeps the cadence feeling organic.
    return (0.5 + this.rng()) * this.spawnEverySec * 1000;
  }

  private jitteredNextSpawn(fromMs: number): number {
    return fromMs + this.jitteredInterval();
  }
}

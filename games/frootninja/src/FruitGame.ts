import * as THREE from "three";

// ──────────────────────────────────────────────────────────────────────────────
// Local types — the full Pose Royale types live in @pose-royale/sdk but
// the FruitGame is engine-only and stays deliberately decoupled from the SDK
// so it can be vendored cleanly into the canvas host.
// ──────────────────────────────────────────────────────────────────────────────

export type Handedness = "Left" | "Right";

export interface GestureEvent {
  id: string;
  type: "slice";
  hand: Handedness;
  speed: number;
  strength: number;
  direction: { x: number; y: number };
  timestamp: number;
  origin: { x: number; y: number; z: number };
}

export type FruitType =
  | "strawberry"
  | "orange"
  | "apple"
  | "watermelon"
  | "grape"
  | "lemon"
  | "kiwi"
  | "bomb";

export interface SliceResult {
  fruitId: string;
  hand: Handedness;
  isBomb: boolean;
}

const GRAVITY = new THREE.Vector3(0, -8.0, 0);

interface FruitConfig {
  type: FruitType;
  outerColor: number;
  innerColor: number;
  scale: THREE.Vector3;
  geometry: THREE.BufferGeometry;
  isBomb?: boolean;
}

interface FruitBody {
  id: string;
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  createdAt: number;
  outerColor: number;
  innerColor: number;
  initialScale: THREE.Vector3;
  type: FruitType;
  isBomb: boolean;
}

interface SliceHalf {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
}

interface JuiceParticle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  scale: number;
  life: number;
}

interface SliceEffect {
  halves: SliceHalf[];
  juiceParticles: JuiceParticle[];
  juiceMesh: THREE.InstancedMesh;
  elapsed: number;
  lifespan: number;
}

interface ExplosionParticle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  scale: number;
  life: number;
}

interface ExplosionEffect {
  particles: ExplosionParticle[];
  particleMesh: THREE.InstancedMesh;
  flashMesh: THREE.Mesh;
  elapsed: number;
  lifespan: number;
}

/**
 * The 3D fruit-slicing engine. Vendored from yappeizhen/frootninja (FruitGame.ts)
 * and decoupled from the original game store — the GameModule host owns scoring,
 * combo, lives, and multiplayer sync. Determinism is provided by the caller via
 * the `rng` parameter (Mulberry32 from @pose-royale/sdk in practice) so both
 * peers in a match see identical fruit trajectories.
 */
export class FruitGame {
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private fruits: FruitBody[] = [];
  private effects: SliceEffect[] = [];
  private explosionEffects: ExplosionEffect[] = [];
  private animationHandle: number | null = null;
  private lastTime = performance.now();
  private spawnAccumulator = 0;
  private canvas: HTMLCanvasElement;
  private projectionHelper = new THREE.Vector3();
  private envMap: THREE.Texture | null = null;
  private readonly sliceHitboxRadius = 0.15;

  private sphereGeo = new THREE.SphereGeometry(1, 64, 64);
  private halfSphereGeo: THREE.BufferGeometry;
  private strawberryGeo: THREE.BufferGeometry;
  private orangeGeo: THREE.BufferGeometry;
  private lemonGeo: THREE.BufferGeometry;
  private appleGeo: THREE.BufferGeometry;
  private bombGeo: THREE.BufferGeometry;
  private juiceGeo = new THREE.SphereGeometry(1, 12, 12);

  private rng: () => number;

  constructor(canvas: HTMLCanvasElement, rng: () => number = Math.random) {
    this.canvas = canvas;
    this.rng = rng;

    this.halfSphereGeo = this.createHalfSphere();
    this.strawberryGeo = this.createStrawberryGeometry();
    this.orangeGeo = this.createOrangeGeometry();
    this.lemonGeo = this.createLemonGeometry();
    this.appleGeo = this.createAppleGeometry();
    this.bombGeo = this.createBombGeometry();

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.4;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    this.camera.position.set(0, 1.5, 4);
    this.camera.lookAt(0, 1, 0);

    this.createEnvironmentMap();

    this.scene.add(new THREE.AmbientLight(0xfff5ee, 0.4));

    const keyLight = new THREE.DirectionalLight(0xfffaf0, 1.5);
    keyLight.position.set(5, 8, 5);
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xe6f0ff, 0.6);
    fillLight.position.set(-4, 3, 3);
    this.scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffeedd, 0.8);
    rimLight.position.set(0, -2, -5);
    this.scene.add(rimLight);

    const accentLight1 = new THREE.PointLight(0xff9966, 0.4, 8);
    accentLight1.position.set(3, 2, 2);
    this.scene.add(accentLight1);

    const accentLight2 = new THREE.PointLight(0x99ccff, 0.3, 8);
    accentLight2.position.set(-3, 1, 2);
    this.scene.add(accentLight2);

    this.handleResize();
    window.addEventListener("resize", this.handleResize);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  start() {
    if (this.animationHandle) return;
    this.lastTime = performance.now();
    this.renderer.setAnimationLoop(this.tick);
    this.animationHandle = 1;
  }

  stop() {
    if (!this.animationHandle) return;
    this.renderer.setAnimationLoop(null);
    this.animationHandle = null;
  }

  dispose() {
    this.stop();
    window.removeEventListener("resize", this.handleResize);
    this.fruits.forEach((fruit) => {
      this.scene.remove(fruit.mesh);
      (fruit.mesh.material as THREE.Material).dispose();
    });
    this.effects.forEach((effect) => {
      effect.halves.forEach((h) => {
        this.scene.remove(h.mesh);
        (h.mesh.material as THREE.Material).dispose();
      });
      this.scene.remove(effect.juiceMesh);
      effect.juiceMesh.dispose();
    });
    this.explosionEffects.forEach((effect) => {
      this.scene.remove(effect.particleMesh);
      this.scene.remove(effect.flashMesh);
      effect.particleMesh.dispose();
      (effect.flashMesh.material as THREE.Material).dispose();
    });
    this.sphereGeo.dispose();
    this.halfSphereGeo.dispose();
    this.strawberryGeo.dispose();
    this.orangeGeo.dispose();
    this.lemonGeo.dispose();
    this.appleGeo.dispose();
    this.bombGeo.dispose();
    this.juiceGeo.dispose();
    if (this.envMap) this.envMap.dispose();
    this.renderer.dispose();
  }

  handleGesture(gesture: GestureEvent): SliceResult | null {
    const candidate = this.pickGestureTarget(gesture);
    if (!candidate) return null;

    if (candidate.isBomb) {
      this.explodeBomb(candidate);
    } else {
      this.sliceFruit(candidate, gesture);
    }

    return {
      fruitId: candidate.id,
      hand: gesture.hand,
      isBomb: candidate.isBomb,
    };
  }

  syncViewport() {
    this.handleResize();
  }

  /**
   * Trigger a slice effect for opponent visualization. Falls back to position-based
   * matching when the fruit ID isn't in our local scene (can happen briefly during
   * reconnects before the deterministic spawn stream catches up).
   */
  triggerSliceEffectById(fruitId: string, fallbackX: number, fallbackY: number) {
    if (!this.fruits.length) return;

    let targetFruit = this.fruits.find((f) => f.id === fruitId) ?? null;
    if (!targetFruit) {
      let nearestDistance = Infinity;
      for (const fruit of this.fruits) {
        const screen = this.projectToScreen(fruit);
        const dx = screen.x - fallbackX;
        const dy = screen.y - fallbackY;
        const distance = Math.hypot(dx, dy);
        if (distance < nearestDistance) {
          targetFruit = fruit;
          nearestDistance = distance;
        }
      }
      if (nearestDistance > 0.4) {
        targetFruit = null;
      }
    }
    if (!targetFruit) return;

    const fakeGesture: GestureEvent = {
      id: `opponent_${Date.now()}`,
      type: "slice",
      origin: { x: fallbackX, y: fallbackY, z: 0.5 },
      direction: { x: 0.5, y: 0.5 },
      speed: 1,
      strength: 1,
      hand: "Right",
      timestamp: Date.now(),
    };
    if (targetFruit.isBomb) {
      this.explodeBomb(targetFruit);
    } else {
      this.sliceFruit(targetFruit, fakeGesture);
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private createEnvironmentMap() {
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    pmremGenerator.compileEquirectangularShader();

    const envScene = new THREE.Scene();

    const skyGeo = new THREE.SphereGeometry(50, 32, 32);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        topColor: { value: new THREE.Color(0xffffff) },
        bottomColor: { value: new THREE.Color(0x8899bb) },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition).y * 0.5 + 0.5;
          gl_FragColor = vec4(mix(bottomColor, topColor, h), 1.0);
        }
      `,
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    envScene.add(sky);

    const lightGeo = new THREE.SphereGeometry(2, 16, 16);
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const light1 = new THREE.Mesh(lightGeo, lightMat);
    light1.position.set(20, 30, 20);
    envScene.add(light1);

    const light2 = new THREE.Mesh(lightGeo, lightMat.clone());
    light2.position.set(-15, 20, 15);
    envScene.add(light2);

    const envRT = pmremGenerator.fromScene(envScene, 0.04);
    this.envMap = envRT.texture;
    this.scene.environment = this.envMap;

    pmremGenerator.dispose();
  }

  private createHalfSphere(): THREE.BufferGeometry {
    const geo = new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    geo.rotateX(Math.PI / 2);
    return geo;
  }

  private createStrawberryGeometry(): THREE.BufferGeometry {
    const points: THREE.Vector2[] = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      const y = 1.2 * (1 - t) - 0.3;
      let r: number;
      if (t < 0.15) {
        r = 0.15 + t * 1.5;
      } else if (t < 0.5) {
        r = 0.35 + Math.sin(((t - 0.15) * Math.PI) / 0.35) * 0.35;
      } else {
        r = 0.7 * Math.pow(1 - (t - 0.5) / 0.5, 1.5);
      }
      points.push(new THREE.Vector2(r, y));
    }
    return new THREE.LatheGeometry(points, 32);
  }

  private createOrangeGeometry(): THREE.BufferGeometry {
    const geo = new THREE.SphereGeometry(1, 64, 64);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      pos.setY(i, y * 0.92);
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const noise = Math.sin(x * 15) * Math.cos(z * 15) * 0.015;
      pos.setX(i, x + x * noise);
      pos.setZ(i, z + z * noise);
    }
    geo.computeVertexNormals();
    return geo;
  }

  private createLemonGeometry(): THREE.BufferGeometry {
    const points: THREE.Vector2[] = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const angle = t * Math.PI;
      const y = Math.cos(angle) * 0.65;
      let r = Math.sin(angle) * 0.45;
      if (t < 0.15 || t > 0.85) {
        r *= 0.7;
      }
      points.push(new THREE.Vector2(r, y));
    }
    return new THREE.LatheGeometry(points, 32);
  }

  private createAppleGeometry(): THREE.BufferGeometry {
    const points: THREE.Vector2[] = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const angle = t * Math.PI;
      let y = Math.cos(angle) * 0.55;
      let r = Math.sin(angle) * 0.5;
      if (t < 0.2) {
        r *= 0.85 + t * 0.75;
        y -= (0.2 - t) * 0.3;
      }
      if (t > 0.6) {
        r *= 1.05;
      }
      points.push(new THREE.Vector2(r, y));
    }
    return new THREE.LatheGeometry(points, 32);
  }

  private createBombGeometry(): THREE.BufferGeometry {
    return new THREE.SphereGeometry(1, 32, 32);
  }

  private createBombMaterial(): THREE.MeshPhysicalMaterial {
    return new THREE.MeshPhysicalMaterial({
      color: 0x1a1a1a,
      roughness: 0.3,
      metalness: 0.8,
      clearcoat: 0.5,
      clearcoatRoughness: 0.2,
      emissive: 0x330000,
      emissiveIntensity: 0.3,
    });
  }

  private createFruitMaterial(
    color: number,
    isInner: boolean = false,
    fruitType?: FruitType,
  ): THREE.MeshPhysicalMaterial {
    const baseColor = new THREE.Color(color);
    const sssColor = baseColor.clone().lerp(new THREE.Color(0xffffff), 0.3);

    const mat = new THREE.MeshPhysicalMaterial({
      color: color,
      roughness: isInner ? 0.45 : 0.18,
      metalness: 0.0,
      clearcoat: isInner ? 0.2 : 0.7,
      clearcoatRoughness: isInner ? 0.3 : 0.15,
      transmission: isInner ? 0.15 : 0.35,
      thickness: 1.2,
      ior: 1.4,
      attenuationColor: sssColor,
      attenuationDistance: 0.5,
      sheen: fruitType === "kiwi" ? 0.8 : 0.1,
      sheenRoughness: fruitType === "kiwi" ? 0.8 : 0.3,
      sheenColor: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.5),
      emissive: color,
      emissiveIntensity: isInner ? 0.15 : 0.05,
      envMapIntensity: isInner ? 0.3 : 0.6,
    });
    if (this.envMap) {
      mat.envMap = this.envMap;
    }
    return mat;
  }

  private tick = () => {
    const now = performance.now();
    const delta = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;
    this.update(delta);
    this.renderer.render(this.scene, this.camera);
  };

  private update(delta: number) {
    this.spawnAccumulator += delta;
    if (this.spawnAccumulator >= 1.0) {
      this.spawnAccumulator = this.rng() * 0.3;
      this.spawnFruit();
    }
    this.updateFruits(delta);
    this.updateEffects(delta);
    this.updateExplosions(delta);
  }

  private updateFruits(delta: number) {
    this.fruits = this.fruits.filter((fruit) => {
      fruit.velocity.addScaledVector(GRAVITY, delta);
      fruit.mesh.position.addScaledVector(fruit.velocity, delta);

      fruit.mesh.rotation.x += fruit.spin.x * delta;
      fruit.mesh.rotation.y += fruit.spin.y * delta;
      fruit.mesh.rotation.z += fruit.spin.z * delta;

      const age = (performance.now() - fruit.createdAt) / 1000;
      if (age < 0.4) {
        const t = this.easeOutBack(age / 0.4);
        fruit.mesh.scale.copy(fruit.initialScale).multiplyScalar(t);
      }

      const alive = fruit.mesh.position.y > -2.5;
      if (!alive) {
        this.scene.remove(fruit.mesh);
        (fruit.mesh.material as THREE.Material).dispose();
      }
      return alive;
    });
  }

  private easeOutBack(x: number): number {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  }

  private easeOutCubic(x: number): number {
    return 1 - Math.pow(1 - x, 3);
  }

  private updateEffects(delta: number) {
    this.effects = this.effects.filter((effect) => {
      effect.elapsed += delta;
      const progress = effect.elapsed / effect.lifespan;

      if (progress >= 1) {
        effect.halves.forEach((h) => {
          this.scene.remove(h.mesh);
          (h.mesh.material as THREE.Material).dispose();
        });
        this.scene.remove(effect.juiceMesh);
        effect.juiceMesh.dispose();
        return false;
      }

      effect.halves.forEach((half) => {
        half.velocity.addScaledVector(GRAVITY, delta);
        half.mesh.position.addScaledVector(half.velocity, delta);
        half.mesh.rotation.x += half.spin.x * delta;
        half.mesh.rotation.y += half.spin.y * delta;
        half.mesh.rotation.z += half.spin.z * delta;

        const mat = half.mesh.material as THREE.MeshStandardMaterial;
        mat.opacity = 1 - this.easeOutCubic(progress);
        mat.transparent = true;
      });

      const dummy = new THREE.Object3D();
      effect.juiceParticles.forEach((p, i) => {
        p.velocity.addScaledVector(GRAVITY, delta * 0.5);
        p.position.addScaledVector(p.velocity, delta);
        p.velocity.multiplyScalar(0.96);

        dummy.position.copy(p.position);
        const scale = p.scale * (1 - progress * 0.8);
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();
        effect.juiceMesh.setMatrixAt(i, dummy.matrix);
      });
      effect.juiceMesh.instanceMatrix.needsUpdate = true;

      return true;
    });
  }

  private spawnFruit() {
    const config = this.getRandomFruitConfig();
    const isBomb = config.type === "bomb";

    const material = isBomb
      ? this.createBombMaterial()
      : this.createFruitMaterial(config.outerColor, false, config.type);
    const mesh = new THREE.Mesh(config.geometry, material);
    mesh.scale.copy(config.scale);

    if (isBomb) {
      const fuseGeo = new THREE.CylinderGeometry(0.08, 0.06, 0.4, 8);
      const fuseMat = new THREE.MeshBasicMaterial({ color: 0x8b4513 });
      const fuse = new THREE.Mesh(fuseGeo, fuseMat);
      fuse.position.y = 1.1;
      fuse.rotation.z = 0.2;
      mesh.add(fuse);

      const sparkGeo = new THREE.SphereGeometry(0.12, 8, 8);
      const sparkMat = new THREE.MeshBasicMaterial({
        color: 0xff6600,
        transparent: true,
        opacity: 0.9,
      });
      const spark = new THREE.Mesh(sparkGeo, sparkMat);
      spark.position.y = 1.35;
      spark.position.x = 0.08;
      mesh.add(spark);
    }

    const randFloat = (min: number, max: number) => min + this.rng() * (max - min);
    const randSpread = (range: number) => randFloat(-range / 2, range / 2);

    const startX = randSpread(1.8);
    const startZ = randFloat(-0.3, 0.3);
    mesh.position.set(startX, -1.5, startZ);
    this.scene.add(mesh);

    const velocity = new THREE.Vector3(
      randFloat(-0.4, 0.4),
      randFloat(5.5, 7.0),
      randFloat(-0.15, 0.15),
    );

    const spin = new THREE.Vector3(randFloat(-3, 3), randFloat(-3, 3), randFloat(-3, 3));

    const fruitId = `f_${Math.floor(this.rng() * 1_000_000)}_${Math.floor(this.rng() * 1_000_000)}`;

    const fruitBody: FruitBody = {
      id: fruitId,
      mesh,
      velocity,
      spin,
      createdAt: performance.now(),
      outerColor: config.outerColor,
      innerColor: config.innerColor,
      initialScale: config.scale.clone(),
      type: config.type,
      isBomb,
    };
    this.fruits.push(fruitBody);

  }

  private getRandomFruitConfig(): FruitConfig {
    // 15% bomb spawn rate — same as the original.
    if (this.rng() < 0.15) {
      return {
        type: "bomb",
        outerColor: 0x1a1a1a,
        innerColor: 0xff4400,
        geometry: this.bombGeo,
        scale: new THREE.Vector3(0.28, 0.28, 0.28),
        isBomb: true,
      };
    }

    const types: FruitType[] = [
      "strawberry",
      "orange",
      "apple",
      "watermelon",
      "grape",
      "lemon",
      "kiwi",
    ];
    const type = types[Math.floor(this.rng() * types.length)];

    switch (type) {
      case "strawberry":
        return {
          type,
          outerColor: 0xc41e3a,
          innerColor: 0xff6b8a,
          geometry: this.strawberryGeo,
          scale: new THREE.Vector3(0.25, 0.25, 0.25),
        };
      case "orange":
        return {
          type,
          outerColor: 0xe65c00,
          innerColor: 0xffb347,
          geometry: this.orangeGeo,
          scale: new THREE.Vector3(0.28, 0.28, 0.28),
        };
      case "apple":
        return {
          type,
          outerColor: 0x8b0000,
          innerColor: 0xfff8dc,
          geometry: this.appleGeo,
          scale: new THREE.Vector3(0.32, 0.32, 0.32),
        };
      case "watermelon":
        return {
          type,
          outerColor: 0x1a4d1a,
          innerColor: 0xe63950,
          geometry: this.sphereGeo,
          scale: new THREE.Vector3(0.26, 0.34, 0.26),
        };
      case "grape":
        return {
          type,
          outerColor: 0x4a1259,
          innerColor: 0xc9a0dc,
          geometry: this.sphereGeo,
          scale: new THREE.Vector3(0.18, 0.18, 0.18),
        };
      case "lemon":
        return {
          type,
          outerColor: 0xe6c200,
          innerColor: 0xfff59d,
          geometry: this.lemonGeo,
          scale: new THREE.Vector3(0.28, 0.28, 0.28),
        };
      case "kiwi":
        return {
          type,
          outerColor: 0x5c4033,
          innerColor: 0x6bbf59,
          geometry: this.sphereGeo,
          scale: new THREE.Vector3(0.22, 0.26, 0.22),
        };
      default:
        return {
          type: "apple",
          outerColor: 0x8b0000,
          innerColor: 0xfff8dc,
          geometry: this.appleGeo,
          scale: new THREE.Vector3(0.32, 0.32, 0.32),
        };
    }
  }

  private pickGestureTarget(gesture: GestureEvent): FruitBody | null {
    if (!this.fruits.length) return null;
    let bestFruit: FruitBody | null = null;
    let bestDistance = Infinity;
    for (const fruit of this.fruits) {
      const screen = this.projectToScreen(fruit);
      const dx = screen.x - gesture.origin.x;
      const dy = screen.y - gesture.origin.y;
      const distance = Math.hypot(dx, dy);
      if (distance > this.sliceHitboxRadius) continue;
      if (distance < bestDistance) {
        bestFruit = fruit;
        bestDistance = distance;
      }
    }
    return bestFruit;
  }

  private projectToScreen(fruit: FruitBody) {
    this.projectionHelper.copy(fruit.mesh.position);
    this.projectionHelper.project(this.camera);
    return {
      x: (this.projectionHelper.x + 1) / 2,
      y: (1 - this.projectionHelper.y) / 2,
    };
  }

  private sliceFruit(fruit: FruitBody, gesture: GestureEvent) {
    const origin = fruit.mesh.position.clone();
    const scale = fruit.initialScale.clone();

    this.createSliceEffect(origin, scale, fruit.outerColor, fruit.innerColor, gesture, fruit.velocity.clone());

    this.scene.remove(fruit.mesh);
    (fruit.mesh.material as THREE.Material).dispose();
    this.fruits = this.fruits.filter((f) => f.id !== fruit.id);
  }

  private createSliceEffect(
    origin: THREE.Vector3,
    scale: THREE.Vector3,
    outerColor: number,
    innerColor: number,
    gesture: GestureEvent,
    fruitVelocity: THREE.Vector3,
  ) {
    const halves: SliceHalf[] = [];
    const sliceAngle = Math.atan2(gesture.direction.y, gesture.direction.x);

    for (let i = 0; i < 2; i++) {
      const innerMat = this.createFruitMaterial(innerColor, true);
      const halfMesh = new THREE.Mesh(this.halfSphereGeo, innerMat);

      const outerMat = this.createFruitMaterial(outerColor);
      const outerMesh = new THREE.Mesh(this.halfSphereGeo, outerMat);
      outerMesh.rotation.x = Math.PI;
      halfMesh.add(outerMesh);

      halfMesh.scale.copy(scale);
      halfMesh.position.copy(origin);
      halfMesh.rotation.z = sliceAngle + (i === 0 ? 0 : Math.PI);

      const splitDir = i === 0 ? 1 : -1;
      const splitSpeed = 2.5;
      const velocity = fruitVelocity.clone();
      velocity.x += Math.cos(sliceAngle + Math.PI / 2) * splitDir * splitSpeed;
      velocity.y += Math.sin(sliceAngle + Math.PI / 2) * splitDir * splitSpeed + 2;
      velocity.z += THREE.MathUtils.randFloat(-0.5, 0.5);

      const spin = new THREE.Vector3(
        THREE.MathUtils.randFloat(-8, 8),
        THREE.MathUtils.randFloat(-8, 8),
        THREE.MathUtils.randFloat(-4, 4),
      );

      this.scene.add(halfMesh);
      halves.push({ mesh: halfMesh, velocity, spin, life: 0 });
    }

    const juiceCount = 20;
    const juiceMat = new THREE.MeshBasicMaterial({
      color: innerColor,
      transparent: true,
      opacity: 0.8,
    });
    const juiceMesh = new THREE.InstancedMesh(this.juiceGeo, juiceMat, juiceCount);

    const juiceParticles: JuiceParticle[] = [];
    for (let i = 0; i < juiceCount; i++) {
      const angle = THREE.MathUtils.randFloat(0, Math.PI * 2);
      const speed = THREE.MathUtils.randFloat(3, 7);
      const velocity = new THREE.Vector3(
        Math.cos(angle) * speed,
        Math.sin(angle) * speed * 0.6 + 3,
        THREE.MathUtils.randFloat(-1, 1),
      );

      juiceParticles.push({
        position: origin
          .clone()
          .add(
            new THREE.Vector3(
              THREE.MathUtils.randFloat(-0.1, 0.1),
              THREE.MathUtils.randFloat(-0.1, 0.1),
              THREE.MathUtils.randFloat(-0.1, 0.1),
            ),
          ),
        velocity,
        scale: THREE.MathUtils.randFloat(0.02, 0.06),
        life: 0,
      });
    }

    this.scene.add(juiceMesh);

    this.effects.push({
      halves,
      juiceParticles,
      juiceMesh,
      elapsed: 0,
      lifespan: 1.2,
    });
  }

  private explodeBomb(bomb: FruitBody) {
    const origin = bomb.mesh.position.clone();
    this.scene.remove(bomb.mesh);
    (bomb.mesh.material as THREE.Material).dispose();
    this.fruits = this.fruits.filter((f) => f.id !== bomb.id);
    this.createExplosionEffect(origin);
  }

  private createExplosionEffect(origin: THREE.Vector3) {
    const flashGeo = new THREE.SphereGeometry(0.8, 16, 16);
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xff6600,
      transparent: true,
      opacity: 1,
    });
    const flashMesh = new THREE.Mesh(flashGeo, flashMat);
    flashMesh.position.copy(origin);
    this.scene.add(flashMesh);

    const particleCount = 30;
    const particleMat = new THREE.MeshBasicMaterial({
      color: 0xff4400,
      transparent: true,
      opacity: 0.9,
    });
    const particleMesh = new THREE.InstancedMesh(this.juiceGeo, particleMat, particleCount);

    const particles: ExplosionParticle[] = [];
    for (let i = 0; i < particleCount; i++) {
      const angle = THREE.MathUtils.randFloat(0, Math.PI * 2);
      const elevation = THREE.MathUtils.randFloat(-0.5, 0.8);
      const speed = THREE.MathUtils.randFloat(4, 10);

      const velocity = new THREE.Vector3(
        Math.cos(angle) * speed * (1 - Math.abs(elevation)),
        elevation * speed + 2,
        Math.sin(angle) * speed * (1 - Math.abs(elevation)) * 0.5,
      );

      particles.push({
        position: origin.clone(),
        velocity,
        scale: THREE.MathUtils.randFloat(0.03, 0.1),
        life: 0,
      });
    }

    this.scene.add(particleMesh);

    this.explosionEffects.push({
      particles,
      particleMesh,
      flashMesh,
      elapsed: 0,
      lifespan: 1.0,
    });
  }

  private updateExplosions(delta: number) {
    this.explosionEffects = this.explosionEffects.filter((effect) => {
      effect.elapsed += delta;
      const progress = effect.elapsed / effect.lifespan;

      if (progress >= 1) {
        this.scene.remove(effect.particleMesh);
        this.scene.remove(effect.flashMesh);
        effect.particleMesh.dispose();
        (effect.flashMesh.material as THREE.Material).dispose();
        return false;
      }

      const flashProgress = Math.min(progress * 3, 1);
      const flashMat = effect.flashMesh.material as THREE.MeshBasicMaterial;
      flashMat.opacity = 1 - flashProgress;
      effect.flashMesh.scale.setScalar(1 + flashProgress * 2);

      const dummy = new THREE.Object3D();
      effect.particles.forEach((p, i) => {
        p.velocity.y -= delta * 8;
        p.position.addScaledVector(p.velocity, delta);
        p.velocity.multiplyScalar(0.95);

        dummy.position.copy(p.position);
        const scale = p.scale * (1 - progress * 0.5);
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();
        effect.particleMesh.setMatrixAt(i, dummy.matrix);
      });
      effect.particleMesh.instanceMatrix.needsUpdate = true;

      const particleMat = effect.particleMesh.material as THREE.MeshBasicMaterial;
      particleMat.opacity = 0.9 * (1 - this.easeOutCubic(progress));

      return true;
    });
  }

  private handleResize = () => {
    const host = this.canvas.parentElement ?? this.canvas;
    const { clientWidth, clientHeight } = host;
    if (clientWidth === 0 || clientHeight === 0) return;
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(clientWidth, clientHeight, false);
  };
}

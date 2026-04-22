/**
 * PongGame — port of the original pingpong Three.js renderer, stripped of the
 * guest-interpolation path (Gauntlet sync happens via scores on ctx.net, not by
 * replicating ball physics). Owns the scene, camera, table, ball, paddles, lighting,
 * and the RAF tick.
 */

import * as THREE from "three";
import { TABLE, BALL, PADDLE, CAMERA } from "./constants.js";
import { BallPhysics } from "./BallPhysics.js";
import type { BallState, PaddleState, Player } from "./types.js";

export type PointCallback = (winner: Player, reason: string) => void;

export class PongGame {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private canvas: HTMLCanvasElement;

  private table: THREE.Group;
  private ball: THREE.Mesh;
  private ballShadow: THREE.Mesh;
  private paddle1: THREE.Mesh;
  private paddle2: THREE.Mesh;

  private physics: BallPhysics;
  private animationHandle: number | null = null;
  private lastTime = 0;

  private player1Paddle: PaddleState = {
    position: { x: 0.5, y: 0.5 },
    velocity: { x: 0, y: 0 },
    isActive: false,
    isSwinging: false,
    swipeSpeed: 0,
    hand: null,
  };
  private player2Paddle: PaddleState & { depth?: number } = {
    position: { x: 0.5, y: 0.5 },
    velocity: { x: 0, y: 0 },
    isActive: true,
    isSwinging: true,
    swipeSpeed: 0.5,
    hand: "Right",
    depth: 0,
  };

  private onPoint: PointCallback | null = null;

  constructor(canvas: HTMLCanvasElement, rng: () => number) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.physics = new BallPhysics(rng);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.setClearColor(0x000000, 0);

    this.camera = new THREE.PerspectiveCamera(
      CAMERA.FOV,
      1,
      CAMERA.NEAR,
      CAMERA.FAR,
    );
    this.camera.position.set(
      CAMERA.POSITION.x,
      CAMERA.POSITION.y,
      CAMERA.POSITION.z,
    );
    this.camera.lookAt(CAMERA.LOOK_AT.x, CAMERA.LOOK_AT.y, CAMERA.LOOK_AT.z);

    this.setupLighting();
    this.table = this.createTable();
    this.ball = this.createBall();
    this.ballShadow = this.createBallShadow();
    this.paddle1 = this.createPaddle(PADDLE.COLOR);
    this.paddle2 = this.createPaddle(PADDLE.OPPONENT_COLOR);

    this.scene.add(this.table);
    this.scene.add(this.ball);
    this.scene.add(this.ballShadow);
    this.scene.add(this.paddle1);
    this.scene.add(this.paddle2);

    this.handleResize();
  }

  private setupLighting(): void {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.4));

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
    keyLight.position.set(2, 5, 3);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 15;
    keyLight.shadow.camera.left = -3;
    keyLight.shadow.camera.right = 3;
    keyLight.shadow.camera.top = 3;
    keyLight.shadow.camera.bottom = -3;
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x88ccff, 0.5);
    fillLight.position.set(-3, 3, -2);
    this.scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffffee, 0.3);
    rimLight.position.set(0, 2, -4);
    this.scene.add(rimLight);
  }

  private createTable(): THREE.Group {
    const group = new THREE.Group();

    const tableGeo = new THREE.BoxGeometry(TABLE.WIDTH, 0.08, TABLE.LENGTH);
    const tableMat = new THREE.MeshToonMaterial({ color: TABLE.COLOR });
    const tableMesh = new THREE.Mesh(tableGeo, tableMat);
    tableMesh.position.y = TABLE.HEIGHT - 0.04;
    tableMesh.receiveShadow = true;
    group.add(tableMesh);

    const edgeTrimMat = new THREE.MeshToonMaterial({ color: 0x0d47a1 });

    const longTrimGeo = new THREE.BoxGeometry(0.04, 0.1, TABLE.LENGTH + 0.04);
    const leftTrim = new THREE.Mesh(longTrimGeo, edgeTrimMat);
    leftTrim.position.set(-TABLE.WIDTH / 2 - 0.02, TABLE.HEIGHT - 0.03, 0);
    group.add(leftTrim);
    const rightTrim = new THREE.Mesh(longTrimGeo, edgeTrimMat);
    rightTrim.position.set(TABLE.WIDTH / 2 + 0.02, TABLE.HEIGHT - 0.03, 0);
    group.add(rightTrim);

    const shortTrimGeo = new THREE.BoxGeometry(TABLE.WIDTH + 0.08, 0.1, 0.04);
    const nearTrim = new THREE.Mesh(shortTrimGeo, edgeTrimMat);
    nearTrim.position.set(0, TABLE.HEIGHT - 0.03, TABLE.LENGTH / 2 + 0.02);
    group.add(nearTrim);
    const farTrim = new THREE.Mesh(shortTrimGeo, edgeTrimMat);
    farTrim.position.set(0, TABLE.HEIGHT - 0.03, -TABLE.LENGTH / 2 - 0.02);
    group.add(farTrim);

    const lineMat = new THREE.MeshBasicMaterial({ color: TABLE.LINE_COLOR });
    const edgeGeoLong = new THREE.BoxGeometry(TABLE.LINE_WIDTH, 0.01, TABLE.LENGTH);
    const leftEdge = new THREE.Mesh(edgeGeoLong, lineMat);
    leftEdge.position.set(
      -TABLE.WIDTH / 2 + TABLE.LINE_WIDTH / 2 + 0.02,
      TABLE.HEIGHT + 0.001,
      0,
    );
    group.add(leftEdge);
    const rightEdge = new THREE.Mesh(edgeGeoLong, lineMat);
    rightEdge.position.set(
      TABLE.WIDTH / 2 - TABLE.LINE_WIDTH / 2 - 0.02,
      TABLE.HEIGHT + 0.001,
      0,
    );
    group.add(rightEdge);

    const edgeGeoShort = new THREE.BoxGeometry(
      TABLE.WIDTH - 0.04,
      0.01,
      TABLE.LINE_WIDTH,
    );
    const nearEdge = new THREE.Mesh(edgeGeoShort, lineMat);
    nearEdge.position.set(
      0,
      TABLE.HEIGHT + 0.001,
      TABLE.LENGTH / 2 - TABLE.LINE_WIDTH / 2 - 0.02,
    );
    group.add(nearEdge);
    const farEdge = new THREE.Mesh(edgeGeoShort, lineMat);
    farEdge.position.set(
      0,
      TABLE.HEIGHT + 0.001,
      -TABLE.LENGTH / 2 + TABLE.LINE_WIDTH / 2 + 0.02,
    );
    group.add(farEdge);

    const centerLineGeo = new THREE.BoxGeometry(
      TABLE.LINE_WIDTH / 2,
      0.01,
      TABLE.LENGTH,
    );
    const centerLine = new THREE.Mesh(centerLineGeo, lineMat);
    centerLine.position.set(0, TABLE.HEIGHT + 0.001, 0);
    group.add(centerLine);

    const netGeo = new THREE.BoxGeometry(
      TABLE.WIDTH + 0.1,
      TABLE.NET_HEIGHT,
      0.015,
    );
    const netMat = new THREE.MeshToonMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
    });
    const net = new THREE.Mesh(netGeo, netMat);
    net.position.set(0, TABLE.HEIGHT + TABLE.NET_HEIGHT / 2, 0);
    group.add(net);

    const netPostGeo = new THREE.CylinderGeometry(
      0.02,
      0.02,
      TABLE.NET_HEIGHT + 0.06,
      16,
    );
    const netPostMat = new THREE.MeshToonMaterial({ color: 0x90a4ae });
    const leftPost = new THREE.Mesh(netPostGeo, netPostMat);
    leftPost.position.set(
      -TABLE.WIDTH / 2 - 0.05,
      TABLE.HEIGHT + TABLE.NET_HEIGHT / 2,
      0,
    );
    group.add(leftPost);
    const rightPost = new THREE.Mesh(netPostGeo, netPostMat);
    rightPost.position.set(
      TABLE.WIDTH / 2 + 0.05,
      TABLE.HEIGHT + TABLE.NET_HEIGHT / 2,
      0,
    );
    group.add(rightPost);

    const legGeo = new THREE.CylinderGeometry(0.05, 0.06, TABLE.HEIGHT - 0.05, 8);
    const legMat = new THREE.MeshToonMaterial({ color: 0x37474f });
    const legPositions: Array<[number, number]> = [
      [-TABLE.WIDTH / 2 + 0.1, -TABLE.LENGTH / 2 + 0.15],
      [TABLE.WIDTH / 2 - 0.1, -TABLE.LENGTH / 2 + 0.15],
      [-TABLE.WIDTH / 2 + 0.1, TABLE.LENGTH / 2 - 0.15],
      [TABLE.WIDTH / 2 - 0.1, TABLE.LENGTH / 2 - 0.15],
    ];
    for (const [x, z] of legPositions) {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(x, (TABLE.HEIGHT - 0.05) / 2, z);
      leg.castShadow = true;
      group.add(leg);
    }

    return group;
  }

  private createBall(): THREE.Mesh {
    const geo = new THREE.SphereGeometry(BALL.RADIUS, 32, 32);
    const mat = new THREE.MeshToonMaterial({ color: BALL.COLOR });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.position.set(0, TABLE.HEIGHT + 0.2, 0);
    return mesh;
  }

  private createBallShadow(): THREE.Mesh {
    const geo = new THREE.CircleGeometry(BALL.RADIUS * 1.5, 32);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.3,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, TABLE.HEIGHT + 0.002, 0);
    return mesh;
  }

  private createPaddle(color: number): THREE.Mesh {
    const geo = new THREE.CircleGeometry(PADDLE.RADIUS, 32);
    const mat = new THREE.MeshToonMaterial({
      color,
      transparent: true,
      opacity: PADDLE.INACTIVE_OPACITY,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    return mesh;
  }

  setOnPoint(callback: PointCallback | null): void {
    this.onPoint = callback;
  }

  setPlayer1Paddle(paddle: PaddleState): void {
    this.player1Paddle = paddle;
    this.updatePaddleMesh(this.paddle1, paddle, "player1");
  }

  setPlayer2Paddle(paddle: PaddleState & { depth?: number }): void {
    this.player2Paddle = paddle;
    this.updatePaddleMesh(this.paddle2, paddle, "player2");
  }

  private updatePaddleMesh(
    mesh: THREE.Mesh,
    paddle: PaddleState,
    player: Player,
  ): void {
    const x = (paddle.position.x - 0.5) * TABLE.WIDTH;
    const y = TABLE.HEIGHT + 0.1 + paddle.position.y * 0.4;
    const z =
      player === "player1"
        ? TABLE.LENGTH / 2 + 0.15
        : -TABLE.LENGTH / 2 - 0.15;
    mesh.position.set(x, y, z);
    mesh.rotation.x = player === "player1" ? -Math.PI / 6 : Math.PI / 6;

    const mat = mesh.material as THREE.MeshToonMaterial;
    mat.opacity = paddle.isActive
      ? PADDLE.ACTIVE_OPACITY
      : PADDLE.INACTIVE_OPACITY;
  }

  serve(player: Player): void {
    this.physics.serve(player);
  }

  getBallState(): BallState {
    return this.physics.getState();
  }

  start(): void {
    if (this.animationHandle) return;
    this.lastTime = performance.now();
    this.renderer.setAnimationLoop(this.tick);
    this.animationHandle = 1;
  }

  stop(): void {
    if (!this.animationHandle) return;
    this.renderer.setAnimationLoop(null);
    this.animationHandle = null;
  }

  reset(): void {
    this.physics.reset();
    this.ball.position.set(0, TABLE.HEIGHT + 0.2, 0);
  }

  dispose(): void {
    this.stop();
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });
    this.renderer.dispose();
  }

  private tick = (): void => {
    const now = performance.now();
    const delta = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;
    this.update(delta);
    this.renderer.render(this.scene, this.camera);
  };

  private update(delta: number): void {
    const result = this.physics.update(
      delta,
      this.player1Paddle,
      this.player2Paddle,
    );
    if (result.point && this.onPoint) {
      this.onPoint(result.point.winner, result.point.reason);
    }

    const ballState = this.physics.getState();
    this.ball.position.set(
      ballState.position.x,
      ballState.position.y,
      ballState.position.z,
    );

    const heightAboveTable = ballState.position.y - TABLE.HEIGHT;
    const shadowScale = Math.max(0.3, 1 - heightAboveTable * 0.5);
    this.ballShadow.position.set(
      ballState.position.x,
      TABLE.HEIGHT + 0.002,
      ballState.position.z,
    );
    this.ballShadow.scale.setScalar(shadowScale);
    const shadowMat = this.ballShadow.material as THREE.MeshBasicMaterial;
    shadowMat.opacity = Math.max(0.1, 0.4 - heightAboveTable * 0.2);
  }

  handleResize(): void {
    const container = this.canvas.parentElement ?? this.canvas;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  syncViewport(): void {
    this.handleResize();
  }
}

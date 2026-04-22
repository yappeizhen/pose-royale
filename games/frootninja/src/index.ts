/**
 * Frootninja `GameModule` entry point. The orchestrator calls `mount(el, ctx)`, we set up a
 * single <canvas>, subscribe to hand frames, and drive a RAF loop off deltaTime. Score is
 * emitted every frame so the HUD/dev-overlay sees live totals; in 2P matches we mirror the
 * local score to ctx.net and subscribe for the opponent's updates.
 */

import type {
  FinalScore,
  GameContext,
  GameInstance,
  GameModule,
  HandFrame,
  Landmark,
  Unsub,
} from "@pose-royale/sdk";
import { FruitGame, type FieldObject } from "./FruitGame.js";
import { manifest } from "./manifest.js";

const INDEX_FINGER_TIP = 8;

function mount(el: HTMLElement, ctx: GameContext): GameInstance {
  const canvas = document.createElement("canvas");
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  canvas.style.touchAction = "none";
  canvas.style.background = "transparent";
  el.appendChild(canvas);

  const maybeCtx = canvas.getContext("2d");
  if (!maybeCtx) throw new Error("frootninja: 2D canvas context unavailable");
  const ctx2d: CanvasRenderingContext2D = maybeCtx;

  const game = new FruitGame({ rng: ctx.rng });

  const remoteId = ctx.players.find((p) => !p.isLocal)?.id;
  let remoteRaw = 0;
  const netSubs: Unsub[] = [];
  if (ctx.net && remoteId) {
    netSubs.push(
      ctx.net.subscribe<number>(`score_${remoteId}`, (value) => {
        if (typeof value === "number" && Number.isFinite(value)) remoteRaw = value;
      }),
    );
  }

  // Track fingertips by hand index for smooth motion (mirrors the webcam view so player
  // sees their own hand = blade).
  type Tip = { x: number; y: number };
  let leftTip: Tip | null = null;
  let rightTip: Tip | null = null;
  let lastTickMs = 0;
  let running = true;
  let paused = false;
  let rafId = 0;
  let lastScoreBroadcast = -1;

  const handSub = ctx.hands.subscribe((frame) => {
    updateTipsFromFrame(frame);
  });

  function updateTipsFromFrame(frame: HandFrame): void {
    const map: { Left: Tip | null; Right: Tip | null } = { Left: null, Right: null };
    for (const h of frame.hands) {
      const lm: Landmark | undefined = h.landmarks[INDEX_FINGER_TIP];
      if (!lm) continue;
      // We render mirrored so the player sees themselves — flip x into field space too.
      map[h.handedness] = { x: 1 - lm.x, y: lm.y };
    }
    leftTip = map.Left;
    rightTip = map.Right;
  }

  function resize(): void {
    const rect = el.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  }
  const ro = new ResizeObserver(resize);
  ro.observe(el);
  resize();

  const renderFrame = (nowMs: number): void => {
    if (!running) return;
    rafId = requestAnimationFrame(renderFrame);
    if (paused) {
      lastTickMs = nowMs;
      return;
    }
    const dt = lastTickMs === 0 ? 0 : Math.min(0.05, (nowMs - lastTickMs) / 1000);
    lastTickMs = nowMs;

    // Feed blade samples (index fingertip) before stepping physics so slices register with
    // the current positions rather than lagging a frame.
    if (leftTip) pushBlade(leftTip);
    if (rightTip) pushBlade(rightTip);

    game.tick(dt);
    draw();

    const raw = game.rawScore();
    if (raw !== lastScoreBroadcast) {
      ctx.emitScore({ playerId: ctx.localPlayerId, raw });
      if (ctx.net) void ctx.net.set(`score_${ctx.localPlayerId}`, raw);
      lastScoreBroadcast = raw;
    }
    if (remoteId) {
      ctx.emitScore({ playerId: remoteId, raw: remoteRaw });
    }
  };

  function pushBlade(tip: Tip): void {
    game.pushBlade({ x: tip.x, y: tip.y });
  }

  function draw(): void {
    const { width: W, height: H } = canvas;
    ctx2d.clearRect(0, 0, W, H);

    // Subtle vertical gradient so the canvas is visible over the webcam — alpha-heavy.
    const grad = ctx2d.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "rgba(15, 18, 35, 0.15)");
    grad.addColorStop(1, "rgba(15, 18, 35, 0.45)");
    ctx2d.fillStyle = grad;
    ctx2d.fillRect(0, 0, W, H);

    const state = game.state();
    for (const obj of state.objects) {
      drawObject(obj, W, H);
    }
    drawBlade(W, H);
    drawHud(state.sliced, state.bombs, W);
  }

  function drawObject(obj: FieldObject, W: number, H: number): void {
    const x = obj.x * W;
    const y = obj.y * H;
    const r = Math.max(16, Math.min(W, H) * 0.04);
    ctx2d.save();
    if (obj.kind === "fruit") {
      ctx2d.fillStyle = obj.sliced ? "rgba(255, 180, 60, 0.35)" : "#ff6b9a";
      ctx2d.beginPath();
      ctx2d.arc(x, y, r, 0, Math.PI * 2);
      ctx2d.fill();
      ctx2d.strokeStyle = "#fff";
      ctx2d.lineWidth = 2;
      ctx2d.stroke();
    } else {
      ctx2d.fillStyle = obj.sliced ? "rgba(80, 80, 80, 0.35)" : "#18181b";
      ctx2d.beginPath();
      ctx2d.arc(x, y, r, 0, Math.PI * 2);
      ctx2d.fill();
      ctx2d.strokeStyle = "#ff4444";
      ctx2d.lineWidth = 3;
      ctx2d.stroke();
    }
    ctx2d.restore();
  }

  function drawBlade(W: number, H: number): void {
    const trail = game.bladeTrail();
    if (trail.length < 2) return;
    ctx2d.save();
    ctx2d.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx2d.lineWidth = 4;
    ctx2d.lineCap = "round";
    ctx2d.beginPath();
    ctx2d.moveTo(trail[0]!.x * W, trail[0]!.y * H);
    for (let i = 1; i < trail.length; i++) {
      const p = trail[i]!;
      ctx2d.lineTo(p.x * W, p.y * H);
    }
    ctx2d.stroke();
    ctx2d.restore();
  }

  function drawHud(sliced: number, bombs: number, W: number): void {
    ctx2d.save();
    ctx2d.fillStyle = "rgba(0,0,0,0.35)";
    ctx2d.fillRect(16, 16, 200, 44);
    ctx2d.fillStyle = "#fff";
    ctx2d.font = "bold 20px system-ui, sans-serif";
    ctx2d.fillText(`🍉 ${sliced}   💣 ${bombs}`, 28, 44);
    if (remoteId) {
      ctx2d.fillStyle = "rgba(0,0,0,0.35)";
      ctx2d.fillRect(W - 216, 16, 200, 44);
      ctx2d.fillStyle = "#fff";
      ctx2d.fillText(`OPP ${remoteRaw}`, W - 200, 44);
    }
    ctx2d.restore();
  }

  const roundEndUnsub = ctx.onRoundEnd((final: FinalScore) => {
    // The orchestrator handles aggregation/final screen — this is just a nice hook for
    // future "celebrate my KO" animations. Intentionally no-op for now beyond acknowledging.
    void final;
  });

  return {
    start() {
      lastTickMs = 0;
      rafId = requestAnimationFrame(renderFrame);
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
      lastTickMs = 0;
    },
    destroy() {
      running = false;
      cancelAnimationFrame(rafId);
      handSub();
      roundEndUnsub();
      for (const u of netSubs) u();
      ro.disconnect();
      canvas.remove();
    },
  };
}

const frootninjaModule: GameModule = {
  manifest,
  mount,
};

export default frootninjaModule;
export { manifest, frootninjaModule as module };

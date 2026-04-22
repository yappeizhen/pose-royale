/**
 * PongHub `GameModule`. The renderer draws a pong field onto a <canvas>; the player controls
 * their paddle with the Y of the middle-finger MCP landmark (landmark 9) — stable even when
 * the fingers curl. Opponent's score is pulled from ctx.net in 2P matches.
 */

import type {
  FinalScore,
  GameContext,
  GameInstance,
  GameModule,
  HandFrame,
  Unsub,
} from "@pose-royale/sdk";
import { PongGame } from "./PongGame.js";
import { manifest } from "./manifest.js";

const PALM_LANDMARK = 9; // middle finger MCP — a decent palm-center proxy.

function mount(el: HTMLElement, ctx: GameContext): GameInstance {
  const canvas = document.createElement("canvas");
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  canvas.style.touchAction = "none";
  canvas.style.background = "transparent";
  el.appendChild(canvas);

  const maybeCtx = canvas.getContext("2d");
  if (!maybeCtx) throw new Error("ponghub: 2D canvas context unavailable");
  const g2d: CanvasRenderingContext2D = maybeCtx;

  const game = new PongGame({ rng: ctx.rng });
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

  let running = true;
  let paused = false;
  let rafId = 0;
  let lastTickMs = 0;
  let lastScoreBroadcast = -1;

  const handSub = ctx.hands.subscribe((frame: HandFrame) => {
    // Prefer right hand if both present (most players are right-handed); fall back to either.
    const pick = frame.hands.find((h) => h.handedness === "Right") ?? frame.hands[0];
    if (!pick) return;
    const lm = pick.landmarks[PALM_LANDMARK];
    if (!lm) return;
    game.setPaddleTarget(lm.y);
  });

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

    game.tick(dt);
    draw();

    const raw = game.rawScore();
    if (raw !== lastScoreBroadcast) {
      ctx.emitScore({ playerId: ctx.localPlayerId, raw });
      if (ctx.net) void ctx.net.set(`score_${ctx.localPlayerId}`, raw);
      lastScoreBroadcast = raw;
    }
    if (remoteId) ctx.emitScore({ playerId: remoteId, raw: remoteRaw });
  };

  function draw(): void {
    const { width: W, height: H } = canvas;
    g2d.clearRect(0, 0, W, H);
    const grad = g2d.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "rgba(8, 16, 30, 0.2)");
    grad.addColorStop(1, "rgba(8, 16, 30, 0.55)");
    g2d.fillStyle = grad;
    g2d.fillRect(0, 0, W, H);

    // Center net.
    g2d.save();
    g2d.setLineDash([8, 8]);
    g2d.strokeStyle = "rgba(255,255,255,0.35)";
    g2d.beginPath();
    g2d.moveTo(W / 2, 0);
    g2d.lineTo(W / 2, H);
    g2d.stroke();
    g2d.restore();

    const s = game.state();

    const paddleH = game.paddleHalf * 2 * H;
    const paddleW = Math.max(6, W * 0.012);
    // Player paddle.
    drawPaddle(game.leftPaddleX * W, s.paddleY * H, paddleW, paddleH, "#7dd3fc");
    // AI paddle.
    drawPaddle(game.rightPaddleX * W, s.aiPaddleY * H, paddleW, paddleH, "#ff6b9a");

    // Ball.
    const r = Math.max(4, Math.min(W, H) * 0.015);
    g2d.fillStyle = "#fff";
    g2d.beginPath();
    g2d.arc(s.ball.x * W, s.ball.y * H, r, 0, Math.PI * 2);
    g2d.fill();

    // HUD.
    g2d.save();
    g2d.fillStyle = "rgba(0,0,0,0.35)";
    g2d.fillRect(16, 16, 200, 44);
    g2d.fillStyle = "#fff";
    g2d.font = "bold 20px system-ui, sans-serif";
    g2d.fillText(`🎾 ${s.returns}   ⚠️ ${s.misses}`, 28, 44);
    if (remoteId) {
      g2d.fillStyle = "rgba(0,0,0,0.35)";
      g2d.fillRect(W - 216, 16, 200, 44);
      g2d.fillStyle = "#fff";
      g2d.fillText(`OPP ${remoteRaw}`, W - 200, 44);
    }
    g2d.restore();
  }

  function drawPaddle(cx: number, cy: number, w: number, h: number, color: string): void {
    g2d.save();
    g2d.fillStyle = color;
    g2d.shadowColor = color;
    g2d.shadowBlur = 12;
    g2d.fillRect(cx - w / 2, cy - h / 2, w, h);
    g2d.restore();
  }

  const roundEndUnsub = ctx.onRoundEnd((final: FinalScore) => {
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

const ponghubModule: GameModule = {
  manifest,
  mount,
};

export default ponghubModule;
export { manifest, ponghubModule as module };

/**
 * PongHub `GameModule`. Wires the ported PongGame (3D Three.js table + physics) with a
 * HandController that turns SDK hand frames into a paddle state, plus an AIController
 * on the far side. Each player's raw score = points they've won this round; par = 5.
 *
 * In 2P mode both peers run their own local AI, and we broadcast only scores via
 * `ctx.net` — no ball-state interpolation, so jitter stays local and the HUD always
 * shows the opponent's latest score next to your own.
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
import { AIController } from "./AIController.js";
import { HandController } from "./HandController.js";
import { GAME } from "./constants.js";
import { manifest } from "./manifest.js";

function mount(el: HTMLElement, ctx: GameContext): GameInstance {
  // ── DOM ──────────────────────────────────────────────────────────────────
  // GameStage mounts us into a `position:absolute; inset:0` host (via the
  // .stage-host class). Only force `position:relative` if the host is still
  // `static` — clobbering it otherwise would collapse the host to height:0
  // and our absolutely-positioned canvas would render at 0×0.
  if (getComputedStyle(el).position === "static") {
    el.style.position = "relative";
  }
  el.style.overflow = "hidden";

  const canvas = document.createElement("canvas");
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  canvas.style.background = "transparent";
  canvas.style.touchAction = "none";
  el.appendChild(canvas);

  // Scoreboard — comic-pop styled to match the design brief: white card,
  // thick black border, solid offset shadow, gentle alternating rotation.
  const hud = document.createElement("div");
  hud.style.position = "absolute";
  hud.style.top = "72px"; // below the orchestrator header
  hud.style.left = "0";
  hud.style.right = "0";
  hud.style.display = "flex";
  hud.style.justifyContent = "center";
  hud.style.gap = "24px";
  hud.style.pointerEvents = "none";
  hud.style.fontFamily = "var(--font-display, 'Nunito', system-ui, sans-serif)";
  hud.style.color = "var(--color-fg, #2D1F3D)";
  hud.style.zIndex = "3";

  const badgeBase = [
    "padding:10px 20px",
    "background:var(--color-card, #fff)",
    "border:4px solid var(--color-border, #000)",
    "border-radius:16px",
    "box-shadow:var(--shadow-sm, 4px 4px 0 #000)",
    "min-width:120px",
    "text-align:center",
    "font-family:var(--font-display, 'Nunito', system-ui, sans-serif)",
  ].join(";");

  const labelStyle = "font-size:12px;font-weight:800;letter-spacing:0.08em;opacity:0.75";
  const scoreStyle = "font-size:32px;font-weight:900;line-height:1.1;margin-top:2px";

  const youBadge = document.createElement("div");
  youBadge.style.cssText = `${badgeBase};transform:rotate(-3deg);background:var(--color-tertiary, #FFD93D);color:var(--color-tertiary-fg, #000)`;
  youBadge.innerHTML = `<div style="${labelStyle}">YOU</div><div id="pongHubYouScore" style="${scoreStyle}">0</div>`;

  const aiBadge = document.createElement("div");
  aiBadge.style.cssText = `${badgeBase};transform:rotate(3deg);background:var(--color-coral, #FF6B6B);color:#fff`;
  aiBadge.innerHTML = `<div style="${labelStyle}">CPU</div><div id="pongHubAiScore" style="${scoreStyle}">0</div>`;

  hud.appendChild(youBadge);
  hud.appendChild(aiBadge);
  el.appendChild(hud);

  const youScoreEl = youBadge.querySelector<HTMLDivElement>("#pongHubYouScore")!;
  const aiScoreEl = aiBadge.querySelector<HTMLDivElement>("#pongHubAiScore")!;

  // Center prompt (shown between serves + when acquiring hand). Styled as a
  // white comic-pop card with thick black border + offset shadow, matching
  // the rest of the in-game HUD.
  const prompt = document.createElement("div");
  prompt.style.position = "absolute";
  prompt.style.inset = "0";
  prompt.style.display = "flex";
  prompt.style.alignItems = "center";
  prompt.style.justifyContent = "center";
  prompt.style.pointerEvents = "none";
  prompt.style.opacity = "0";
  prompt.style.transition = "opacity 150ms ease-out";
  prompt.style.zIndex = "3";
  el.appendChild(prompt);

  const promptInner = document.createElement("div");
  promptInner.style.cssText = [
    "background:var(--color-card, #fff)",
    "color:var(--color-fg, #2D1F3D)",
    "border:4px solid var(--color-border, #000)",
    "border-radius:16px",
    "box-shadow:var(--shadow-md, 6px 6px 0 #000)",
    "padding:12px 24px",
    "font-family:var(--font-display, 'Nunito', system-ui, sans-serif)",
    "font-weight:900",
    "font-size:20px",
    "text-transform:uppercase",
    "letter-spacing:0.04em",
    "transform:rotate(-2deg)",
  ].join(";");
  prompt.appendChild(promptInner);

  const setPrompt = (text: string): void => {
    if (text) {
      promptInner.textContent = text;
      prompt.style.opacity = "1";
    } else {
      prompt.style.opacity = "0";
    }
  };

  // ── Engine ───────────────────────────────────────────────────────────────
  const game = new PongGame(canvas, ctx.rng);
  const ai = new AIController(ctx.rng);
  const hands = new HandController({ preferredHand: "Right" });

  let p1Points = 0;
  let p2Points = 0;
  let lastScoreBroadcast = -1;
  let servingPlayer: "player1" | "player2" = "player1";
  let serveTimer: number | null = null;
  let running = true;
  let paused = false;
  let started = false;
  let lastTickTime = 0;
  let rafId = 0;

  const remoteId = ctx.players.find((p) => !p.isLocal)?.id;
  let remoteRaw = 0;
  const netSubs: Unsub[] = [];

  if (ctx.net && remoteId) {
    netSubs.push(
      ctx.net.subscribe<number>(`score_${remoteId}`, (v) => {
        if (typeof v === "number" && Number.isFinite(v)) {
          remoteRaw = v;
          // Emit only on actual opponent-score changes — not every RAF.
          ctx.emitScore({ playerId: remoteId, raw: remoteRaw });
        }
      }),
    );
  }

  // Opponent badge swaps to "OPP" in 2P.
  if (remoteId) {
    aiBadge.querySelector("div")!.textContent = "OPP";
  }

  // ── Scoring lifecycle ────────────────────────────────────────────────────
  game.setOnPoint((winner) => {
    if (winner === "player1") p1Points++;
    else p2Points++;

    youScoreEl.textContent = String(p1Points);
    aiScoreEl.textContent = String(p2Points);

    // Loser serves next (keeps rallies fresh).
    servingPlayer = winner === "player1" ? "player2" : "player1";

    game.reset();
    ai.reset();
    setPrompt(winner === "player1" ? "Point! Next serve…" : "CPU scores");

    serveTimer = window.setTimeout(() => {
      if (!running || paused) return;
      setPrompt("");
      game.serve(servingPlayer);
    }, GAME.SERVE_DELAY_MS);
  });

  // ── Hand input ───────────────────────────────────────────────────────────
  const handSub = ctx.hands.subscribe((frame: HandFrame) => {
    const paddle = hands.processFrame(frame);
    game.setPlayer1Paddle(paddle);
    if (!started || paused) return;
    if (!paddle.isActive && !game.getBallState().isInPlay) {
      setPrompt("Show your open palm to acquire");
    } else if (paddle.isActive && !game.getBallState().isInPlay && serveTimer === null) {
      // Auto-serve once the hand is acquired and no serve is queued.
      setPrompt("");
      game.serve(servingPlayer);
    }
  });

  // ── Resize ───────────────────────────────────────────────────────────────
  const ro = new ResizeObserver(() => {
    game.syncViewport();
  });
  ro.observe(el);
  game.syncViewport();

  // ── Unified frame loop ───────────────────────────────────────────────────
  // One RAF runs AI + score broadcast; PongGame's internal `setAnimationLoop`
  // continues to drive physics + rendering. Score emits are event-driven (only
  // on change), so this loop is just: AI tick → local-score diff → broadcast.
  function tick(): void {
    if (!running) return;
    rafId = requestAnimationFrame(tick);
    if (paused) {
      lastTickTime = 0;
      return;
    }
    const now = performance.now();
    const dt = lastTickTime === 0 ? 0 : Math.min(0.1, (now - lastTickTime) / 1000);
    lastTickTime = now;

    const aiPaddle = ai.update(game.getBallState(), dt);
    game.setPlayer2Paddle(aiPaddle);

    if (p1Points !== lastScoreBroadcast) {
      ctx.emitScore({ playerId: ctx.localPlayerId, raw: p1Points });
      if (ctx.net) void ctx.net.set(`score_${ctx.localPlayerId}`, p1Points);
      lastScoreBroadcast = p1Points;
    }
  }

  const roundEndUnsub = ctx.onRoundEnd((final: FinalScore) => {
    void final;
  });

  return {
    start() {
      started = true;
      lastTickTime = 0;
      game.start();
      setPrompt("Show your open palm to acquire");
      rafId = requestAnimationFrame(tick);
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
      lastTickTime = 0;
    },
    destroy() {
      running = false;
      started = false;
      cancelAnimationFrame(rafId);
      if (serveTimer !== null) window.clearTimeout(serveTimer);
      handSub();
      roundEndUnsub();
      for (const u of netSubs) u();
      ro.disconnect();
      game.dispose();
      canvas.remove();
      hud.remove();
      prompt.remove();
    },
  };
}

const ponghubModule: GameModule = {
  manifest,
  mount,
};

export default ponghubModule;
export { manifest, ponghubModule as module };

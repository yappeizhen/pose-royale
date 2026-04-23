/**
 * Frootninja GameModule entry point. Vendored from yappeizhen/frootninja:
 *   - 3D fruit & slice effects → FruitGame (Three.js)
 *   - Slice detection from index-finger motion → GestureController
 *   - Neon dual-colored laser trail → renderTrail() on a 2D overlay canvas
 *
 * Local raw score = successful slices minus bombs hit (1 point each). par = 40, so
 * landing ~40 net slices in a 30 s round caps to 1000 tournament points. In 2P matches
 * we mirror raw score via ctx.net and broadcast each slice so the opponent's view
 * plays the same splash on the matching fruit.
 */

import type {
  FinalScore,
  GameContext,
  GameInstance,
  GameModule,
  HandFrame,
  Unsub,
} from "@pose-royale/sdk";
import { FruitGame, type GestureEvent } from "./FruitGame.js";
import { GestureController } from "./GestureController.js";
import { manifest } from "./manifest.js";

interface TrailEntry {
  id: string;
  createdAt: number;
  start: { x: number; y: number };
  end: { x: number; y: number };
  glowColor: string;
  width: number;
}

const TRAIL_LIFESPAN_MS = 300;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function mount(el: HTMLElement, ctx: GameContext): GameInstance {
  // ── DOM scaffolding ───────────────────────────────────────────────────────
  // GameStage mounts us into a `position:absolute; inset:0` host (via the
  // .stage-host class). Only force `position:relative` if the host is still
  // `static` — clobbering it otherwise would collapse the host to height:0
  // (all our children are absolute) and FruitGame.handleResize would no-op.
  if (getComputedStyle(el).position === "static") {
    el.style.position = "relative";
  }
  el.style.overflow = "hidden";

  // Three.js fruit canvas (fills host). NOT mirrored — the webcam background is
  // the only mirrored layer. Gesture origin.x is already flipped below (1 - raw.x)
  // so the fingertip's screen coord matches where the player sees their hand.
  const fruitCanvas = document.createElement("canvas");
  fruitCanvas.style.position = "absolute";
  fruitCanvas.style.inset = "0";
  fruitCanvas.style.width = "100%";
  fruitCanvas.style.height = "100%";
  fruitCanvas.style.display = "block";
  el.appendChild(fruitCanvas);

  // 2D overlay canvas for the neon laser trail.
  const trailCanvas = document.createElement("canvas");
  trailCanvas.style.position = "absolute";
  trailCanvas.style.inset = "0";
  trailCanvas.style.width = "100%";
  trailCanvas.style.height = "100%";
  trailCanvas.style.pointerEvents = "none";
  el.appendChild(trailCanvas);
  const trailCtx = trailCanvas.getContext("2d");
  if (!trailCtx) throw new Error("frootninja: 2D canvas context unavailable for trail");

  // HUD — score / bombs / opponent score.
  const hud = document.createElement("div");
  hud.style.cssText = [
    "position:absolute",
    "top:72px", // below the orchestrator header
    "left:16px",
    "right:16px",
    "display:flex",
    "justify-content:space-between",
    "align-items:flex-start",
    "gap:12px",
    "pointer-events:none",
    "font-family:var(--font-display, system-ui, sans-serif)",
    "color:white",
    "text-shadow:0 2px 8px rgba(0,0,0,0.6)",
    "z-index:3",
  ].join(";");
  el.appendChild(hud);

  const scoreBadge = document.createElement("div");
  scoreBadge.style.cssText = [
    "padding:8px 16px",
    "border-radius:14px",
    "background:rgba(0,0,0,0.45)",
    "backdrop-filter:blur(6px)",
    "font-size:1.5rem",
    "font-weight:700",
    "display:flex",
    "gap:14px",
    "align-items:center",
  ].join(";");
  hud.appendChild(scoreBadge);

  const oppBadge = document.createElement("div");
  oppBadge.style.cssText = scoreBadge.style.cssText;
  oppBadge.style.opacity = "0.85";
  hud.appendChild(oppBadge);

  // Bomb hit flash overlay.
  const bombFlash = document.createElement("div");
  bombFlash.style.cssText = [
    "position:absolute",
    "inset:0",
    "pointer-events:none",
    "background:radial-gradient(circle at center, rgba(255,68,0,0.55) 0%, rgba(255,0,0,0.35) 50%, transparent 100%)",
    "opacity:0",
    "transition:opacity 160ms ease-out",
    "z-index:5",
  ].join(";");
  el.appendChild(bombFlash);

  // ── Game engine + gesture detector ────────────────────────────────────────
  const game = new FruitGame(fruitCanvas, ctx.rng);
  const gestures = new GestureController();

  // ── Multiplayer plumbing ──────────────────────────────────────────────────
  const remoteId = ctx.players.find((p) => !p.isLocal)?.id;
  let remoteRaw = 0;
  const netSubs: Unsub[] = [];

  if (ctx.net && remoteId) {
    netSubs.push(
      ctx.net.subscribe<number>(`score_${remoteId}`, (value) => {
        if (typeof value === "number" && Number.isFinite(value)) {
          remoteRaw = value;
          // Emit only when the opponent's score actually changes. Avoids a 60 Hz
          // stream of redundant score events into the SDK's emit pipeline.
          ctx.emitScore({ playerId: remoteId, raw: remoteRaw });
        }
      }),
    );
    // When the opponent slices a fruit, we replay the effect on our deterministic copy.
    netSubs.push(
      ctx.net.subscribe<{ fruitId: string; x: number; y: number; at: number }>(
        `slice_${remoteId}`,
        (slice) => {
          if (!slice) return;
          game.triggerSliceEffectById(slice.fruitId, slice.x, slice.y);
        },
      ),
    );
  }

  // ── Score state ───────────────────────────────────────────────────────────
  let slices = 0;
  let bombs = 0;
  let lastScoreBroadcast = -1;
  const raw = () => Math.max(0, slices - bombs);

  // ── Gesture → slice pipeline ──────────────────────────────────────────────
  const trails: TrailEntry[] = [];
  let lastTrailId: string | undefined;

  const handSub = ctx.hands.subscribe((frame: HandFrame) => {
    const events = gestures.processFrame(frame);
    for (const raw of events) {
      // MediaPipe returns landmarks in raw (un-mirrored) camera space. The webcam
      // background is displayed mirrored so the user sees themselves naturally, so
      // we flip x once here to convert into on-screen (display) coordinates that
      // the game canvas also uses.
      const event: GestureEvent = {
        ...raw,
        origin: { ...raw.origin, x: 1 - raw.origin.x },
        direction: { x: -raw.direction.x, y: raw.direction.y },
      };

      // Push neon trail.
      pushTrail(event);

      // Ask the engine to attempt a hit.
      const result = game.handleGesture(event);
      if (!result) continue;
      if (result.isBomb) {
        bombs += 1;
        flashBomb();
      } else {
        slices += 1;
      }
      if (ctx.net) {
        void ctx.net.set(`slice_${ctx.localPlayerId}`, {
          fruitId: result.fruitId,
          x: event.origin.x,
          y: event.origin.y,
          at: Date.now(),
        });
      }
    }
  });

  function pushTrail(event: GestureEvent) {
    if (event.id === lastTrailId) return;
    lastTrailId = event.id;
    const glowColor = event.hand === "Left" ? "#00ffff" : "#bf00ff";
    const length = 0.25 + event.strength * 0.4;
    trails.push({
      id: event.id,
      createdAt: performance.now(),
      start: { x: clamp01(event.origin.x), y: clamp01(event.origin.y) },
      end: {
        x: clamp01(event.origin.x + event.direction.x * length),
        y: clamp01(event.origin.y + event.direction.y * length),
      },
      glowColor,
      width: 12 + event.strength * 8,
    });
  }

  function flashBomb() {
    bombFlash.style.opacity = "1";
    window.setTimeout(() => {
      bombFlash.style.opacity = "0";
    }, 160);
  }

  // ── Resize wiring ─────────────────────────────────────────────────────────
  function resize() {
    const rect = el.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    trailCanvas.width = Math.max(1, Math.floor(rect.width * dpr));
    trailCanvas.height = Math.max(1, Math.floor(rect.height * dpr));
    game.syncViewport();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(el);
  resize();

  // ── Render loop for the trail overlay + HUD + score broadcasting ──────────
  let running = true;
  let paused = false;
  let rafId = 0;

  function renderFrame() {
    if (!running) return;
    rafId = requestAnimationFrame(renderFrame);
    if (paused) return;
    drawTrails();
    drawHud();

    const r = raw();
    if (r !== lastScoreBroadcast) {
      ctx.emitScore({ playerId: ctx.localPlayerId, raw: r });
      if (ctx.net) void ctx.net.set(`score_${ctx.localPlayerId}`, r);
      lastScoreBroadcast = r;
    }
  }

  function drawTrails() {
    const canvas = trailCanvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    trailCtx!.clearRect(0, 0, canvas.width, canvas.height);
    const now = performance.now();
    for (let i = trails.length - 1; i >= 0; i--) {
      const t = trails[i]!;
      const age = now - t.createdAt;
      const progress = age / TRAIL_LIFESPAN_MS;
      if (progress >= 1) {
        trails.splice(i, 1);
        continue;
      }
      const alpha = 1 - Math.pow(progress, 0.5);
      const lw = t.width * dpr * (1 - progress);
      trailCtx!.save();
      trailCtx!.globalAlpha = alpha;
      trailCtx!.lineCap = "butt";
      trailCtx!.lineJoin = "miter";
      trailCtx!.shadowBlur = 25 * dpr;
      trailCtx!.shadowColor = t.glowColor;
      trailCtx!.strokeStyle = t.glowColor;
      trailCtx!.lineWidth = lw;
      trailCtx!.beginPath();
      trailCtx!.moveTo(t.start.x * canvas.width, t.start.y * canvas.height);
      trailCtx!.lineTo(t.end.x * canvas.width, t.end.y * canvas.height);
      trailCtx!.stroke();
      trailCtx!.shadowBlur = 5 * dpr;
      trailCtx!.shadowColor = "#ffffff";
      trailCtx!.lineWidth = lw * 0.3;
      trailCtx!.strokeStyle = "#ffffff";
      trailCtx!.stroke();
      trailCtx!.restore();
    }
  }

  function drawHud() {
    scoreBadge.textContent = `🍉 ${slices}  💣 ${bombs}`;
    if (remoteId) {
      oppBadge.textContent = `OPP ${remoteRaw}`;
      oppBadge.style.display = "";
    } else {
      oppBadge.style.display = "none";
    }
  }

  const roundEndUnsub = ctx.onRoundEnd((final: FinalScore) => {
    // Orchestrator owns aggregation & the final screen. This hook is where we'd trigger
    // a celebration particle burst in a future polish pass.
    void final;
  });

  return {
    start() {
      game.start();
      rafId = requestAnimationFrame(renderFrame);
    },
    pause() {
      paused = true;
      game.stop();
    },
    resume() {
      paused = false;
      game.start();
    },
    destroy() {
      running = false;
      cancelAnimationFrame(rafId);
      handSub();
      roundEndUnsub();
      for (const u of netSubs) u();
      ro.disconnect();
      game.dispose();
      gestures.reset();
      while (el.firstChild) el.removeChild(el.firstChild);
    },
  };
}

const frootninjaModule: GameModule = {
  manifest,
  mount,
};

export default frootninjaModule;
export { manifest, frootninjaModule as module };

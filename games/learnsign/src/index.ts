/**
 * LearnSign GameModule entry point.
 *
 * Gameplay: a target ASL letter appears. The player shapes their hand into that
 * letter in front of the webcam. After holding the correct shape for `HOLD_DURATION_MS`
 * it locks in, scores +1, and a new target letter appears. Raw score = letters landed
 * in 30 s; par = 12 → normalizes to 1000 tournament points at plan §1 §score.
 *
 * Inspired by ngzhili/LearnSign (https://github.com/ngzhili/LearnSign). Pass 1.5 ships
 * with a hand-landmark heuristic across all 24 static letters; Pass 2 drops in a
 * learned landmark classifier via `createSignDetector({ backend: "landmark" })`.
 * See `TRAINING.md` for how to train + deploy the model.
 */

import type {
  FinalScore,
  GameContext,
  GameInstance,
  GameModule,
  HandFrame,
  Landmark,
  TrackedHand,
  Unsub,
} from "@pose-royale/sdk";
import { ALPHABET, LETTER_BY_ID } from "./letters.js";
import {
  createSignDetector,
  HOLD_DURATION_MS,
  type CreateSignDetectorOptions,
  type ISignDetector,
} from "./detectors/index.js";
import { manifest } from "./manifest.js";

/**
 * Bounding-box visualisation state. Tracked separately from the detector's prediction
 * so the render loop (rAF) can redraw smoothly even when `handSub` happens to fire at
 * a slightly slower cadence than the display refresh — last-known box persists until
 * the next frame tells us otherwise.
 */
interface BoxSnapshot {
  /** 0..1 bounding box in mirrored display coords (already x-flipped). */
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** Label to render above the box. Empty string hides the label. */
  label: string;
  /** Visual state — drives the box's fill + border color. */
  state: "idle" | "wrong" | "matching";
  /** 0..1 hold progress; only meaningful when `state === "matching"`. */
  progress: number;
}

function mount(el: HTMLElement, ctx: GameContext): GameInstance {
  // ── DOM scaffolding ─────────────────────────────────────────────────────────
  // GameStage mounts games into a `position:absolute; inset:0` host. Only force
  // `position:relative` if the host is still `static` — clobbering it otherwise
  // would collapse the host to height:0 (children are absolute).
  if (getComputedStyle(el).position === "static") {
    el.style.position = "relative";
  }
  el.style.overflow = "hidden";
  el.style.pointerEvents = "none";

  // ── Bounding-box overlay canvas ─────────────────────────────────────────────
  // Sits above the webcam, below the HUD/prompt. We draw a comic-pop rectangle
  // around each detected hand with a label pill above it: "?", "Seeing: V",
  // "Locking A…" etc. Colour shifts based on state so the user gets live feedback
  // on what the detector thinks they're signing.
  const boxCanvas = document.createElement("canvas");
  boxCanvas.style.cssText = [
    "position:absolute",
    "inset:0",
    "width:100%",
    "height:100%",
    "pointer-events:none",
    "z-index:2",
  ].join(";");
  el.appendChild(boxCanvas);
  const boxCtx = boxCanvas.getContext("2d");
  if (!boxCtx) throw new Error("learnsign: 2D canvas context unavailable");

  // ── Target letter card (pinned to the left side so the webcam centre stays clear) ─
  // Moved off-centre because the bounding-box overlay is the main visual focus —
  // the prompt is reference material that stays within peripheral vision. Anchored
  // at left:24px with translateY(-50%) so it vertically centers regardless of the
  // host's aspect ratio.
  const card = document.createElement("div");
  card.style.cssText = [
    "position:absolute",
    "top:50%",
    "left:calc(24px + env(safe-area-inset-left, 0px))",
    "transform:translateY(-50%) rotate(-2deg)",
    "display:flex",
    "flex-direction:column",
    "align-items:center",
    "gap:12px",
    "padding:20px 28px 22px",
    "min-width:220px",
    "max-width:260px",
    "background:var(--color-card, #fff)",
    "border:4px solid var(--color-border, #2D1F3D)",
    "border-radius:18px",
    "box-shadow:var(--shadow-lg, 8px 8px 0 #2D1F3D)",
    "font-family:var(--font-display, 'Nunito', system-ui, sans-serif)",
    "color:var(--color-fg, #2D1F3D)",
    "z-index:3",
    "transition:transform 180ms ease-out, background 180ms ease-out",
    "pointer-events:none",
  ].join(";");
  el.appendChild(card);

  // "SIGN THIS →" eyebrow so the card reads as a prompt rather than a score badge.
  const eyebrow = document.createElement("div");
  eyebrow.style.cssText = [
    "font-size:0.75rem",
    "font-weight:900",
    "letter-spacing:0.12em",
    "text-transform:uppercase",
    "color:var(--color-fg-muted, #5A4B6E)",
  ].join(";");
  eyebrow.textContent = "Sign this →";
  card.appendChild(eyebrow);

  // Big letter glyph — readable from across the room. Scaled down from the old
  // centred card since we're on the side now.
  //
  // `line-height:1` + explicit top/bottom padding: Nunito's Q/J have long
  // descenders that escape a tight-line-height box and collide with the
  // eyebrow/hint underneath. Using a full em-box and padding gives the drop
  // shadow + descender room to breathe without inflating the card on letters
  // that don't need it (overflow is clipped by the card's flex layout anyway).
  const glyph = document.createElement("div");
  glyph.style.cssText = [
    "font-size:clamp(80px, 12vw, 140px)",
    "line-height:1",
    "font-weight:900",
    "letter-spacing:-0.04em",
    "padding:0.05em 0.08em 0.18em",
    "color:var(--color-primary, #7A4AFF)",
    "text-shadow:4px 4px 0 var(--color-border, #2D1F3D)",
  ].join(";");
  card.appendChild(glyph);

  // Short hint for how to form the sign. Widened to 22ch (from 18ch) so the
  // self-contained descriptions in letters.ts wrap to 2 tidy lines instead of 3.
  const hint = document.createElement("div");
  hint.style.cssText = [
    "font-size:0.95rem",
    "font-weight:700",
    "text-align:center",
    "max-width:22ch",
    "line-height:1.3",
    "color:var(--color-fg-muted, #5A4B6E)",
  ].join(";");
  card.appendChild(hint);

  // Hold-progress bar underneath the hint. Fills left→right as the user holds the
  // correct shape; empties instantly if they drop the pose.
  const progressTrack = document.createElement("div");
  progressTrack.style.cssText = [
    "position:relative",
    "width:180px",
    "height:12px",
    "background:rgba(45,31,61,0.12)",
    "border:2px solid var(--color-border, #2D1F3D)",
    "border-radius:999px",
    "overflow:hidden",
  ].join(";");
  card.appendChild(progressTrack);

  const progressFill = document.createElement("div");
  progressFill.style.cssText = [
    "position:absolute",
    "top:0",
    "left:0",
    "bottom:0",
    "width:0%",
    "background:linear-gradient(90deg, var(--color-primary, #7A4AFF), var(--color-secondary, #FF7AB8))",
    "transition:width 80ms linear, opacity 200ms ease",
  ].join(";");
  progressTrack.appendChild(progressFill);

  // Skip button — gives players an escape hatch when the detector misfires on a
  // sign they're not confident in (or when the heuristic can't reliably pick their
  // particular hand shape). No score penalty, but a short cooldown stops mashing
  // from skipping the entire queue instantly and re-enables the button visibly
  // enough that players don't hammer on a dead button.
  const skipBtn = document.createElement("button");
  skipBtn.type = "button";
  skipBtn.textContent = "⏭ Skip";
  skipBtn.style.cssText = [
    "margin-top:4px",
    "padding:8px 16px",
    "font-family:var(--font-display, 'Nunito', system-ui, sans-serif)",
    "font-size:0.9rem",
    "font-weight:900",
    "letter-spacing:0.05em",
    "text-transform:uppercase",
    "color:var(--color-fg, #2D1F3D)",
    "background:var(--color-card, #fff)",
    "border:3px solid var(--color-border, #2D1F3D)",
    "border-radius:12px",
    "box-shadow:var(--shadow-sm, 4px 4px 0 #2D1F3D)",
    "cursor:pointer",
    // Host has pointer-events:none for the webcam passthrough; opt the button back in.
    "pointer-events:auto",
    "transition:transform 120ms ease, box-shadow 120ms ease, opacity 180ms ease",
  ].join(";");
  skipBtn.addEventListener("mousedown", () => {
    skipBtn.style.transform = "translate(2px,2px)";
    skipBtn.style.boxShadow = "2px 2px 0 var(--color-border, #2D1F3D)";
  });
  const resetSkipBtnPress = () => {
    skipBtn.style.transform = "";
    skipBtn.style.boxShadow = "var(--shadow-sm, 4px 4px 0 #2D1F3D)";
  };
  skipBtn.addEventListener("mouseup", resetSkipBtnPress);
  skipBtn.addEventListener("mouseleave", resetSkipBtnPress);
  skipBtn.addEventListener("click", () => {
    skipCurrent();
  });
  card.appendChild(skipBtn);

  // ── HUD (score + opponent badge) ────────────────────────────────────────────
  const hud = document.createElement("div");
  hud.style.cssText = [
    "position:absolute",
    "top:72px",
    "left:16px",
    "right:16px",
    "display:flex",
    "justify-content:space-between",
    "align-items:flex-start",
    "gap:16px",
    "pointer-events:none",
    "font-family:var(--font-display, 'Nunito', system-ui, sans-serif)",
    "color:var(--color-fg, #2D1F3D)",
    "z-index:3",
  ].join(";");
  el.appendChild(hud);

  const badgeBase = [
    "padding:10px 18px",
    "background:var(--color-card, #fff)",
    "color:var(--color-fg, #2D1F3D)",
    "border:4px solid var(--color-border, #2D1F3D)",
    "border-radius:14px",
    "box-shadow:var(--shadow-sm, 4px 4px 0 #2D1F3D)",
    "font-size:1.5rem",
    "font-weight:900",
    "display:flex",
    "gap:14px",
    "align-items:center",
    "letter-spacing:0.01em",
  ].join(";");

  const scoreBadge = document.createElement("div");
  scoreBadge.style.cssText = `${badgeBase};transform:rotate(-2deg)`;
  hud.appendChild(scoreBadge);

  const oppBadge = document.createElement("div");
  oppBadge.style.cssText = `${badgeBase};transform:rotate(2deg);background:var(--color-secondary, #FF7AB8);color:var(--color-secondary-fg, #fff)`;
  hud.appendChild(oppBadge);

  // ── Detector + game state ───────────────────────────────────────────────────
  // Backend is resolved at mount() time, not baked in:
  //   - default                             → `image` (shipped SSD model,
  //     ~12 MB download, no training needed)
  //   - `VITE_LEARNSIGN_BACKEND=landmark`   → use a trained landmark MLP
  //     (needs TRAINING.md, ~20 KB download)
  //   - `VITE_LEARNSIGN_BACKEND=heuristic`  → hand-crafted heuristic
  //     (offline, zero download, most lenient)
  // The returned object satisfies `ISignDetector`; the rest of `mount()` is
  // deliberately backend-agnostic so we can A/B all three at runtime.
  const videoSource = ctx.hands.videoSource;
  const detectorOpts: CreateSignDetectorOptions = {
    landmark: {
      modelUrl:
        readViteEnv("VITE_LEARNSIGN_MODEL_URL") ??
        "/models/learnsign/sign-classifier/model.json",
    },
  };
  if (videoSource) {
    detectorOpts.image = {
      video: videoSource,
      modelUrl:
        readViteEnv("VITE_LEARNSIGN_IMAGE_MODEL_URL") ??
        "/models/learnsign/model.json",
    };
  }
  const detector: ISignDetector = createSignDetector(detectorOpts);
  const activeBackend = resolveActiveBackend(detector, detectorOpts);

  // ── Warmup / preload gate ───────────────────────────────────────────────────
  // Trigger any async model loading NOW, not lazily on first `update()`. The
  // overlay below blocks the playfield until the detector is ready so the
  // round timer doesn't tick on an unloaded model. Heuristic detectors don't
  // implement preload(), so this resolves immediately for them.
  //
  // We also expose this promise on the returned GameInstance as `ready`, which
  // the tournament orchestrator respects to freeze the 30-second round clock
  // until the detector is warm — players shouldn't lose seconds on the first-
  // run SSD download.
  let detectorReady = detector.preload === undefined;
  let detectorLoadError: Error | null = null;
  const preloadPromise = detector.preload?.();
  // Always hand the orchestrator a promise that *resolves* (never rejects),
  // because game UI has already handled the failure case below via the error
  // overlay. Rejection would only mean "start the round anyway", which is
  // exactly what a resolved promise also does — so normalise.
  const readyForOrchestrator: Promise<void> = preloadPromise
    ? preloadPromise.then(
        () => undefined,
        () => undefined,
      )
    : Promise.resolve();

  // ── Backend status chip (bottom-left, dev-only) ─────────────────────────────
  // Hidden in prod — the "YOU"/opponent tournament badges live in the same
  // corners and we don't want player-facing UI explaining CV internals. In
  // dev, this is the fast way to confirm which detector is actually running
  // when something looks off.
  const backendBanner = document.createElement("div");
  backendBanner.style.cssText = [
    "position:absolute",
    "bottom:12px",
    "left:12px",
    "padding:4px 10px",
    "font-family:var(--font-mono, ui-monospace, 'SFMono-Regular', monospace)",
    "font-size:0.65rem",
    "font-weight:700",
    "letter-spacing:0.04em",
    "text-transform:uppercase",
    "color:var(--color-fg, #2D1F3D)",
    "background:var(--color-card, #fff)",
    "border:2px solid var(--color-border, #2D1F3D)",
    "border-radius:8px",
    "box-shadow:var(--shadow-sm, 2px 2px 0 #2D1F3D)",
    "pointer-events:none",
    "z-index:4",
    "opacity:0.75",
    isDevBuild() ? "" : "display:none",
  ].filter(Boolean).join(";");
  backendBanner.textContent = formatBackendLabel(activeBackend, "loading");
  el.appendChild(backendBanner);

  // ── Loading overlay (shown until preload() resolves) ────────────────────────
  // A full-bleed scrim + a centered "warming up" card. For the heuristic
  // backend this never appears (detectorReady starts true). For image/landmark
  // backends this covers the playfield for however long the model download +
  // TF.js warmup takes — typically <1s for a cached local install, up to ~5s
  // for a first-time CDN fetch.
  const loadingOverlay = document.createElement("div");
  loadingOverlay.style.cssText = [
    "position:absolute",
    "inset:0",
    "display:flex",
    "flex-direction:column",
    "align-items:center",
    "justify-content:center",
    "gap:16px",
    "background:rgba(45,31,61,0.55)",
    "backdrop-filter:blur(6px)",
    "-webkit-backdrop-filter:blur(6px)",
    "font-family:var(--font-display, 'Nunito', system-ui, sans-serif)",
    "color:#fff",
    "z-index:5",
    "pointer-events:all",
    "transition:opacity 220ms ease",
    "opacity:1",
  ].join(";");

  const loadingCard = document.createElement("div");
  loadingCard.style.cssText = [
    "padding:20px 28px",
    "background:var(--color-card, #fff)",
    "color:var(--color-fg, #2D1F3D)",
    "border:4px solid var(--color-border, #2D1F3D)",
    "border-radius:16px",
    "box-shadow:var(--shadow-md, 6px 6px 0 #2D1F3D)",
    "text-align:center",
    "max-width:320px",
    "transform:rotate(-1.5deg)",
  ].join(";");
  const loadingTitle = document.createElement("div");
  loadingTitle.style.cssText =
    "font-size:1.05rem;font-weight:900;letter-spacing:0.04em;text-transform:uppercase;margin-bottom:6px";
  loadingTitle.textContent = "Warming up the detector…";
  const loadingDetail = document.createElement("div");
  loadingDetail.style.cssText =
    "font-size:0.85rem;font-weight:600;color:var(--color-fg-muted, #5A4B6E);line-height:1.4";
  loadingDetail.textContent =
    activeBackend === "image"
      ? "Fetching the LearnSign model (first run only)"
      : activeBackend === "landmark"
        ? "Loading the landmark classifier"
        : "Preparing the detector";
  loadingCard.appendChild(loadingTitle);
  loadingCard.appendChild(loadingDetail);
  loadingOverlay.appendChild(loadingCard);
  if (!detectorReady) el.appendChild(loadingOverlay);

  if (preloadPromise) {
    preloadPromise
      .then(() => {
        detectorReady = true;
        // Fade out, then remove — a hard pop looks janky when the model
        // arrives mid-countdown.
        loadingOverlay.style.opacity = "0";
        window.setTimeout(() => {
          loadingOverlay.parentNode?.removeChild(loadingOverlay);
        }, 240);
      })
      .catch((err: unknown) => {
        detectorLoadError = err instanceof Error ? err : new Error(String(err));
        // Convert the overlay into an error state so the player isn't stuck
        // staring at a "warming up…" message forever. The game will still
        // play with whatever the detector gate allows (likely nothing for a
        // failed image backend) — but at least the UI tells them why.
        loadingTitle.textContent = "Detector unavailable";
        loadingCard.style.background = "var(--color-danger, #ff3355)";
        loadingCard.style.color = "#fff";
        loadingCard.style.borderColor = "#2D1F3D";
        loadingDetail.style.color = "rgba(255,255,255,0.9)";
        loadingDetail.textContent =
          detectorLoadError.message.length < 160
            ? detectorLoadError.message
            : "Check the browser console for details.";
        // Dismiss on click so the player can still see the stage.
        loadingOverlay.style.cursor = "pointer";
        loadingOverlay.addEventListener(
          "click",
          () => {
            loadingOverlay.style.opacity = "0";
            window.setTimeout(() => {
              loadingOverlay.parentNode?.removeChild(loadingOverlay);
            }, 240);
          },
          { once: true },
        );
      });
  }

  // Poll the ImageSignDetector's status so the banner reflects load success /
  // failure. The detector's load is async + fire-and-forget; we just watch for
  // the state transition. Lightweight — clears itself once terminal.
  let backendPollId: number | null = null;
  const maybeDetectorWithStatus = detector as unknown as {
    getStatus?: () => { state: "loading" | "ready" | "failed"; error?: Error };
  };
  if (typeof maybeDetectorWithStatus.getStatus === "function") {
    const pollStatus = () => {
      const status = maybeDetectorWithStatus.getStatus!();
      backendBanner.textContent = formatBackendLabel(activeBackend, status.state);
      if (status.state === "failed") {
        backendBanner.style.background = "var(--color-danger, #ff3355)";
        backendBanner.style.color = "#fff";
        backendBanner.title = status.error?.message ?? "detector failed to load";
        console.error("[learnsign] active detector failed to load", status.error);
      } else if (status.state === "ready") {
        backendBanner.style.background = "var(--color-success, #4ade80)";
      }
      if (status.state === "loading") {
        backendPollId = window.setTimeout(pollStatus, 250);
      } else {
        backendPollId = null;
      }
    };
    pollStatus();
  } else {
    // Heuristic / landmark backends don't expose status — assume ready.
    backendBanner.textContent = formatBackendLabel(activeBackend, "ready");
    backendBanner.style.background = "var(--color-success, #4ade80)";
  }

  // Deterministic letter queue — seeded from `ctx.rng` so both peers see the same
  // sequence. We pre-build a long rotation (shuffled, no consecutive repeats) and
  // walk through it; each round's RNG is already seeded from the room so peers
  // don't need any handshake.
  const letterQueue = buildLetterQueue(ctx.rng);
  let queueIdx = 0;
  const nextTarget = () => letterQueue[queueIdx++ % letterQueue.length]!.id;
  let targetLetter = nextTarget();

  let score = 0;
  let lastScoreBroadcast = -1;

  // ── Multiplayer plumbing (mirrors frootninja/ponghub) ───────────────────────
  const remoteId = ctx.players.find((p) => !p.isLocal)?.id;
  let remoteRaw = 0;
  const netSubs: Unsub[] = [];

  if (ctx.net && remoteId) {
    netSubs.push(
      ctx.net.subscribe<number>(`score_${remoteId}`, (value) => {
        if (typeof value === "number" && Number.isFinite(value)) {
          remoteRaw = value;
          ctx.emitScore({ playerId: remoteId, raw: remoteRaw });
        }
      }),
    );
  }

  // ── Canvas sizing (DPR-aware) ───────────────────────────────────────────────
  function resizeCanvas() {
    const rect = el.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    boxCanvas.width = Math.max(1, Math.floor(rect.width * dpr));
    boxCanvas.height = Math.max(1, Math.floor(rect.height * dpr));
  }
  const ro = new ResizeObserver(resizeCanvas);
  ro.observe(el);
  resizeCanvas();

  // Latest snapshots from the prediction pipeline — drawn from the rAF loop so box
  // rendering runs at display rate rather than hand-tracker rate (typically ~30Hz),
  // which keeps the overlay from flickering when MP skips a frame.
  let latestBoxes: BoxSnapshot[] = [];

  // ── Prediction pipeline ─────────────────────────────────────────────────────
  const handSub = ctx.hands.subscribe((frame: HandFrame) => {
    const prediction = detector.update(frame);

    // Build the bbox for every tracked hand. The *primary* hand (index 0, highest
    // score) drives the prediction label; any secondary hand gets a neutral "?"
    // box so the player still sees that it was detected but isn't the one counted.
    const boxes: BoxSnapshot[] = [];
    for (let i = 0; i < frame.hands.length; i++) {
      const hand = frame.hands[i]!;
      const rect = computeMirroredBbox(hand);
      if (!rect) continue;
      if (i === 0) {
        const { label, state } = labelFor(prediction.letter, targetLetter);
        const progress =
          state === "matching" ? Math.min(1, prediction.heldMs / HOLD_DURATION_MS) : 0;
        boxes.push({ ...rect, label, state, progress });
      } else {
        boxes.push({ ...rect, label: "?", state: "idle", progress: 0 });
      }
    }
    latestBoxes = boxes;

    // Fill bar on the prompt card mirrors the primary hand's hold progress — empty
    // when the wrong letter is showing so the player sees "no progress, tweak pose".
    if (prediction.letter === targetLetter) {
      const pct = Math.min(100, (prediction.heldMs / HOLD_DURATION_MS) * 100);
      progressFill.style.width = `${pct}%`;
      progressFill.style.opacity = "1";
    } else {
      progressFill.style.width = "0%";
      progressFill.style.opacity = "0.4";
    }

    // Lock check: if the hold completed, celebrate and advance.
    const locked = detector.consumeLock(targetLetter);
    if (locked) {
      score += 1;
      flashCorrect();
      advanceTarget();
    }
  });

  function advanceTarget(): void {
    targetLetter = nextTarget();
    renderTarget();
    progressFill.style.width = "0%";
    detector.reset();
  }

  // Skip the current target with a short cooldown so mashing the button doesn't
  // burn through the whole queue instantly. No score penalty — the heuristic
  // detector is flaky enough on certain hand shapes (fist vs. closed-ish hand vs.
  // partial occlusion) that "let me move on" needs to be frictionless.
  const SKIP_COOLDOWN_MS = 600;
  let skipReadyAt = 0;
  function skipCurrent(): void {
    if (!running || paused) return;
    const now = performance.now();
    if (now < skipReadyAt) return;
    skipReadyAt = now + SKIP_COOLDOWN_MS;
    // Disabled visual: dim + no pointer events until the cooldown elapses.
    skipBtn.style.opacity = "0.55";
    skipBtn.style.pointerEvents = "none";
    window.setTimeout(() => {
      skipBtn.style.opacity = "1";
      skipBtn.style.pointerEvents = "auto";
    }, SKIP_COOLDOWN_MS);
    advanceTarget();
  }

  // Keyboard shortcut — "S" triggers skip. Useful for two-player setups where the
  // player's hands are busy forming signs and they want to bail with the other hand
  // on the keyboard. Typed into an input? Let the input handle it (we check
  // target.tagName).
  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.key !== "s" && ev.key !== "S") return;
    const target = ev.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
    skipCurrent();
  };
  window.addEventListener("keydown", onKeyDown);

  function renderTarget(): void {
    const spec = LETTER_BY_ID[targetLetter];
    glyph.textContent = targetLetter;
    hint.textContent = spec?.hint ?? "";
  }

  // Brief green flash + scale pop on the card when a letter locks in. Playful
  // confirmation without stealing focus from the next target. The transform
  // preserves the `translateY(-50%)` anchor and `rotate(-2deg)` tilt.
  function flashCorrect(): void {
    card.style.transform = "translateY(-50%) rotate(-2deg) scale(1.06)";
    card.style.background = "var(--color-success, #69d66f)";
    window.setTimeout(() => {
      card.style.transform = "translateY(-50%) rotate(-2deg)";
      card.style.background = "var(--color-card, #fff)";
    }, 240);
  }

  function renderHud(): void {
    scoreBadge.textContent = `🤟 ${score}`;
    if (remoteId) {
      oppBadge.textContent = `OPP ${remoteRaw}`;
      oppBadge.style.display = "";
    } else {
      oppBadge.style.display = "none";
    }
  }

  // ── Render / broadcast loop ─────────────────────────────────────────────────
  let running = true;
  let paused = false;
  let rafId = 0;

  function renderFrame() {
    if (!running) return;
    rafId = requestAnimationFrame(renderFrame);
    if (paused) return;
    renderHud();
    drawBoxes();
    if (score !== lastScoreBroadcast) {
      ctx.emitScore({ playerId: ctx.localPlayerId, raw: score });
      if (ctx.net) void ctx.net.set(`score_${ctx.localPlayerId}`, score);
      lastScoreBroadcast = score;
    }
  }

  function drawBoxes(): void {
    const canvas = boxCanvas;
    const ctx2d = boxCtx!;
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    if (latestBoxes.length === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const box of latestBoxes) {
      drawBox(ctx2d, canvas.width, canvas.height, dpr, box);
    }
  }

  const roundEndUnsub = ctx.onRoundEnd((final: FinalScore) => {
    void final;
  });

  renderTarget();
  renderHud();

  return {
    ready: readyForOrchestrator,
    start() {
      rafId = requestAnimationFrame(renderFrame);
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
    },
    destroy() {
      running = false;
      cancelAnimationFrame(rafId);
      if (backendPollId !== null) window.clearTimeout(backendPollId);
      handSub();
      roundEndUnsub();
      for (const u of netSubs) u();
      ro.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      detector.reset();
      detector.dispose?.();
      // The overlay's outstanding fade-out timer can't reference a torn-down
      // DOM tree; we wipe everything in one shot here.
      while (el.firstChild) el.removeChild(el.firstChild);
    },
  };
}

/**
 * Read a Vite-injected env var without crashing under Vitest/Node where
 * `import.meta.env` may be undefined. Mirrors the helper in `detectors/index.ts`
 * so we don't leak a "`import.meta.env` missing" exception across package
 * boundaries.
 */
function readViteEnv(key: string): string | undefined {
  try {
    const env = (import.meta as { env?: Record<string, string | undefined> }).env;
    return env?.[key];
  } catch {
    return undefined;
  }
}

/**
 * `true` in `vite dev` / `vite preview`, `false` in production builds. Wrapped
 * in a try/catch for the same Node-test reason as `readViteEnv`.
 */
function isDevBuild(): boolean {
  try {
    const env = (import.meta as { env?: { DEV?: boolean } }).env;
    return env?.DEV === true;
  } catch {
    return false;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Bounding-box helpers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Derive a normalised 0..1 bounding box from the 21 hand landmarks. Already flipped
 * into mirrored display coordinates (x → 1 - x) since the webcam background is
 * rendered mirrored and that's what the user sees.
 */
function computeMirroredBbox(
  hand: TrackedHand,
): Pick<BoxSnapshot, "left" | "top" | "right" | "bottom"> | null {
  if (hand.landmarks.length < 21) return null;
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const lm of hand.landmarks as Landmark[]) {
    if (lm.x < minX) minX = lm.x;
    if (lm.y < minY) minY = lm.y;
    if (lm.x > maxX) maxX = lm.x;
    if (lm.y > maxY) maxY = lm.y;
  }
  // 6% horizontal and 8% vertical padding so the box doesn't kiss the fingertips.
  const padX = 0.06;
  const padY = 0.08;
  const paddedMinX = Math.max(0, minX - padX);
  const paddedMaxX = Math.min(1, maxX + padX);
  const paddedMinY = Math.max(0, minY - padY);
  const paddedMaxY = Math.min(1, maxY + padY);
  // Mirror: the right side of the raw frame (larger x) ends up on the left of the
  // mirrored display. So display.left comes from (1 - raw.right).
  return {
    left: 1 - paddedMaxX,
    top: paddedMinY,
    right: 1 - paddedMinX,
    bottom: paddedMaxY,
  };
}

function labelFor(
  detected: string | null,
  target: string,
): { label: string; state: "idle" | "wrong" | "matching" } {
  if (detected === null) return { label: "?", state: "idle" };
  if (detected === target) return { label: `${detected} ✓`, state: "matching" };
  return { label: detected, state: "wrong" };
}

/**
 * Comic-pop box: thick black border, tinted fill (transparent idle, amber wrong,
 * green matching), label pill above. When the state is "matching" we also paint a
 * progress stroke along the top edge so players can see the lock-in timer filling.
 */
function drawBox(
  ctx2d: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  dpr: number,
  box: BoxSnapshot,
): void {
  const x = box.left * canvasW;
  const y = box.top * canvasH;
  const w = (box.right - box.left) * canvasW;
  const h = (box.bottom - box.top) * canvasH;

  const borderWidth = 5 * dpr;
  const radius = 16 * dpr;

  const [fill, border] = colorsFor(box.state);

  ctx2d.save();
  ctx2d.fillStyle = fill;
  ctx2d.strokeStyle = border;
  ctx2d.lineWidth = borderWidth;
  ctx2d.lineJoin = "round";
  roundedRectPath(ctx2d, x, y, w, h, radius);
  ctx2d.fill();
  ctx2d.stroke();
  ctx2d.restore();

  // Progress stroke (matching state only) — draws along the top edge, left-to-right.
  if (box.state === "matching" && box.progress > 0) {
    ctx2d.save();
    ctx2d.strokeStyle = "#2D1F3D";
    ctx2d.lineCap = "round";
    ctx2d.lineWidth = 6 * dpr;
    const inset = radius + 2 * dpr;
    const usableW = Math.max(0, w - inset * 2);
    ctx2d.beginPath();
    ctx2d.moveTo(x + inset, y - 6 * dpr);
    ctx2d.lineTo(x + inset + usableW * box.progress, y - 6 * dpr);
    ctx2d.stroke();
    ctx2d.restore();
  }

  // Label pill above the box. Uses the system display font for consistency with
  // the rest of the comic-pop UI. Caps the label with a light padding so it never
  // dips below the box.
  if (box.label) {
    const fontPx = Math.max(18, Math.min(28, h * 0.16)) * dpr;
    ctx2d.save();
    ctx2d.font = `900 ${fontPx}px "Nunito", system-ui, sans-serif`;
    ctx2d.textBaseline = "alphabetic";
    const metrics = ctx2d.measureText(box.label);
    const padX = 14 * dpr;
    const padY = 8 * dpr;
    const pillW = metrics.width + padX * 2;
    const pillH = fontPx + padY * 2;
    const pillX = x;
    const pillY = Math.max(4 * dpr, y - pillH - 14 * dpr);
    ctx2d.fillStyle = "#ffffff";
    ctx2d.strokeStyle = "#2D1F3D";
    ctx2d.lineWidth = 4 * dpr;
    roundedRectPath(ctx2d, pillX, pillY, pillW, pillH, 12 * dpr);
    ctx2d.fill();
    ctx2d.stroke();
    ctx2d.fillStyle = "#2D1F3D";
    ctx2d.fillText(box.label, pillX + padX, pillY + pillH - padY - fontPx * 0.1);
    ctx2d.restore();
  }
}

function colorsFor(state: BoxSnapshot["state"]): readonly [string, string] {
  // [fill, border] — fills are mostly-transparent so the webcam + hand stay visible.
  switch (state) {
    case "matching":
      return ["rgba(105, 214, 111, 0.28)", "#2D1F3D"];
    case "wrong":
      return ["rgba(255, 217, 61, 0.28)", "#2D1F3D"];
    case "idle":
    default:
      return ["rgba(255, 255, 255, 0.18)", "#2D1F3D"];
  }
}

function roundedRectPath(
  ctx2d: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx2d.beginPath();
  ctx2d.moveTo(x + rr, y);
  ctx2d.lineTo(x + w - rr, y);
  ctx2d.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx2d.lineTo(x + w, y + h - rr);
  ctx2d.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx2d.lineTo(x + rr, y + h);
  ctx2d.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx2d.lineTo(x, y + rr);
  ctx2d.quadraticCurveTo(x, y, x + rr, y);
  ctx2d.closePath();
}

/**
 * Figure out which backend we actually got back from the factory so the UI
 * banner can tell the truth (the factory falls back to heuristic under a few
 * conditions — no video source, no model URL, etc.).
 */
function resolveActiveBackend(
  detector: ISignDetector,
  opts: CreateSignDetectorOptions,
): "heuristic" | "landmark" | "image" {
  // ImageSignDetector is the only one exposing `getStatus`. We use a structural
  // check rather than instanceof so bundler tree-shaking + monorepo duplication
  // can't trip us up.
  if (typeof (detector as { getStatus?: unknown }).getStatus === "function") {
    return "image";
  }
  const requested = opts.backend ?? readViteEnv("VITE_LEARNSIGN_BACKEND");
  if (requested === "landmark") return "landmark";
  return "heuristic";
}

function formatBackendLabel(
  backend: "heuristic" | "landmark" | "image",
  state: "loading" | "ready" | "failed",
): string {
  const name =
    backend === "image"
      ? "Image SSD"
      : backend === "landmark"
        ? "Landmark MLP"
        : "Heuristic";
  if (state === "failed") return `${name} · FAILED`;
  if (state === "loading") return `${name} · loading…`;
  return `${name} · ready`;
}

/**
 * Build a shuffled rotation of the static ASL alphabet (24 letters), avoiding
 * consecutive repeats. With `reps = 2` we get 48 letters per round — well beyond
 * what any player will chew through in 30s even with the skip button, while
 * still ensuring a fresh shuffle if the queue somehow loops.
 */
function buildLetterQueue(rng: () => number) {
  const reps = 2;
  const out: (typeof ALPHABET)[number][] = [];
  for (let i = 0; i < reps; i++) {
    const shuffled = [...ALPHABET];
    for (let j = shuffled.length - 1; j > 0; j--) {
      const k = Math.floor(rng() * (j + 1));
      [shuffled[j], shuffled[k]] = [shuffled[k]!, shuffled[j]!];
    }
    if (out.length > 0 && shuffled[0]!.id === out[out.length - 1]!.id && shuffled.length > 1) {
      [shuffled[0], shuffled[1]] = [shuffled[1]!, shuffled[0]!];
    }
    out.push(...shuffled);
  }
  return out;
}

const learnSignModule: GameModule = {
  manifest,
  mount,
};

export default learnSignModule;
export { manifest, learnSignModule as module };

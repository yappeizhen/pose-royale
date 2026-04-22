/**
 * @pose-royale/sdk — The Game contract.
 *
 * Every game in `games/*` exports a {@link GameModule}. The platform shell wraps it in a
 * {@link GameContext} that provides hand-tracking input, optional online sync, deterministic
 * randomness, scoring, and a round-end hook. Games never talk to the camera, Firebase, or the
 * tournament orchestrator directly.
 *
 * Rules (enforced by ESLint + leak tests — see plan §3):
 *   - No direct navigator.mediaDevices.getUserMedia — use ctx.hands.
 *   - No direct firebase/* imports — use ctx.net.
 *   - All randomness goes through ctx.rng.
 *   - Time logic uses deltaTime, not frame count.
 *   - destroy() must leave DOM, WebGL, RAF, and listeners clean.
 *   - emitScore auto-clamps [0,1] after dividing by manifest.par, drops NaN, ignores post-destroy.
 */

// ──────────────────────────────────────────────────────────────────────────────
// Players & sessions
// ──────────────────────────────────────────────────────────────────────────────

export interface Player {
  id: string;
  name: string;
  /** Themed HUD color. Orchestrator assigns one per player. */
  color: string;
  isLocal: boolean;
}

export type Unsub = () => void;

// ──────────────────────────────────────────────────────────────────────────────
// Hand tracking — the one bit of CV every current game shares
// ──────────────────────────────────────────────────────────────────────────────

export interface Landmark {
  /** 0..1 horizontal position in the source frame. */
  x: number;
  /** 0..1 vertical position in the source frame. */
  y: number;
  /** Depth relative to the wrist, in normalized units. */
  z: number;
}

export interface TrackedHand {
  handedness: "Left" | "Right";
  /** 0..1 detection confidence for this hand. */
  score: number;
  /** 21 points, MediaPipe ordering. */
  landmarks: Landmark[];
}

export interface HandFrame {
  /** `performance.now()` at the time the frame was produced. */
  timestamp: number;
  /** 0, 1, or 2 hands. Sorted by descending `score`. */
  hands: TrackedHand[];
}

export interface HandTrackerHandle {
  /** Latest completed detection. `null` until the tracker warms up. */
  readonly latest: HandFrame | null;
  /** 0..1 — confidence of the most recent detection (or 0 if no detection yet). */
  readonly confidence: number;
  /** True once the tracker has produced at least one frame. */
  readonly ready: boolean;
  /** Fires on every new frame. Returns an unsubscribe. */
  subscribe(cb: (frame: HandFrame) => void): Unsub;
}

// ──────────────────────────────────────────────────────────────────────────────
// Optional network channel — exposes just enough of the room to games
// ──────────────────────────────────────────────────────────────────────────────

export type VideoState = "connecting" | "ready" | "unavailable";

/**
 * Opaque view of the current room. Games see presence, per-key sync, and the opponent's
 * video stream (if any) — but never Firebase itself. Implementations live in
 * @pose-royale/multiplayer.
 */
export interface RoomChannel {
  readonly roomId: string;
  readonly localPlayerId: string;
  readonly remotePlayerId: string | null;

  /** `unavailable` if WebRTC can't establish — UI falls back to avatar + score ticker. */
  readonly videoState: VideoState;
  readonly videoStream: MediaStream | null;

  /** Read a value synchronously. Useful for one-shot reads; prefer subscribe() for updates. */
  get<T>(key: string): T | undefined;
  /** Write a value under the current game's namespace. Resolves when the write is acked. */
  set<T>(key: string, value: T): Promise<void>;
  /** Subscribe to a key. Fires immediately with the current value if any. */
  subscribe<T>(key: string, cb: (value: T | undefined) => void): Unsub;
}

// ──────────────────────────────────────────────────────────────────────────────
// Scoring
// ──────────────────────────────────────────────────────────────────────────────

export interface ScoreEvent {
  playerId: string;
  /** Game-native running total (not a delta). SDK computes normalized = clamp(raw / par, 0, 1). */
  raw: number;
  /** Human-readable tag for HUD / replay / dev overlay (e.g. "combo x5"). */
  label?: string;
  /** `performance.now()` — filled in by the SDK if not provided. */
  at?: number;
}

/** Normalized 0..1 per player at round end. Orchestrator rounds this to 0..1000. */
export type FinalScore = Readonly<Record<string, number>>;

// ──────────────────────────────────────────────────────────────────────────────
// Manifest & module
// ──────────────────────────────────────────────────────────────────────────────

export type CvCapability = "hands" | "pose" | "tfjs-classifier";
export type ScoringMode = "cumulative" | "first-to-score" | "elimination";

export interface DemoCard {
  /** Short looping preview (mp4/webm) or .lottie animation. ≤5 MB. */
  previewUrl: string;
  /** One-line "how to play" tip shown below the preview. */
  howToPlay: string;
  /** Array of icon+label control hints. */
  controls: { icon: string; label: string }[];
}

export interface GameManifest {
  /** Stable ID — used for routing, registry keys, and RTDB paths. Kebab-case. */
  id: string;
  name: string;
  shortDescription: string;
  version: string;

  /** Game's ideal round length. Gauntlet overrides via ctx.roundDurationSec. */
  preferredDurationSec: number;
  minPlayers: 1 | 2;
  maxPlayers: 1 | 2;

  cvRequires: readonly CvCapability[];
  scoring: ScoringMode;

  /**
   * Raw score that maps to a full 1000 tournament points. Games that exceed `par` are capped;
   * scores below are scaled linearly. Both players normalize against the same `par` so both
   * can max out in a round.
   */
  par: number;

  /** Required — no game ships without a demo card (plan §1). */
  demo: DemoCard;
}

/**
 * Handed to every game. The orchestrator constructs one per round; the game consumes it via
 * `module.mount(el, ctx)`. All dependencies flow through this one seam.
 */
export interface GameContext {
  sessionId: string;
  /** All participants (1 or 2). Listed in canonical order — stable across peers. */
  players: readonly Player[];
  localPlayerId: string;

  /** Authoritative round length (Gauntlet = 30). Always use this, not manifest.preferredDurationSec. */
  roundDurationSec: number;
  /**
   * Epoch ms for when the round starts. Already adjusted for this client's clock offset to
   * the server (plan §9 edge case #8), so you can compare directly with Date.now() / performance.now().
   */
  startsAt: number;

  /** Shared, already-warm MediaPipe tracker. Never call getUserMedia directly. */
  hands: HandTrackerHandle;
  /** Present only in online matches. Solo games can ignore. */
  net?: RoomChannel | undefined;

  /** Seeded RNG — both peers get the same sequence for the same round. */
  rng: () => number;

  /**
   * Report a score update. The SDK validates (non-negative, non-NaN), clamps the derived
   * normalized value to [0,1], and silently drops calls after destroy().
   */
  emitScore(event: ScoreEvent): void;

  /** Subscribe to end-of-round finalization. Fires once, with normalized 0..1 per player. */
  onRoundEnd(cb: (final: FinalScore) => void): Unsub;
}

export interface GameInstance {
  /** Begin the round. Called right after the countdown reaches zero. */
  start(): void;
  /** Temporarily pause — keep state, stop emissions. Used for disconnect grace overlays. */
  pause(): void;
  /** Resume from pause. */
  resume(): void;
  /**
   * Tear down. Must leave the DOM node (the `el` passed to mount) empty, stop all RAF loops,
   * remove all window/document listeners, and dispose WebGL contexts. Enforced by CI leak test.
   */
  destroy(): void;
}

export interface GameModule {
  manifest: GameManifest;
  /** Mount point for the game's rendered content. The orchestrator owns `el`'s lifecycle. */
  mount(el: HTMLElement, ctx: GameContext): GameInstance;
}

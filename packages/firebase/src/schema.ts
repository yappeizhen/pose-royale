/**
 * TypeScript mirrors of the Realtime Database schema (plan §5). Kept co-located with the
 * path helpers so the two can't drift. All paths live under `/poseroyale/v1/…`.
 */

export type RoomState =
  /** Waiting for a second player (empty otherwise). */
  | "lobby"
  /** Both players marked ready — orchestrator is showing the setlist reveal. */
  | "reveal"
  /** A round is currently mounted. */
  | "playing"
  /** Gauntlet finished; scores locked in. */
  | "final"
  /** Room is dead — host left or both players disconnected past grace. */
  | "closed";

export interface RoomPlayer {
  id: string;
  name: string;
  elo: number;
  connected: boolean;
  ready: boolean;
  /** serverTimestamp(). Stale > DISCONNECT_GRACE_MS = auto-forfeit remaining rounds. */
  lastHeartbeatAt: number;
  /** HSL-friendly hex for HUD rings. */
  color: string;
}

export interface RoomTournament {
  /** Kebab-case ids from the game registry. */
  setlist: string[];
  /** Index into `setlist` of the currently-playing game. -1 if not yet started. */
  currentIndex: number;
  /** 32-bit integer seed — both peers consume it into the same setlist + per-round RNG. */
  seed: number;
  /** serverTimestamp() for the current round. Countdown + round deadline drive off this. */
  roundStartsAt: number;
  /** Orchestrator-local state phase; mirrored for spectator views. */
  phase: "reveal" | "countdown" | "playing" | "interlude" | "final";
}

export interface Room {
  code: string;
  state: RoomState;
  hostId: string;
  createdAt: number;
  startedAt: number | null;
  tournament: RoomTournament;
  players: Record<string, RoomPlayer>;
  /** Opaque per-game state — namespaced under gameState/{gameId}. */
  gameState?: Record<string, unknown>;
  /** WebRTC signaling payloads keyed by `{from}-{to}` pairs. */
  signaling?: Record<string, SignalingEnvelope>;
}

export type SignalingEnvelope =
  | { kind: "offer"; sdp: string; at: number }
  | { kind: "answer"; sdp: string; at: number }
  | { kind: "ice"; candidate: string; sdpMid: string | null; sdpMLineIndex: number | null; at: number }
  | { kind: "bye"; at: number };

export interface GlobalPlayer {
  username: string;
  globalElo: number;
  wins: number;
  losses: number;
  perGame?: Record<string, { elo: number; plays: number }>;
  createdAt: number;
}

export interface MatchmakingEntry {
  playerId: string;
  elo: number;
  joinedAt: number;
  preferredGames?: string[] | null;
}

// @pose-royale/firebase — Pose Royale's Firebase client + RTDB schema.
// All reads/writes live under /poseroyale/v1/... (plan §5). A breaking schema change ships
// alongside as /poseroyale/v2/...

export const PR_ROOT = "poseroyale/v1";

export const paths = {
  rooms: () => `${PR_ROOT}/rooms`,
  room: (roomId: string) => `${PR_ROOT}/rooms/${roomId}`,
  roomCode: (code: string) => `${PR_ROOT}/roomCodes/${code.toUpperCase()}`,
  roomPlayer: (roomId: string, playerId: string) =>
    `${PR_ROOT}/rooms/${roomId}/players/${playerId}`,
  roomHeartbeat: (roomId: string, playerId: string) =>
    `${PR_ROOT}/rooms/${roomId}/players/${playerId}/lastHeartbeatAt`,
  roomTournament: (roomId: string) => `${PR_ROOT}/rooms/${roomId}/tournament`,
  roomGameState: (roomId: string, gameId: string) =>
    `${PR_ROOT}/rooms/${roomId}/gameState/${gameId}`,
  roomGameStateKey: (roomId: string, gameId: string, key: string) =>
    `${PR_ROOT}/rooms/${roomId}/gameState/${gameId}/${key}`,
  roomSignaling: (roomId: string, pair: string) =>
    `${PR_ROOT}/rooms/${roomId}/signaling/${pair}`,
  player: (playerId: string) => `${PR_ROOT}/players/${playerId}`,
  matchmakingEntry: (playerId: string) => `${PR_ROOT}/matchmaking/queue/${playerId}`,
  matchmakingQueue: () => `${PR_ROOT}/matchmaking/queue`,
} as const;

export const FIREBASE_VERSION = "0.1.0";

export {
  initFirebase,
  isInitialized,
  getFirebaseApp,
  getFirebaseAuth,
  getRtdb,
  __resetFirebaseClient,
} from "./client.js";
export type { FirebaseConfig } from "./client.js";

export {
  readFirebaseConfigFromEnv,
  MissingFirebaseEnvError,
} from "./env.js";

export type {
  GlobalPlayer,
  MatchmakingEntry,
  Room,
  RoomPlayer,
  RoomState,
  RoomTournament,
  SignalingEnvelope,
} from "./schema.js";

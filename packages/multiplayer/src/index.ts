// @pose-royale/multiplayer — Firebase RTDB rooms + WebRTC signaling (plan §5).
//
// Public surface, kept as small as we can get away with:
//   • createRoom / joinRoom → RoomHandle
//   • startHeartbeat + classifyPresence for presence
//   • attachClock for server-time sync
//   • createRoomChannel → the RoomChannel that @pose-royale/sdk games consume via ctx.net
//   • connectPeer for the opponent video bubble (WebRTC via RTDB signaling)
//   • joinMatchmaking for ELO-banded queueing
//   • updateElo + expectedScore for post-match rating movement
//
// Everything else lives in @pose-royale/firebase (paths, schema, client).

export const MULTIPLAYER_VERSION = "0.1.0";

export { attachClock, type ClockHandle } from "./clock.js";
export { generateRoomCode, normalizeRoomCode, isValidRoomCode } from "./roomCode.js";
export { K_FACTOR, expectedScore, updateElo, type EloUpdate } from "./elo.js";
export {
  HEARTBEAT_MS,
  DISCONNECT_GRACE_MS,
  startHeartbeat,
  classifyPresence,
  type PresenceHandle,
} from "./presence.js";
export {
  createRoom,
  joinRoom,
  type CreateRoomOptions,
  type JoinRoomOptions,
  type RoomHandle,
} from "./room.js";
export {
  createRoomChannel,
  type RoomChannelOptions,
  type RoomChannelBinding,
} from "./roomChannel.js";
export { connectPeer, type PeerOptions, type PeerHandle } from "./webrtc.js";
export {
  loadIceServers,
  readIceConfigFromEnv,
  type IceConfig,
} from "./iceServers.js";
export { joinMatchmaking, type JoinQueueOptions, type QueueHandle } from "./matchmaking.js";
export {
  recordFinal,
  recordPerGameBest,
  topGlobal,
  subscribePerGameTop,
  type GlobalEntry,
  type GameEntry,
  type LeaderboardRow,
} from "./leaderboard.js";

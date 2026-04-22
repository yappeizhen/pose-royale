/**
 * Room lifecycle. Create, join, subscribe to updates, leave. Each room is stored at
 * `/poseroyale/v1/rooms/<id>` with a short human-readable code mirrored at
 * `/poseroyale/v1/roomCodes/<CODE>` so players can read codes to each other (plan §5).
 */

import {
  get,
  onValue,
  push,
  ref,
  remove,
  runTransaction,
  serverTimestamp,
  set,
  update,
  type Database,
} from "firebase/database";
import { getRtdb, paths, type Room, type RoomPlayer, type RoomTournament } from "@pose-royale/firebase";
import type { Unsub } from "@pose-royale/sdk";
import { generateRoomCode, normalizeRoomCode } from "./roomCode.js";
import { startHeartbeat, type PresenceHandle } from "./presence.js";

export interface CreateRoomOptions {
  displayName: string;
  color?: string;
  elo?: number;
  /** Override RTDB handle — defaults to the shared one from @pose-royale/firebase. */
  db?: Database;
}

export type JoinRoomOptions = CreateRoomOptions;

export interface RoomHandle {
  readonly roomId: string;
  readonly code: string;
  readonly localPlayerId: string;
  /** Latest snapshot from RTDB, or null before the first load completes. */
  getSnapshot(): Room | null;
  subscribe(cb: (room: Room | null) => void): Unsub;
  markReady(ready: boolean): Promise<void>;
  updateTournament(patch: Partial<RoomTournament>): Promise<void>;
  leave(): Promise<void>;
}

const DEFAULT_COLORS = ["#ff2f6a", "#7dd3fc"] as const;

export async function createRoom(opts: CreateRoomOptions): Promise<RoomHandle> {
  const db = opts.db ?? getRtdb();
  const playerId = newPlayerId();
  const code = await reserveRoomCode(db);

  const roomRef = push(ref(db, paths.rooms()));
  const roomId = roomRef.key ?? "";
  if (!roomId) throw new Error("createRoom: failed to allocate room id");

  const me: RoomPlayer = {
    id: playerId,
    name: opts.displayName,
    elo: opts.elo ?? 1200,
    connected: true,
    ready: false,
    lastHeartbeatAt: 0,
    color: opts.color ?? DEFAULT_COLORS[0],
  };
  const initial: Room = {
    code,
    state: "lobby",
    hostId: playerId,
    createdAt: Date.now(),
    startedAt: null,
    tournament: emptyTournament(),
    players: { [playerId]: me },
  };
  await set(roomRef, initial);
  await set(ref(db, paths.roomCode(code)), roomId);

  return attachRoomHandle(db, roomId, code, playerId);
}

export async function joinRoom(inputCode: string, opts: JoinRoomOptions): Promise<RoomHandle> {
  const db = opts.db ?? getRtdb();
  const code = normalizeRoomCode(inputCode);
  const idSnap = await get(ref(db, paths.roomCode(code)));
  const roomId = idSnap.val();
  if (typeof roomId !== "string" || roomId.length === 0) {
    throw new Error(`No room found for code ${code}`);
  }
  const roomSnap = await get(ref(db, paths.room(roomId)));
  const existing = roomSnap.val() as Room | null;
  if (!existing) throw new Error(`Room ${code} no longer exists`);
  if (Object.keys(existing.players ?? {}).length >= 2) {
    throw new Error(`Room ${code} is full`);
  }

  const playerId = newPlayerId();
  const assignedColor =
    opts.color ?? pickAssignedColor(Object.values(existing.players ?? {}).map((p) => p.color));
  const me: RoomPlayer = {
    id: playerId,
    name: opts.displayName,
    elo: opts.elo ?? 1200,
    connected: true,
    ready: false,
    lastHeartbeatAt: 0,
    color: assignedColor,
  };
  await update(ref(db, paths.room(roomId)), {
    [`players/${playerId}`]: me,
  });

  return attachRoomHandle(db, roomId, code, playerId);
}

function attachRoomHandle(
  db: Database,
  roomId: string,
  code: string,
  playerId: string,
): RoomHandle {
  let snapshot: Room | null = null;
  const subscribers = new Set<(room: Room | null) => void>();

  const unsubValue = onValue(ref(db, paths.room(roomId)), (snap) => {
    snapshot = (snap.val() as Room | null) ?? null;
    for (const cb of subscribers) cb(snapshot);
  });

  const presence: PresenceHandle = startHeartbeat(db, roomId, playerId);

  return {
    roomId,
    code,
    localPlayerId: playerId,
    getSnapshot: () => snapshot,
    subscribe(cb) {
      subscribers.add(cb);
      if (snapshot !== null) cb(snapshot);
      return () => subscribers.delete(cb);
    },
    async markReady(ready) {
      await update(ref(db, paths.roomPlayer(roomId, playerId)), { ready });
    },
    async updateTournament(patch) {
      // Rewrite fields individually so we don't stomp untouched keys (and so a partial patch
      // like `{ currentIndex: 2 }` stays minimal on the wire).
      const update_: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) {
        update_[`tournament/${k}`] = v;
      }
      if ("roundStartsAt" in patch) {
        // Let Firebase fill the server-authoritative timestamp when the caller wants it.
        update_["tournament/roundStartsAt"] = serverTimestamp();
      }
      await update(ref(db, paths.room(roomId)), update_);
    },
    async leave() {
      unsubValue();
      subscribers.clear();
      await presence.stop();
      const roomRef = ref(db, paths.room(roomId));
      // Use a transaction to atomically remove us + close the room if we were the last one.
      await runTransaction(roomRef, (cur: Room | null) => {
        if (!cur) return cur;
        const players = { ...(cur.players ?? {}) };
        delete players[playerId];
        if (Object.keys(players).length === 0) {
          // Last one out turns off the lights.
          return null;
        }
        return { ...cur, players };
      });
      // Also clear the code mapping if the room was closed. Safe even if the room already went
      // away — `remove` on a missing path is a no-op.
      const still = await get(ref(db, paths.room(roomId)));
      if (!still.exists()) {
        await remove(ref(db, paths.roomCode(code)));
      }
    },
  };
}

function emptyTournament(): RoomTournament {
  return {
    setlist: [],
    currentIndex: -1,
    seed: 0,
    roundStartsAt: 0,
    phase: "reveal",
  };
}

function newPlayerId(): string {
  // Simple opaque id; pose-royale treats playerIds as arbitrary strings. The matchmaking +
  // global-player layers use their own stable ids (Firebase auth uid) separately.
  return `p_${Math.random().toString(36).slice(2, 10)}`;
}

function pickAssignedColor(taken: string[]): string {
  for (const c of DEFAULT_COLORS) if (!taken.includes(c)) return c;
  return DEFAULT_COLORS[1];
}

/**
 * Try generating a fresh code and claiming its entry under `/roomCodes/<CODE>` atomically.
 * Retries up to 5 times if we hit a collision.
 */
async function reserveRoomCode(db: Database): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRoomCode();
    const claimRef = ref(db, paths.roomCode(code));
    const snap = await get(claimRef);
    if (!snap.exists()) return code;
  }
  throw new Error("Could not allocate a room code after 5 attempts — DB may be saturated");
}

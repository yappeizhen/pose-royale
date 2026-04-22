/**
 * RoomChannel implementation (plan §3 SDK contract). Games read/write small JSON blobs under
 * `/rooms/<id>/gameState/<gameId>/<key>`. That's the only seam a game has to the room — the
 * lint rules in eslint.config.js forbid importing firebase or @pose-royale/multiplayer from
 * anywhere under `games/**`.
 *
 * We intentionally keep this surface tiny: get / set / subscribe. Everything fancier (voting,
 * transactions, CRDTs) can be built on top in user-land without changing the contract.
 */

import { onValue, ref, set, type Database } from "firebase/database";
import { paths } from "@pose-royale/firebase";
import type { RoomChannel, Unsub, VideoState } from "@pose-royale/sdk";
import type { RoomHandle } from "./room.js";

export interface RoomChannelOptions {
  db: Database;
  room: RoomHandle;
  gameId: string;
  videoState: VideoState;
  videoStream: MediaStream | null;
}

export interface RoomChannelBinding {
  channel: RoomChannel;
  /** Swap the video state/stream as WebRTC negotiates. */
  updateVideo(state: VideoState, stream: MediaStream | null): void;
  /** Tear down all RTDB listeners this channel opened. */
  dispose(): void;
}

export function createRoomChannel(opts: RoomChannelOptions): RoomChannelBinding {
  const { db, room, gameId } = opts;
  const cache = new Map<string, unknown>();
  const subs = new Map<string, Set<(value: unknown) => void>>();
  const unsubs = new Map<string, () => void>();
  let videoState = opts.videoState;
  let videoStream = opts.videoStream;

  const ensureListener = (key: string): void => {
    if (unsubs.has(key)) return;
    const stop = onValue(ref(db, paths.roomGameStateKey(room.roomId, gameId, key)), (snap) => {
      const value = snap.val() as unknown;
      cache.set(key, value ?? undefined);
      for (const cb of subs.get(key) ?? []) cb(value ?? undefined);
    });
    unsubs.set(key, stop);
  };

  const channel: RoomChannel = {
    roomId: room.roomId,
    localPlayerId: room.localPlayerId,
    get remotePlayerId() {
      const snap = room.getSnapshot();
      if (!snap) return null;
      const others = Object.keys(snap.players ?? {}).filter((id) => id !== room.localPlayerId);
      return others[0] ?? null;
    },
    get videoState() {
      return videoState;
    },
    get videoStream() {
      return videoStream;
    },
    get<T>(key: string): T | undefined {
      ensureListener(key);
      return cache.get(key) as T | undefined;
    },
    async set<T>(key: string, value: T): Promise<void> {
      cache.set(key, value);
      await set(ref(db, paths.roomGameStateKey(room.roomId, gameId, key)), value);
    },
    subscribe<T>(key: string, cb: (value: T | undefined) => void): Unsub {
      ensureListener(key);
      let set_ = subs.get(key);
      if (!set_) {
        set_ = new Set();
        subs.set(key, set_);
      }
      const wrapped = (v: unknown) => cb(v as T | undefined);
      set_.add(wrapped);
      if (cache.has(key)) cb(cache.get(key) as T | undefined);
      return () => {
        set_!.delete(wrapped);
      };
    },
  };

  return {
    channel,
    updateVideo(nextState, nextStream) {
      videoState = nextState;
      videoStream = nextStream;
    },
    dispose() {
      for (const stop of unsubs.values()) stop();
      unsubs.clear();
      subs.clear();
      cache.clear();
    },
  };
}

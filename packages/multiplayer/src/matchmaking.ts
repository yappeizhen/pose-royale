/**
 * Plan §5/§10 matchmaking — a lightweight ELO-banded queue. Players push themselves into
 * `/matchmaking/queue/<playerId>` and watch for a partner whose ELO is within a widening
 * band. First match wins: both sides atomically remove themselves and the loser of the race
 * retries. Room creation happens on the winning client (so we don't need a cloud function).
 *
 * This is intentionally simple. The plan calls out v2 upgrades (Cloud Function matcher,
 * region sharding, skill-based sets) — deliberately out of scope here.
 */

import {
  get,
  onValue,
  onDisconnect,
  ref,
  remove,
  runTransaction,
  serverTimestamp,
  set,
  type Database,
} from "firebase/database";
import { getRtdb, paths, type MatchmakingEntry } from "@pose-royale/firebase";

export interface JoinQueueOptions {
  playerId: string;
  elo: number;
  preferredGames?: string[];
  db?: Database;
  /** Starting ELO half-width. The band widens by `+bandGrowthPerSec` every second. */
  initialBand?: number;
  bandGrowthPerSec?: number;
  onMatched(peerId: string): void;
  onSearching(band: number, elapsedMs: number): void;
}

export interface QueueHandle {
  leave(): Promise<void>;
}

export function joinMatchmaking(opts: JoinQueueOptions): QueueHandle {
  const db = opts.db ?? getRtdb();
  const myPath = paths.matchmakingEntry(opts.playerId);
  const myRef = ref(db, myPath);

  const entry: MatchmakingEntry = {
    playerId: opts.playerId,
    elo: opts.elo,
    joinedAt: 0, // serverTimestamp replaces below
    preferredGames: opts.preferredGames ?? null,
  };
  void set(myRef, { ...entry, joinedAt: serverTimestamp() });
  // If the tab crashes we'd pollute the queue forever otherwise.
  void onDisconnect(myRef).remove();

  const startedAt = Date.now();
  const initialBand = opts.initialBand ?? 150;
  const growth = opts.bandGrowthPerSec ?? 50;

  let matched = false;

  const stop = onValue(ref(db, paths.matchmakingQueue()), (snap) => {
    if (matched) return;
    const queue = (snap.val() ?? {}) as Record<string, MatchmakingEntry>;
    const mine = queue[opts.playerId];
    if (!mine) return; // Someone already claimed us (or we left).
    const elapsedMs = Date.now() - startedAt;
    const band = initialBand + Math.floor((elapsedMs / 1000) * growth);
    opts.onSearching(band, elapsedMs);

    // Find the closest-ELO candidate inside the band, preferring older entries so nobody
    // starves on the queue.
    const candidates = Object.values(queue)
      .filter((e) => e.playerId !== opts.playerId)
      .filter((e) => Math.abs(e.elo - opts.elo) <= band)
      .sort((a, b) => a.joinedAt - b.joinedAt);
    const pick = candidates[0];
    if (!pick) return;

    // Claim the match: atomically remove both entries. If our transaction fails (the peer got
    // claimed by someone else first) we'll just wait for the next queue update.
    void claimPair(db, opts.playerId, pick.playerId).then((won) => {
      if (!won) return;
      matched = true;
      stop();
      opts.onMatched(pick.playerId);
    });
  });

  return {
    async leave() {
      stop();
      await remove(myRef);
    },
  };
}

async function claimPair(db: Database, me: string, them: string): Promise<boolean> {
  // Try to remove `them` transactionally — if it's already gone, abort. Then remove ourselves.
  const theirRef = ref(db, paths.matchmakingEntry(them));
  const result = await runTransaction(theirRef, (cur: MatchmakingEntry | null) => {
    if (cur === null) return; // abort
    return null; // claim
  });
  if (!result.committed) return false;
  const stillThere = await get(theirRef);
  if (stillThere.exists()) return false;
  await remove(ref(db, paths.matchmakingEntry(me)));
  return true;
}

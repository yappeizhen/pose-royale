/**
 * Lightweight leaderboards (plan §7). We keep two flat maps:
 *   • /leaderboards/global/<playerId>  — { elo, wins, losses, name, updatedAt }
 *   • /leaderboards/perGame/<gameId>/<playerId> — { best, updatedAt }
 *
 * We intentionally skip server-side sorting: the client reads the whole map and sorts
 * locally. With <=1k players this is fine and avoids Cloud Functions for v1.
 */

import {
  get,
  onValue,
  ref,
  runTransaction,
  serverTimestamp,
  type Database,
} from "firebase/database";
import { getRtdb, PR_ROOT } from "@pose-royale/firebase";

export interface GlobalEntry {
  elo: number;
  wins: number;
  losses: number;
  name: string;
  updatedAt: number;
}

export interface GameEntry {
  best: number;
  name: string;
  updatedAt: number;
}

const P = {
  global: () => `${PR_ROOT}/leaderboards/global`,
  globalEntry: (playerId: string) => `${PR_ROOT}/leaderboards/global/${playerId}`,
  perGame: (gameId: string) => `${PR_ROOT}/leaderboards/perGame/${gameId}`,
  perGameEntry: (gameId: string, playerId: string) =>
    `${PR_ROOT}/leaderboards/perGame/${gameId}/${playerId}`,
};

export async function recordFinal(opts: {
  playerId: string;
  name: string;
  /** Pass the ELO delta you want applied (positive for a win, negative for a loss). */
  eloDelta: number;
  won: boolean;
  db?: Database;
}): Promise<void> {
  const db = opts.db ?? getRtdb();
  await runTransaction(ref(db, P.globalEntry(opts.playerId)), (cur: GlobalEntry | null) => {
    const prev: GlobalEntry = cur ?? {
      elo: 1200,
      wins: 0,
      losses: 0,
      name: opts.name,
      updatedAt: 0,
    };
    return {
      elo: prev.elo + opts.eloDelta,
      wins: prev.wins + (opts.won ? 1 : 0),
      losses: prev.losses + (opts.won ? 0 : 1),
      name: opts.name,
      updatedAt: serverTimestamp() as unknown as number,
    };
  });
}

export async function recordPerGameBest(opts: {
  playerId: string;
  name: string;
  gameId: string;
  /** 0..1000 normalized tournament points for the player in that game. */
  points: number;
  db?: Database;
}): Promise<void> {
  const db = opts.db ?? getRtdb();
  await runTransaction(
    ref(db, P.perGameEntry(opts.gameId, opts.playerId)),
    (cur: GameEntry | null) => {
      const prev: GameEntry = cur ?? { best: 0, name: opts.name, updatedAt: 0 };
      if (opts.points <= prev.best) return prev; // no change — abort would lose the name update
      return {
        best: opts.points,
        name: opts.name,
        updatedAt: serverTimestamp() as unknown as number,
      };
    },
  );
}

export interface LeaderboardRow<T> {
  playerId: string;
  entry: T;
}

export async function topGlobal(limit = 25, db?: Database): Promise<LeaderboardRow<GlobalEntry>[]> {
  const snap = await get(ref((db ?? getRtdb()) as Database, P.global()));
  const all = (snap.val() ?? {}) as Record<string, GlobalEntry>;
  return Object.entries(all)
    .map(([playerId, entry]) => ({ playerId, entry }))
    .sort((a, b) => b.entry.elo - a.entry.elo)
    .slice(0, limit);
}

export function subscribePerGameTop(
  gameId: string,
  cb: (rows: LeaderboardRow<GameEntry>[]) => void,
  limit = 25,
  db?: Database,
): () => void {
  return onValue(ref((db ?? getRtdb()) as Database, P.perGame(gameId)), (snap) => {
    const all = (snap.val() ?? {}) as Record<string, GameEntry>;
    const rows = Object.entries(all)
      .map(([playerId, entry]) => ({ playerId, entry }))
      .sort((a, b) => b.entry.best - a.entry.best)
      .slice(0, limit);
    cb(rows);
  });
}

/**
 * Heartbeat presence. Each local player posts a `lastHeartbeatAt: serverTimestamp()` every
 * HEARTBEAT_MS; peers watch for the value to go stale. When an opponent's heartbeat is
 * older than `graceMs`, the orchestrator shows the disconnect overlay and eventually
 * forfeits the remaining rounds (plan §4, §9 edge case #1).
 */

import { onDisconnect, ref, serverTimestamp, update, type Database } from "firebase/database";
import { paths } from "@pose-royale/firebase";

export const HEARTBEAT_MS = 3_000;
export const DISCONNECT_GRACE_MS = 15_000;

export interface PresenceHandle {
  /** Stop heartbeating and disarm the onDisconnect hook. */
  stop(): Promise<void>;
}

/**
 * Start heartbeating for a player in a room. Writes `lastHeartbeatAt` every HEARTBEAT_MS and
 * installs an onDisconnect hook that marks the player `connected: false` on abrupt exit.
 */
export function startHeartbeat(db: Database, roomId: string, playerId: string): PresenceHandle {
  const playerRef = ref(db, paths.roomPlayer(roomId, playerId));

  // Abrupt-disconnect hook: if the browser/tab dies, Firebase flips this on our behalf.
  // Regular .leave() calls cancel the hook explicitly — see stop() below.
  const onDisc = onDisconnect(playerRef);
  void onDisc.update({ connected: false, lastHeartbeatAt: serverTimestamp() });

  // Cadence heartbeat. setInterval drift is tolerable at 3s — far below the 15s grace.
  const beat = () => {
    void update(playerRef, {
      lastHeartbeatAt: serverTimestamp(),
      connected: true,
    });
  };
  beat();
  const intervalId = setInterval(beat, HEARTBEAT_MS);

  return {
    async stop(): Promise<void> {
      clearInterval(intervalId);
      await onDisc.cancel();
      await update(playerRef, { connected: false, lastHeartbeatAt: serverTimestamp() });
    },
  };
}

/**
 * Given a room snapshot's players map and the current server-estimated time, determine who
 * is "present" (connected and heartbeating recently).
 */
export function classifyPresence(
  players: Record<string, { connected: boolean; lastHeartbeatAt: number | null | undefined }>,
  nowServerMs: number,
  graceMs: number = DISCONNECT_GRACE_MS,
): Record<string, "present" | "stale" | "offline"> {
  const out: Record<string, "present" | "stale" | "offline"> = {};
  for (const [pid, p] of Object.entries(players)) {
    if (!p.connected) {
      out[pid] = "offline";
      continue;
    }
    const last = typeof p.lastHeartbeatAt === "number" ? p.lastHeartbeatAt : 0;
    const age = nowServerMs - last;
    out[pid] = age <= graceMs ? "present" : "stale";
  }
  return out;
}

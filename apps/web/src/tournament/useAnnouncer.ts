/**
 * useAnnouncer — plays Web Speech cues that track tournament phase transitions.
 *
 * Split out from TournamentRunner so the renderer has one less concern. All effects
 * run post-commit (never during render) and the underlying Announcer speech queue is
 * cancelled on unmount so Strict Mode's double-invoke doesn't leave stale utterances
 * mid-sentence.
 */

import type { Player } from "@pose-royale/sdk";
import { useEffect, useRef } from "react";
import { Announcer } from "../fun/Announcer.js";
import type { Phase } from "./phases.js";
import type { RegistryEntry } from "./registry.js";
import { leaderOf, type RoundResult } from "./scoreLedger.js";

export interface UseAnnouncerOptions {
  phase: Phase;
  results: readonly RoundResult[];
  players: readonly Player[];
  registry: readonly RegistryEntry[];
  setlistLength: number;
  gameIdForRound: (roundIndex: number) => string | null;
}

export function useAnnouncer({
  phase,
  results,
  players,
  registry,
  setlistLength,
  gameIdForRound,
}: UseAnnouncerOptions): void {
  const announcerRef = useRef<Announcer | null>(null);
  if (announcerRef.current === null) announcerRef.current = new Announcer();

  useEffect(() => {
    const a = announcerRef.current;
    if (!a) return;
    if (phase.kind === "selector") {
      // Speak "randomising" once at the start; the reveal itself fires after the spin.
      if (phase.suddenDeath) a.suddenDeath();
      else a.selectorSpin(phase.roundIndex, setlistLength);
    } else if (phase.kind === "briefing") {
      const gameId = gameIdForRound(phase.roundIndex);
      const m = gameId ? registry.find((r) => r.id === gameId)?.manifest : undefined;
      if (m) a.briefing(m.name);
    } else if (phase.kind === "countdown") {
      const gameId = gameIdForRound(phase.roundIndex);
      const m = gameId ? registry.find((r) => r.id === gameId)?.manifest : undefined;
      if (m) a.roundStart(m.name, phase.roundIndex, setlistLength);
    } else if (phase.kind === "interlude") {
      const r = results[phase.justFinished];
      if (r) {
        let topId: string | null = null;
        let topPts = -1;
        for (const [pid, pts] of Object.entries(r.points)) {
          if (pts > topPts) {
            topPts = pts;
            topId = pid;
          }
        }
        const tied = Object.values(r.points).filter((p) => p === topPts).length > 1;
        const name = tied ? null : (players.find((p) => p.id === topId)?.name ?? null);
        a.roundWinner(name);
      }
    } else if (phase.kind === "final") {
      const lead = leaderOf(results);
      a.finalWinner(
        lead.kind === "winner"
          ? (players.find((p) => p.id === lead.playerId)?.name ?? "Player")
          : null,
      );
    }
  }, [phase, registry, results, players, setlistLength, gameIdForRound]);

  useEffect(
    () => () => {
      announcerRef.current?.cancel();
    },
    [],
  );
}

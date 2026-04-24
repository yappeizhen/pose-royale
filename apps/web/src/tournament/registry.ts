/**
 * Game registry — the single source of truth for which games exist on the platform.
 *
 * Each entry has an `id` (matching the manifest id) and a dynamic `load()` so the tournament
 * orchestrator can lazy-load the game bundle and prefetch the next one during the current
 * round (plan §4).
 *
 * Adding a new game is one line here plus a `games/<id>` workspace package (plan §8).
 */

import type { GameManifest, GameModule } from "@pose-royale/sdk";
import { manifest as frootninjaManifest } from "@pose-royale/game-frootninja";
import { manifest as learnsignManifest } from "@pose-royale/game-learnsign";
import { manifest as ponghubManifest } from "@pose-royale/game-ponghub";

export interface RegistryEntry {
  id: string;
  /** Lightweight manifest needed to render the lobby + setlist without importing the full game bundle. */
  manifest: GameManifest;
  /** Dynamic import. Returns the module's default export. */
  load: () => Promise<{ default: GameModule }>;
}

/**
 * Each new game adds one entry here + a `games/<id>` workspace. The orchestrator treats an
 * empty registry as "no games installed" and renders a placeholder.
 */
export const REGISTRY: readonly RegistryEntry[] = [
  {
    id: frootninjaManifest.id,
    manifest: frootninjaManifest,
    load: () => import("@pose-royale/game-frootninja"),
  },
  {
    id: ponghubManifest.id,
    manifest: ponghubManifest,
    load: () => import("@pose-royale/game-ponghub"),
  },
  {
    id: learnsignManifest.id,
    manifest: learnsignManifest,
    load: () => import("@pose-royale/game-learnsign"),
  },
] as const;

export function getManifest(id: string): GameManifest | undefined {
  return REGISTRY.find((g) => g.id === id)?.manifest;
}

export function loadGame(id: string): Promise<{ default: GameModule }> {
  const entry = REGISTRY.find((g) => g.id === id);
  if (!entry) return Promise.reject(new Error(`Unknown game: ${id}`));
  return entry.load();
}

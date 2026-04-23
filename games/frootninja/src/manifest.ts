import type { GameManifest } from "@pose-royale/sdk";

/**
 * Frootninja — slice falling fruits with your index finger, avoid the bombs.
 * par = 40 slices in 30s = comfortable "A" score; anything beyond = 1000 capped (plan §1).
 */
export const manifest: GameManifest = {
  id: "frootninja",
  name: "Froot Ninja",
  shortDescription: "Slice fruits, avoid bombs.",
  version: "0.1.0",
  preferredDurationSec: 30,
  minPlayers: 1,
  maxPlayers: 2,
  cvRequires: ["hands"],
  scoring: "cumulative",
  par: 40,
  demo: {
    previewUrl: "/games/frootninja/preview.png",
    howToPlay: "Swipe through fruit with your fingertip. Dodge the bombs!",
    controls: [
      { icon: "✋", label: "Index fingertip = blade" },
      { icon: "💣", label: "Bombs = -1 point" },
    ],
  },
};

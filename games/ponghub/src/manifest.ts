import type { GameManifest } from "@pose-royale/sdk";

/**
 * PongHub — 3D table tennis vs an AI. Players control their paddle with an open palm:
 * horizontal position mirrors palm X, vertical mirrors palm Y, and swing speed / face
 * tilt feed into spin and placement. Each point you win counts 1; par 5 clean points
 * in 30 s maxes out the tournament score.
 */
export const manifest: GameManifest = {
  id: "ponghub",
  name: "PongHub",
  shortDescription: "Rally with your palm. Swing for the corners.",
  version: "0.2.0",
  preferredDurationSec: 30,
  minPlayers: 1,
  maxPlayers: 2,
  cvRequires: ["hands"],
  scoring: "cumulative",
  par: 5,
  demo: {
    previewUrl: "/games/ponghub/preview.webm",
    howToPlay:
      "Hold your open palm up, then move it to steer the paddle. A quick swing adds power and spin.",
    controls: [
      { icon: "✋", label: "Palm X/Y = paddle position" },
      { icon: "💨", label: "Swing fast for smashes" },
      { icon: "🎾", label: "Each point scores 1" },
    ],
  },
};

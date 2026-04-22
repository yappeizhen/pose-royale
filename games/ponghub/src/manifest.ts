import type { GameManifest } from "@pose-royale/sdk";

/**
 * PongHub — mirror-style pong rally. Each player controls a paddle on their own device with
 * their palm's vertical position; the ball ricochets against the CPU side. Rallies scale in
 * speed, so par is set to 12 clean returns — a focused 30 seconds will land there.
 */
export const manifest: GameManifest = {
  id: "ponghub",
  name: "PongHub",
  shortDescription: "Palm the paddle. Rally till the buzzer.",
  version: "0.1.0",
  preferredDurationSec: 30,
  minPlayers: 1,
  maxPlayers: 2,
  cvRequires: ["hands"],
  scoring: "cumulative",
  par: 12,
  demo: {
    previewUrl: "/games/ponghub/preview.webm",
    howToPlay: "Move your open palm up/down to steer the paddle. Each return scores 1.",
    controls: [
      { icon: "✋", label: "Palm Y = paddle Y" },
      { icon: "🎾", label: "Return to score; miss resets rally" },
    ],
  },
};

import type { GameManifest } from "@pose-royale/sdk";

/**
 * LearnSign — sign ASL alphabet letters on demand, inspired by ngzhili/LearnSign.
 *
 * Target letter flashes on screen; hold the matching ASL handshape in front of the
 * webcam until the detector locks it in. Score = letters landed in 30 s.
 *
 * par = 12 letters in 30 s (≈ 1 every 2.5 s including "read the prompt + shape the
 * hand + hold for lock-in") is a comfortable "A" score; 12+ caps to 1000 points.
 *
 * Pass 1 uses a hand-landmark heuristic covering ~6 distinguishable letters. Pass 2
 * will swap in the LearnSign TF.js SSD MobileNet model for the full 24-letter set.
 */
export const manifest: GameManifest = {
  id: "learnsign",
  name: "Learn Sign",
  shortDescription: "Sign the ASL letter shown on screen.",
  version: "0.1.0",
  preferredDurationSec: 30,
  minPlayers: 1,
  maxPlayers: 2,
  cvRequires: ["hands"],
  scoring: "cumulative",
  par: 12,
  demo: {
    previewUrl: "/games/learnsign/preview.png",
    howToPlay:
      "A letter appears — hold the matching ASL handshape in the webcam frame until it locks in, then a new letter appears. Chain as many as you can in 30 seconds.",
    controls: [
      { icon: "✋", label: "Your hand = the sign" },
      { icon: "⏱️", label: "Hold steady ~600ms to confirm" },
    ],
  },
};

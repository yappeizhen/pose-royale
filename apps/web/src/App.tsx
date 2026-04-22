import type { HandTrackerHandle, Player } from "@pose-royale/sdk";
import { BackButton, BackScope, CameraGate } from "@pose-royale/ui";
import { useEffect, useRef, useState } from "react";
import { TournamentRunner } from "./tournament/TournamentRunner.js";

type Screen = "home" | "tournament";

/**
 * M0–M2 app shell. Camera gated → Home → Tournament orchestrator. Multiplayer (M4) and the
 * real game registry (M3/M4) slot into this without restructuring — both the lobby flow and
 * the HandTracker construction will move into their own components once they land.
 */
export function App() {
  return (
    <CameraGate>
      {(stream) => <Shell stream={stream} />}
    </CameraGate>
  );
}

function Shell({ stream }: { stream: MediaStream }) {
  const [screen, setScreen] = useState<Screen>("home");
  // Generated once per tournament session so the seeded RNG stays stable across re-renders
  // but changes between rematches. Math.random() is impure — can't call it during render.
  const [seedSource, setSeedSource] = useState(() => `solo-${randomToken()}`);
  const [sessionId] = useState(() => `solo-${Date.now()}`);

  if (screen === "tournament") {
    return (
      <TournamentRunner
        players={SOLO_PLAYERS}
        localPlayerId={SOLO_PLAYERS[0].id}
        sessionId={sessionId}
        seedSource={seedSource}
        hands={PLACEHOLDER_HANDS}
        onExit={() => {
          setSeedSource(`solo-${randomToken()}`);
          setScreen("home");
        }}
      />
    );
  }

  return (
    <BackScope action={{ kind: "navigate", to: "/" }}>
      <BackButton />
      <Home stream={stream} onStart={() => setScreen("tournament")} />
    </BackScope>
  );
}

function randomToken(): string {
  return Math.random().toString(36).slice(2, 10);
}

const SOLO_PLAYERS = [
  { id: "local", name: "You", color: "#ff2f6a", isLocal: true },
] as const satisfies readonly Player[];

/**
 * Temporary no-op HandTrackerHandle for M2. Real HandTracker from @pose-royale/cv gets wired
 * in M3 once we have a game that actually reads hand landmarks — at that point we construct
 * a HandTracker here from the shared MediaStream and pass its handle instead.
 */
const PLACEHOLDER_HANDS: HandTrackerHandle = {
  latest: null,
  confidence: 0,
  ready: false,
  subscribe: () => () => {},
};

function Home({ stream, onStart }: { stream: MediaStream; onStart: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = stream;
    el.play().catch(() => {});
    return () => {
      el.srcObject = null;
    };
  }, [stream]);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
        gap: "1rem",
      }}
    >
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        style={{
          width: "min(90vw, 640px)",
          aspectRatio: "16 / 9",
          objectFit: "cover",
          borderRadius: 16,
          transform: "scaleX(-1)",
          background: "#000",
        }}
      />
      <h1 style={{ fontFamily: "var(--font-display)", margin: 0, fontSize: "2.5rem" }}>
        Pose Royale
      </h1>
      <p style={{ margin: 0, color: "var(--fg-1)", textAlign: "center", maxWidth: 480 }}>
        A gauntlet of 3 minigames × 30s each. Your webcam is the controller.
      </p>
      <button
        onClick={onStart}
        style={{
          padding: "0.9rem 2rem",
          borderRadius: 999,
          border: "none",
          fontSize: "1.05rem",
          fontWeight: 600,
          background: "white",
          color: "#0a0a15",
          cursor: "pointer",
        }}
      >
        Start Gauntlet (Solo)
      </button>
      <small style={{ opacity: 0.4 }}>
        dev · press <kbd>~</kbd> during play for the debug overlay
      </small>
    </main>
  );
}

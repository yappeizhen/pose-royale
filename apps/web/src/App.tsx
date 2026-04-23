import { HandTracker } from "@pose-royale/cv";
import type { Player } from "@pose-royale/sdk";
import { CameraGate } from "@pose-royale/ui";
import { useEffect, useRef, useState } from "react";
import "./tournament/screens/screens.css";
import { TournamentRunner } from "./tournament/TournamentRunner.js";

type Screen = "home" | "tournament";

/**
 * App shell. CameraGate → TrackerShell (warms the shared MediaPipe HandLandmarker) → Shell
 * (home + tournament). Plan §9 edge case #2: exactly one HandTracker per session — we do
 * NOT re-init per round, because the model warm-up burns ~700-900ms on most laptops.
 */
export function App() {
  return <CameraGate>{(stream) => <TrackerShell stream={stream} />}</CameraGate>;
}

function TrackerShell({ stream }: { stream: MediaStream }) {
  const [hands, setHands] = useState<HandTracker | null>(null);
  const [error, setError] = useState<string | null>(null);
  const disposedRef = useRef(false);

  useEffect(() => {
    disposedRef.current = false;
    let local: HandTracker | null = null;
    HandTracker.create({ stream })
      .then((tracker) => {
        if (disposedRef.current) {
          tracker.destroy();
          return;
        }
        local = tracker;
        setHands(tracker);
      })
      .catch((err) => {
        console.error("[shell] HandTracker.create failed", err);
        setError(err instanceof Error ? err.message : "Hand tracker failed to initialize");
      });
    return () => {
      disposedRef.current = true;
      local?.destroy();
    };
  }, [stream]);

  if (error) {
    return <CenterNotice title="Hand tracking unavailable" message={error} />;
  }
  if (!hands) {
    return (
      <CenterNotice
        title="Warming up the camera model…"
        message="First-time setup takes a moment while MediaPipe boots."
      />
    );
  }
  return <Shell stream={stream} hands={hands} />;
}

function Shell({ stream, hands }: { stream: MediaStream; hands: HandTracker }) {
  const [screen, setScreen] = useState<Screen>("home");
  // Generated once per tournament session so the seeded RNG stays stable across re-renders
  // but changes between rematches. Math.random() is impure — can't call it during render.
  const [seedSource, setSeedSource] = useState(() => `solo-${randomToken()}`);
  const [sessionId] = useState(() => `solo-${Date.now()}`);

  if (screen === "tournament") {
    return (
      <>
        {/* The active-player feed sits behind everything else; the game canvas is transparent
            so fruit/pong visuals render on top of the player's own webcam (plan §1). */}
        <WebcamBackground stream={stream} />
        <TournamentRunner
          players={SOLO_PLAYERS}
          localPlayerId={SOLO_PLAYERS[0].id}
          sessionId={sessionId}
          seedSource={seedSource}
          hands={hands}
          onExit={() => {
            setSeedSource(`solo-${randomToken()}`);
            setScreen("home");
          }}
        />
      </>
    );
  }

  // Home is the root screen — no back button, since there's nowhere to go back to.
  // TournamentRunner mounts its own BackScope / BackButton for in-game exit + forfeit.
  return <Home stream={stream} onStart={() => setScreen("tournament")} />;
}

function randomToken(): string {
  return Math.random().toString(36).slice(2, 10);
}

const SOLO_PLAYERS = [
  { id: "local", name: "You", color: "#ff2f6a", isLocal: true },
] as const satisfies readonly Player[];

function WebcamBackground({ stream }: { stream: MediaStream }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = stream;
    void el.play().catch(() => {});
    return () => {
      el.srcObject = null;
    };
  }, [stream]);
  return (
    <video
      ref={videoRef}
      muted
      playsInline
      autoPlay
      aria-hidden
      // Mirror so the player sees themselves in a natural "look at yourself" orientation.
      // Games that consume ctx.hands already account for the mirror when they do `1 - lm.x`.
      className="webcam-bg"
    />
  );
}

function Home({ stream, onStart }: { stream: MediaStream; onStart: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = stream;
    void el.play().catch(() => {});
    return () => {
      el.srcObject = null;
    };
  }, [stream]);

  return (
    <main className="app-home has-halftone">
      <div className="app-home__banner">
        <h1>POSE ROYALE</h1>
      </div>
      <div className="app-home__banner app-home__banner--sub">
        <span>Party Tournament!</span>
      </div>
      <div className="app-home__hero">
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          className="app-home__video"
        />
      </div>
      <p className="app-home__subtitle">
        Three CV-powered minigames · 30 seconds each · your webcam is the controller
      </p>
      <button
        onClick={onStart}
        className="tournament-button primary xl app-home__cta"
      >
        🎮 Solo Battle!
      </button>
      <small className="app-home__hint">
        dev · press <kbd>~</kbd> during play for the debug overlay
      </small>
    </main>
  );
}

function CenterNotice({ title, message }: { title: string; message: string }) {
  return (
    <div className="app-backdrop" role="status">
      <div className="stack">
        <h1>{title}</h1>
        <p>{message}</p>
      </div>
    </div>
  );
}

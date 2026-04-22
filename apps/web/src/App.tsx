import { HandTracker } from "@pose-royale/cv";
import type { Player } from "@pose-royale/sdk";
import { BackButton, BackScope, CameraGate } from "@pose-royale/ui";
import { useEffect, useRef, useState } from "react";
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
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
        // Mirror so the player sees themselves in a natural "look at yourself" orientation.
        // Games that consume ctx.hands already account for the mirror when they do `1 - lm.x`.
        transform: "scaleX(-1)",
        zIndex: 0,
        background: "#000",
      }}
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

function CenterNotice({ title, message }: { title: string; message: string }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "grid",
        placeItems: "center",
        padding: "2rem",
        background: "radial-gradient(circle at 50% 30%, #1a1a2e, #0a0a15)",
        color: "white",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.5rem" }}>{title}</h1>
        <p style={{ margin: 0, opacity: 0.75, maxWidth: 420 }}>{message}</p>
      </div>
    </div>
  );
}

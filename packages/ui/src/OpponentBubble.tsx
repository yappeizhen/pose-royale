/**
 * <OpponentBubble /> — the floating picture-in-picture webcam feed of the remote player
 * (plan §1). Handles the three VideoStates the RoomChannel can surface:
 *   • "connecting" — pulsing avatar placeholder
 *   • "ready" — plays the MediaStream muted, mirrored, and rounded
 *   • "unavailable" — small banner explaining the fallback (score ticker only)
 *
 * Kept presentation-only so solo matches + unit tests can mount the wrapper without any
 * WebRTC context.
 */

import { useEffect, useRef } from "react";

export type VideoState = "connecting" | "ready" | "unavailable";

export interface OpponentBubbleProps {
  state: VideoState;
  stream: MediaStream | null;
  name: string;
  color: string;
  /** 0..1 — emitted by the opponent, drives the score ticker badge. */
  score: number | null;
  /** Pixel size of the bubble (diameter). Default 160. */
  size?: number;
  /** Position the bubble. Default top-right. */
  anchor?: "top-right" | "top-left" | "bottom-right" | "bottom-left";
}

export function OpponentBubble({
  state,
  stream,
  name,
  color,
  score,
  size = 160,
  anchor = "top-right",
}: OpponentBubbleProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    // React's declarative `srcObject` handling is imperfect for MediaStream — set it manually
    // so switching streams (e.g. rematch) doesn't leave the old one playing.
    if (el.srcObject !== stream) el.srcObject = stream;
  }, [stream]);

  const anchorStyle = ANCHORS[anchor];

  return (
    <div
      className="opponent-bubble"
      style={{
        position: "fixed",
        width: size,
        height: size,
        borderRadius: "50%",
        overflow: "hidden",
        border: `3px solid ${color}`,
        boxShadow: "var(--shadow-card)",
        background: "var(--color-surface-overlay)",
        zIndex: 40,
        ...anchorStyle,
      }}
      aria-label={`Opponent ${name}, ${state}`}
    >
      {state === "ready" && stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: "scaleX(-1)",
          }}
        />
      ) : (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "grid",
            placeItems: "center",
            fontFamily: "var(--font-display, system-ui)",
            fontSize: size * 0.3,
            color: "var(--color-fg)",
            animation: state === "connecting" ? "pose-pulse 1.4s ease-in-out infinite" : "none",
          }}
        >
          {name.slice(0, 1).toUpperCase()}
        </div>
      )}

      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          padding: "6px 10px",
          background: "linear-gradient(transparent, rgba(0,0,0,0.75))",
          color: "var(--color-fg)",
          fontSize: 13,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ fontWeight: 600 }}>{name}</span>
        {score !== null ? (
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{Math.round(score * 1000)}</span>
        ) : null}
      </div>

      {state === "unavailable" ? (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            padding: "3px 8px",
            fontSize: 10,
            textAlign: "center",
            background: "rgba(255,84,112,0.85)",
            color: "var(--color-fg)",
            letterSpacing: 0.5,
            textTransform: "uppercase",
          }}
        >
          Video offline
        </div>
      ) : null}
    </div>
  );
}

const ANCHORS = {
  "top-right": { top: 16, right: 16 },
  "top-left": { top: 16, left: 16 },
  "bottom-right": { bottom: 16, right: 16 },
  "bottom-left": { bottom: 16, left: 16 },
} as const satisfies Record<string, React.CSSProperties>;

import { useCallback, useEffect, useRef, useState } from "react";

export interface CameraGateProps {
  children: (stream: MediaStream) => React.ReactNode;
  /** Override the getUserMedia call — handy for tests. */
  requestStream?: () => Promise<MediaStream>;
}

type GateState =
  | { status: "idle" }
  | { status: "requesting" }
  | { status: "granted"; stream: MediaStream }
  | { status: "denied"; kind: CameraErrorKind; message: string };

type CameraErrorKind =
  | "permission-denied"
  | "no-camera"
  | "in-use"
  | "insecure-context"
  | "unsupported"
  | "unknown";

const defaultRequest = (): Promise<MediaStream> =>
  navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });

// Translate DOMException names into a friendly kind + message. Covers the vast majority of real
// browser errors we'll hit: denied permission, no camera attached, camera busy in Zoom/Teams,
// insecure http:// context, and old browsers.
function classifyError(err: unknown): { kind: CameraErrorKind; message: string } {
  if (!window.isSecureContext && location.protocol !== "https:" && location.hostname !== "localhost") {
    return {
      kind: "insecure-context",
      message: "Pose Royale needs to be served over HTTPS to access your webcam.",
    };
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return {
      kind: "unsupported",
      message: "Your browser doesn't support webcam access. Try the latest Chrome, Edge, or Safari.",
    };
  }
  const name = err instanceof Error ? err.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return {
        kind: "permission-denied",
        message:
          "Camera access was denied. Click the camera icon in your address bar, allow access, and retry.",
      };
    case "NotFoundError":
    case "OverconstrainedError":
      return { kind: "no-camera", message: "No webcam detected. Plug one in and retry." };
    case "NotReadableError":
    case "AbortError":
      return {
        kind: "in-use",
        message:
          "Your camera is busy — it's probably in use by Zoom, Teams, or another tab. Close those and retry.",
      };
    default:
      return {
        kind: "unknown",
        message: err instanceof Error ? err.message : "Something went wrong accessing your camera.",
      };
  }
}

/**
 * Blocks the app until a usable webcam stream is available.
 * The stream is passed to `children` so the shell can hang onto it for MediaPipe + WebRTC.
 * On failure, shows a friendly recovery screen — there is no escape hatch into a match without a camera.
 */
export function CameraGate({ children, requestStream = defaultRequest }: CameraGateProps) {
  const [state, setState] = useState<GateState>({ status: "idle" });
  const streamRef = useRef<MediaStream | null>(null);

  const request = useCallback(async () => {
    setState({ status: "requesting" });
    try {
      const stream = await requestStream();
      streamRef.current = stream;
      setState({ status: "granted", stream });
    } catch (err) {
      const { kind, message } = classifyError(err);
      setState({ status: "denied", kind, message });
    }
  }, [requestStream]);

  useEffect(() => {
    // Kick the camera request once on mount. The setState inside `request()` is the whole point
    // of this effect (we're synchronizing React state with the browser's camera permission),
    // so the React 19 set-state-in-effect lint rule's concern doesn't apply here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void request();
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [request]);

  if (state.status === "granted") return <>{children(state.stream)}</>;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Camera access required"
      className="app-backdrop"
    >
      <div className="stack">
        <div aria-hidden style={{ fontSize: "3.5rem" }}>
          📸
        </div>
        <h1>
          {state.status === "requesting"
            ? "Requesting camera…"
            : "Pose Royale needs your camera"}
        </h1>
        {state.status === "denied" && <p>{state.message}</p>}
        {state.status === "denied" && (
          <button type="button" onClick={request} className="tournament-button primary lg">
            Try again
          </button>
        )}
        {state.status === "requesting" && (
          <p style={{ color: "var(--color-fg-subtle)" }}>Click “Allow” on the browser prompt.</p>
        )}
      </div>
    </div>
  );
}

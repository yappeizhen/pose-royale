/**
 * WebRTC peer helper (plan §5 bubble feed). We use Firebase RTDB as the signaling
 * channel — one directed pair per side — and a single RTCPeerConnection per room. The
 * outer shell (apps/web) passes in the already-running local MediaStream from <CameraGate />;
 * we don't call getUserMedia here (games + multiplayer are both lint-banned from touching it).
 *
 * Flow:
 *   1. Both peers attach their local tracks.
 *   2. The peer with the lex-smaller playerId is "polite" and waits for an offer.
 *      The other one (lex-greater) creates the offer on connect.
 *   3. SDP answers + ICE candidates land in `/signaling/<from>-<to>/…`. Both sides listen
 *      to their incoming-pair path.
 *   4. The inbound track is surfaced as a MediaStream + a VideoState.
 *
 * This is deliberately tiny — renegotiation, simulcast, DTLS fingerprinting, etc. are out of
 * scope for the Gauntlet MVP. We just need the opponent bubble to come up.
 */

import {
  onChildAdded,
  onValue,
  push,
  ref,
  remove,
  set,
  type Database,
} from "firebase/database";
import { paths, type SignalingEnvelope } from "@pose-royale/firebase";
import type { VideoState } from "@pose-royale/sdk";

export interface PeerOptions {
  db: Database;
  roomId: string;
  localPlayerId: string;
  remotePlayerId: string;
  localStream: MediaStream | null;
  iceServers?: RTCIceServer[];
  onState(state: VideoState): void;
  onRemoteStream(stream: MediaStream | null): void;
}

export interface PeerHandle {
  close(): Promise<void>;
  replaceLocalStream(stream: MediaStream | null): Promise<void>;
}

const DEFAULT_ICE: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

export function connectPeer(opts: PeerOptions): PeerHandle {
  const {
    db,
    roomId,
    localPlayerId,
    remotePlayerId,
    localStream,
    onState,
    onRemoteStream,
  } = opts;

  const pc = new RTCPeerConnection({ iceServers: opts.iceServers ?? DEFAULT_ICE });
  const isOfferer = localPlayerId > remotePlayerId;
  const remoteStream = new MediaStream();
  onState("connecting");

  // Forward inbound tracks into the single MediaStream we hand to the UI.
  pc.ontrack = (event) => {
    for (const track of event.streams[0]?.getTracks() ?? [event.track]) {
      if (!remoteStream.getTracks().includes(track)) remoteStream.addTrack(track);
    }
    onRemoteStream(remoteStream);
  };

  pc.onconnectionstatechange = () => {
    switch (pc.connectionState) {
      case "connected":
        onState("ready");
        break;
      case "failed":
      case "disconnected":
      case "closed":
        onState("unavailable");
        break;
      default:
        break;
    }
  };

  const outgoingPair = `${localPlayerId}-${remotePlayerId}`;
  const incomingPair = `${remotePlayerId}-${localPlayerId}`;

  // Push local tracks in.
  if (localStream) {
    for (const track of localStream.getTracks()) pc.addTrack(track, localStream);
  }

  // Pipe our ICE candidates out to the signaling path. Each candidate gets a unique push id.
  pc.onicecandidate = (event) => {
    if (!event.candidate) return;
    const iceRef = push(ref(db, `${paths.roomSignaling(roomId, outgoingPair)}/ice`));
    const envelope: SignalingEnvelope = {
      kind: "ice",
      candidate: event.candidate.candidate,
      sdpMid: event.candidate.sdpMid,
      sdpMLineIndex: event.candidate.sdpMLineIndex,
      at: Date.now(),
    };
    void set(iceRef, envelope);
  };

  // Listen for incoming ICE from the other side.
  const stopIce = onChildAdded(
    ref(db, `${paths.roomSignaling(roomId, incomingPair)}/ice`),
    (snap) => {
      const env = snap.val() as SignalingEnvelope | null;
      if (!env || env.kind !== "ice") return;
      // Unknown yet-to-arrive SDP will stash the candidate until setRemoteDescription completes.
      void pc
        .addIceCandidate({
          candidate: env.candidate,
          sdpMid: env.sdpMid,
          sdpMLineIndex: env.sdpMLineIndex,
        })
        .catch(() => {
          // Swallow — a stale candidate after close is harmless.
        });
    },
  );

  // Offer/answer exchange. Each side watches the other's offer/answer slot.
  const stopOffer = onValue(
    ref(db, `${paths.roomSignaling(roomId, incomingPair)}/offer`),
    (snap) => {
      const env = snap.val() as SignalingEnvelope | null;
      if (!env || env.kind !== "offer") return;
      if (isOfferer) return; // Shouldn't happen, but guard against racing both sides creating.
      void (async () => {
        await pc.setRemoteDescription({ type: "offer", sdp: env.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        const answerEnv: SignalingEnvelope = {
          kind: "answer",
          sdp: answer.sdp ?? "",
          at: Date.now(),
        };
        await set(ref(db, `${paths.roomSignaling(roomId, outgoingPair)}/answer`), answerEnv);
      })();
    },
  );

  const stopAnswer = onValue(
    ref(db, `${paths.roomSignaling(roomId, incomingPair)}/answer`),
    (snap) => {
      const env = snap.val() as SignalingEnvelope | null;
      if (!env || env.kind !== "answer") return;
      if (!isOfferer) return;
      void pc.setRemoteDescription({ type: "answer", sdp: env.sdp }).catch(() => {
        // No-op: common when remote hasn't published yet.
      });
    },
  );

  // Kick off the offer if we're the lex-greater peer.
  if (isOfferer) {
    void (async () => {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const envelope: SignalingEnvelope = { kind: "offer", sdp: offer.sdp ?? "", at: Date.now() };
      await set(ref(db, `${paths.roomSignaling(roomId, outgoingPair)}/offer`), envelope);
    })();
  }

  return {
    async close() {
      stopIce();
      stopOffer();
      stopAnswer();
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.close();
      for (const t of remoteStream.getTracks()) remoteStream.removeTrack(t);
      onRemoteStream(null);
      onState("unavailable");
      // Best-effort cleanup of the signaling tree so rematches start fresh.
      await Promise.allSettled([
        remove(ref(db, paths.roomSignaling(roomId, outgoingPair))),
      ]);
    },
    async replaceLocalStream(stream) {
      const senders = pc.getSenders();
      if (!stream) {
        for (const s of senders) await s.replaceTrack(null).catch(() => {});
        return;
      }
      const tracks = stream.getTracks();
      for (const sender of senders) {
        const kind = sender.track?.kind;
        const next = tracks.find((t) => t.kind === kind);
        if (next) await sender.replaceTrack(next).catch(() => {});
      }
      // Add any missing tracks (e.g. audio enabled mid-session).
      for (const t of tracks) {
        if (!senders.some((s) => s.track?.id === t.id)) pc.addTrack(t, stream);
      }
    },
  };
}

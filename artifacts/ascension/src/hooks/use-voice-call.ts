/**
 * One peer-to-peer voice call with another student.
 *
 * The audio goes browser to browser and never reaches our server. What the
 * server carries is the handshake: an SDP offer, an SDP answer and a handful of
 * ICE candidates, posted to and polled from `practice_signals`.
 *
 * WHY POLLING AND NOT A WEBSOCKET
 * ────────────────────────────────
 * There is no WebSocket anywhere in this codebase, and adding one buys a second
 * authentication path and a sticky-session problem for what is about twenty
 * small messages per call. Polling costs a second or two of setup latency and
 * nothing else — once the connection is up, no signalling happens at all.
 *
 * WHY A CALL CAN FAIL AND SAY SO
 * ───────────────────────────────
 * Without a TURN relay, two browsers behind strict NAT — mobile networks and
 * corporate firewalls, most often — cannot reach each other whatever the
 * signalling does. That is roughly one connection in five. This hook gives the
 * handshake a deadline and then reports `failed`, because the alternative is a
 * screen that says "connecting…" forever and a student who thinks the app is
 * broken.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { practiceApi, type SignalMessage } from "@/lib/practice-api";

export type CallPhase =
  | "idle"
  | "requesting-mic"
  | "mic-denied"
  | "connecting"
  | "connected"
  | "failed"
  | "ended";

interface StartOptions {
  sessionId: number;
  /** True for the side that makes the offer. Decided by the server. */
  isCaller: boolean;
}

const POLL_INTERVAL_MS = 1000;

export function useVoiceCall() {
  const [phase, setPhase] = useState<CallPhase>("idle");
  const [muted, setMuted] = useState(false);
  /** True when the server has no TURN relay configured — shown if a call fails. */
  const [turnAvailable, setTurnAvailable] = useState(true);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const deadlineRef = useRef<number | null>(null);
  const lastSignalIdRef = useRef(0);
  const sessionRef = useRef<number | null>(null);
  const stoppedRef = useRef(false);
  /** ICE candidates that arrived before the remote description was set. */
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);

  const stopEverything = useCallback(() => {
    stoppedRef.current = true;
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    if (audioRef.current) {
      audioRef.current.srcObject = null;
    }
    sessionRef.current = null;
    lastSignalIdRef.current = 0;
    pendingIceRef.current = [];
    deadlineRef.current = null;
  }, []);

  /** Hang up. Immediate and unilateral — nobody is asked to confirm. */
  const hangUp = useCallback(() => {
    stopEverything();
    setPhase("ended");
    setMuted(false);
  }, [stopEverything]);

  useEffect(() => stopEverything, [stopEverything]);

  const applySignal = useCallback(async (message: SignalMessage) => {
    const pc = pcRef.current;
    if (!pc) return;

    if (message.kind === "offer") {
      await pc.setRemoteDescription(message.payload as RTCSessionDescriptionInit);
      for (const candidate of pendingIceRef.current.splice(0)) {
        await pc.addIceCandidate(candidate).catch(() => {});
      }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await practiceApi.sendSignal(sessionRef.current!, "answer", answer);
      return;
    }

    if (message.kind === "answer") {
      if (pc.signalingState === "have-local-offer") {
        await pc.setRemoteDescription(message.payload as RTCSessionDescriptionInit);
        for (const candidate of pendingIceRef.current.splice(0)) {
          await pc.addIceCandidate(candidate).catch(() => {});
        }
      }
      return;
    }

    if (message.kind === "ice") {
      const candidate = message.payload as RTCIceCandidateInit;
      // A candidate that arrives before the description it belongs to is not an
      // error; it is the normal order of things on a slow poll. Hold it.
      if (!pc.remoteDescription) {
        pendingIceRef.current.push(candidate);
      } else {
        await pc.addIceCandidate(candidate).catch(() => {});
      }
    }
  }, []);

  const start = useCallback(
    async ({ sessionId, isCaller }: StartOptions) => {
      stoppedRef.current = false;
      sessionRef.current = sessionId;
      lastSignalIdRef.current = 0;
      pendingIceRef.current = [];
      setPhase("requesting-mic");

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
      } catch {
        // Denied, or no microphone. Either way there is no call to be had, and
        // saying so is more use than retrying.
        setPhase("mic-denied");
        return;
      }
      localStreamRef.current = stream;

      let pc: RTCPeerConnection;
      let connectTimeoutMs = 30_000;
      try {
        const config = await practiceApi.iceServers();
        setTurnAvailable(config.hasTurn);
        connectTimeoutMs = config.connectTimeoutMs;
        pc = new RTCPeerConnection({ iceServers: config.iceServers });
      } catch {
        // A misconfigured ICE server list throws here rather than failing to
        // connect later. Either way the student gets the same honest screen
        // instead of a spinner that never resolves.
        stream.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
        setPhase("failed");
        return;
      }

      pcRef.current = pc;
      setPhase("connecting");
      deadlineRef.current = Date.now() + connectTimeoutMs;

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      pc.ontrack = (event) => {
        if (audioRef.current && event.streams[0]) {
          audioRef.current.srcObject = event.streams[0];
          void audioRef.current.play().catch(() => {
            // Autoplay policy. The element is on the page with controls, so the
            // student can start it themselves.
          });
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate && sessionRef.current) {
          void practiceApi
            .sendSignal(sessionRef.current, "ice", event.candidate.toJSON())
            .catch(() => {});
        }
      };

      pc.onconnectionstatechange = () => {
        if (stoppedRef.current) return;
        if (pc.connectionState === "connected") {
          deadlineRef.current = null;
          setPhase("connected");
        } else if (pc.connectionState === "failed") {
          setPhase("failed");
        } else if (pc.connectionState === "disconnected") {
          // Often temporary — a phone switching networks. Give ICE a chance to
          // recover before declaring the call dead.
          deadlineRef.current = Date.now() + 10_000;
        }
      };

      if (isCaller) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await practiceApi.sendSignal(sessionId, "offer", offer);
      }

      pollTimerRef.current = window.setInterval(async () => {
        if (stoppedRef.current) return;

        if (deadlineRef.current !== null && Date.now() > deadlineRef.current) {
          deadlineRef.current = null;
          setPhase("failed");
          return;
        }

        try {
          const { signals } = await practiceApi.readSignals(
            sessionId,
            lastSignalIdRef.current,
          );
          for (const message of signals) {
            lastSignalIdRef.current = Math.max(lastSignalIdRef.current, message.id);
            await applySignal(message);
          }
        } catch {
          // A dropped poll is not a dropped call. The next one catches up,
          // because the cursor is the highest id already seen.
        }
      }, POLL_INTERVAL_MS);
    },
    [applySignal],
  );

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !muted;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !next;
    });
    setMuted(next);
  }, [muted]);

  const reset = useCallback(() => {
    stopEverything();
    setPhase("idle");
    setMuted(false);
  }, [stopEverything]);

  return { phase, muted, turnAvailable, audioRef, start, hangUp, toggleMute, reset };
}

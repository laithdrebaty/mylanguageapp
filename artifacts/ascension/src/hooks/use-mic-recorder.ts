import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderStatus = "idle" | "recording" | "done" | "unsupported" | "denied";

/**
 * Record one audio clip from the microphone.
 *
 * Shared by the lesson runner and the quiz runner so speaking works the same
 * way in both — including the detail that matters most for upload: the blob
 * keeps whatever MIME type the browser actually produced. Safari records
 * mp4/aac, not webm, and a clip labelled with the wrong type fails the
 * presigned PUT because the content type is part of the signature.
 */
export function useMicRecorder() {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [durationSec, setDurationSec] = useState(0);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const playbackUrlRef = useRef<string | null>(null);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setStatus("unsupported");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstop = () => {
        const type = mr.mimeType || "audio/webm";
        const recorded = new Blob(chunksRef.current, { type });
        const url = URL.createObjectURL(recorded);
        playbackUrlRef.current = url;
        setBlob(recorded);
        setPlaybackUrl(url);
        setDurationSec(Math.round((Date.now() - startTimeRef.current) / 1000));
        setStatus("done");
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      };

      mr.start();
      mediaRef.current = mr;
      startTimeRef.current = Date.now();
      setStatus("recording");
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : "";
      setStatus(
        name === "NotAllowedError" || name === "PermissionDeniedError"
          ? "denied"
          : "unsupported",
      );
    }
  }, []);

  const stop = useCallback(() => {
    mediaRef.current?.stop();
  }, []);

  const reset = useCallback(() => {
    if (playbackUrlRef.current) URL.revokeObjectURL(playbackUrlRef.current);
    playbackUrlRef.current = null;
    setPlaybackUrl(null);
    setBlob(null);
    setDurationSec(0);
    setStatus("idle");
    chunksRef.current = [];
  }, []);

  // Leaving the page mid-recording must release the microphone, or the browser
  // keeps showing the recording indicator and the device stays held.
  useEffect(() => {
    return () => {
      mediaRef.current?.state === "recording" && mediaRef.current.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (playbackUrlRef.current) URL.revokeObjectURL(playbackUrlRef.current);
    };
  }, []);

  return { status, durationSec, playbackUrl, blob, start, stop, reset };
}

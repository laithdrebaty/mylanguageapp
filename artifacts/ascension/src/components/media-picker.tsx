/**
 * Attach a media asset to a content block: upload a new file, pick one already
 * in the library, or record straight from the microphone.
 *
 * The audio fields in the lesson and quiz editors used to be bare text inputs
 * expecting a storage key typed by hand, while the only real upload control in
 * the app lived on the Media page — so an author could see an audio field and
 * have no way to put audio in it.
 *
 * Stores the asset's storage key (what `content_blocks.audio_note` /
 * `example_audio` hold), and reports the numeric id alongside it for callers
 * that also track `reference_media_id`.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { cmsApi } from "@/lib/cms-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useMicRecorder } from "@/hooks/use-mic-recorder";
import {
  Upload, Library, Mic, Square, Play, Pause, X, Loader2, Check,
} from "lucide-react";

type Accept = "audio" | "image" | "any";

const ACCEPT_ATTR: Record<Accept, string> = {
  audio: "audio/*",
  image: "image/*",
  any: "audio/*,image/*,video/*",
};

export interface MediaPickerProps {
  /** Current storage key, or null/"" when nothing is attached. */
  value?: string | null;
  /** Called with the new key and the asset id when one is chosen or cleared. */
  onChange: (key: string | null, mediaId: number | null) => void;
  /** Which file types to offer. Also filters the library list. */
  accept?: Accept;
  /** Allow recording from the microphone. Only meaningful for audio. */
  allowRecording?: boolean;
  label?: string;
  disabled?: boolean;
}

export function MediaPicker({
  value,
  onChange,
  accept = "audio",
  allowRecording = true,
  label,
  disabled = false,
}: MediaPickerProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"idle" | "library" | "record">("idle");
  const [stage, setStage] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const mic = useMicRecorder();

  const fail = (e: any) =>
    toast({
      title: "Upload failed",
      description:
        e?.status === 503
          ? "Media storage is not configured on this server."
          : e?.message ?? "Unknown error",
      variant: "destructive",
    });

  const attach = (key: string, mediaId: number) => {
    onChange(key, mediaId);
    setMode("idle");
    setPreviewUrl(null);
    toast({ title: "Media attached" });
  };

  const uploadFile = (file: File) => cmsApi.media.upload(file, (s) => setStage(s));

  // ── Upload a file ────────────────────────────────────────────────────────
  const uploadMut = useMutation({
    mutationFn: uploadFile,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["cms-media"] });
      setStage(null);
      attach(res.key, res.mediaId);
    },
    onError: (e) => { setStage(null); fail(e); },
  });

  // ── Upload a microphone recording ────────────────────────────────────────
  const recordMut = useMutation({
    mutationFn: (blob: Blob) => {
      const ext = blob.type.includes("webm") ? "webm" : "m4a";
      const file = new File([blob], `recording-${Date.now()}.${ext}`, {
        type: blob.type || "audio/webm",
      });
      return uploadFile(file);
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["cms-media"] });
      setStage(null);
      mic.reset();
      attach(res.key, res.mediaId);
    },
    onError: (e) => { setStage(null); fail(e); },
  });

  // stop() resolves through state, not a return value: upload once a blob lands.
  useEffect(() => {
    if (mic.status === "done" && mic.blob && !recordMut.isPending && mode === "record") {
      recordMut.mutate(mic.blob);
    }
  }, [mic.status, mic.blob]);

  // ── The existing library ─────────────────────────────────────────────────
  const { data: library, isLoading: libraryLoading } = useQuery({
    queryKey: ["cms-media", 1],
    queryFn: () => cmsApi.media.list(1),
    enabled: mode === "library",
  });

  const items: any[] = (library as any)?.items ?? [];
  const filtered =
    accept === "any"
      ? items
      : items.filter((m) => (m.mimeType ?? "").startsWith(`${accept}/`));

  // ── Preview the attached asset ───────────────────────────────────────────
  const togglePreview = async () => {
    if (playing) {
      audioRef.current?.pause();
      setPlaying(false);
      return;
    }
    try {
      let url = previewUrl;
      if (!url) {
        // The key alone is not playable; the server signs a short-lived URL.
        const match = items.find((m) => m.key === value);
        if (!match) {
          toast({ description: "Save the block, then preview from the Media page." });
          return;
        }
        url = (await cmsApi.media.playbackUrl(match.id)).url;
        setPreviewUrl(url);
      }
      const el = audioRef.current ?? new Audio();
      audioRef.current = el;
      el.src = url!;
      el.onended = () => setPlaying(false);
      await el.play();
      setPlaying(true);
    } catch (e: any) {
      toast({ title: "Preview failed", description: e?.message, variant: "destructive" });
    }
  };

  useEffect(() => () => { audioRef.current?.pause(); }, []);

  const busy = uploadMut.isPending || recordMut.isPending || disabled;

  // getUserMedia only exists on a secure origin: HTTPS, or localhost. Served
  // over plain HTTP from an IP the API is simply absent, so the button would
  // do nothing at all — say why instead of offering a control that cannot work.
  const canRecord =
    typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  return (
    <div className="space-y-2">
      {label && <div className="text-xs text-gray-500">{label}</div>}

      {/* Attached state */}
      {value ? (
        <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-2">
          <Check className="h-4 w-4 shrink-0 text-emerald-600" />
          <span className="flex-1 truncate font-mono text-xs text-gray-700">{value}</span>
          {accept === "audio" && (
            <Button type="button" size="sm" variant="ghost" onClick={togglePreview} disabled={disabled}>
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
          )}
          <Button
            type="button" size="sm" variant="ghost" disabled={disabled}
            onClick={() => { onChange(null, null); setPreviewUrl(null); }}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT_ATTR[accept]}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) uploadMut.mutate(f);
            }}
          />
          <Button type="button" size="sm" variant="outline" disabled={busy}
            onClick={() => fileInput.current?.click()}>
            {busy && stage ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />}
            {stage ? `${stage}…` : "Upload file"}
          </Button>

          <Button type="button" size="sm" variant="outline" disabled={busy}
            onClick={() => setMode(mode === "library" ? "idle" : "library")}>
            <Library className="mr-1 h-4 w-4" /> Choose existing
          </Button>

          {allowRecording && accept === "audio" && canRecord && (
            <Button type="button" size="sm" variant="outline" disabled={busy}
              onClick={() => setMode(mode === "record" ? "idle" : "record")}>
              <Mic className="mr-1 h-4 w-4" /> Record
            </Button>
          )}

          {allowRecording && accept === "audio" && !canRecord && (
            <span className="self-center text-xs text-gray-400">
              Recording needs HTTPS or localhost — upload a file instead.
            </span>
          )}
        </div>
      )}

      {/* Library browser */}
      {mode === "library" && !value && (
        <div className="max-h-56 overflow-y-auto rounded-md border bg-white">
          {libraryLoading ? (
            <div className="p-3 text-xs text-gray-400">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-3 text-xs text-gray-400">Nothing uploaded yet.</div>
          ) : (
            filtered.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => attach(m.key, m.id)}
                className="flex w-full items-center gap-2 border-b px-3 py-2 text-left last:border-b-0 hover:bg-gray-50"
              >
                <span className="flex-1 truncate text-xs">{m.originalName ?? m.key}</span>
                <span className="shrink-0 text-[10px] uppercase text-gray-400">{m.mimeType}</span>
              </button>
            ))
          )}
        </div>
      )}

      {/* Microphone */}
      {mode === "record" && !value && (
        <div className="flex items-center gap-2 rounded-md border bg-white p-3">
          {mic.status === "recording" ? (
            <Button type="button" size="sm" variant="destructive" onClick={() => mic.stop()}>
              <Square className="mr-1 h-4 w-4" /> Stop
            </Button>
          ) : (
            <Button type="button" size="sm" disabled={busy} onClick={() => mic.start()}>
              <Mic className="mr-1 h-4 w-4" /> Start recording
            </Button>
          )}
          <span className="text-xs text-gray-500">
            {mic.status === "recording" ? "Recording…" : "Records straight into the library."}
          </span>
        </div>
      )}
    </div>
  );
}

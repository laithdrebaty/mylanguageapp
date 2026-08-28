import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetLesson,
  useCompleteLesson,
  useStartLesson,
  useSubmitLessonActivity,
  getGetDashboardQueryKey,
  getGetLevelsQueryKey,
  getGetLevelQueryKey,
  getGetLessonQueryKey,
  getGetLessonsQueryKey,
  getGetLessonProgressQueryKey,
} from "@workspace/api-client-react";
import type {
  ContentBlock,
  LessonActivityResult,
  LessonProgress,
  LessonCompletionError,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowRight,
  Volume2,
  Mic,
  CheckCircle2,
  XCircle,
  PlayCircle,
  Loader2,
  StopCircle,
  Play,
  Square,
  AlertCircle,
} from "lucide-react";

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────
function genClientId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Returns true if the string looks like a usable URL (http/https). */
function isUsableUrl(url?: string | null): boolean {
  if (!url) return false;
  return url.startsWith("http://") || url.startsWith("https://");
}

// ──────────────────────────────────────────────────────────────────────
// Per-block state
// ──────────────────────────────────────────────────────────────────────
interface BlockState {
  submitted: boolean;
  submitting: boolean;
  result: LessonActivityResult | null;
  // MCQ
  selectedOptionId?: string;
  // Open-ended
  responseText?: string;
  // Speaking / pronunciation
  recordingDurationSeconds?: number;
  hasRecording?: boolean;
}

// ──────────────────────────────────────────────────────────────────────
// Microphone recorder hook
// ──────────────────────────────────────────────────────────────────────
type RecorderStatus = "idle" | "recording" | "done" | "unsupported" | "denied";

function useMicRecorder() {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [durationSec, setDurationSec] = useState(0);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("unsupported");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const url = URL.createObjectURL(blob);
        setPlaybackUrl(url);
        const elapsed = Math.round((Date.now() - startTimeRef.current) / 1000);
        setDurationSec(elapsed);
        setStatus("done");
        stream.getTracks().forEach(t => t.stop());
      };
      mr.start();
      mediaRef.current = mr;
      startTimeRef.current = Date.now();
      setStatus("recording");
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setStatus("denied");
      } else {
        setStatus("unsupported");
      }
    }
  }, []);

  const stop = useCallback(() => {
    mediaRef.current?.stop();
  }, []);

  const reset = useCallback(() => {
    if (playbackUrl) URL.revokeObjectURL(playbackUrl);
    setPlaybackUrl(null);
    setDurationSec(0);
    setStatus("idle");
    chunksRef.current = [];
  }, [playbackUrl]);

  return { status, durationSec, playbackUrl, start, stop, reset };
}

// ──────────────────────────────────────────────────────────────────────
// Block header (title, instructions, required badge, duration)
// ──────────────────────────────────────────────────────────────────────
function BlockHeader({ block }: { block: ContentBlock }) {
  const title = block.titleAr || block.title;
  const instructions = block.instructionsAr || block.instructions;
  return (
    <div className="space-y-2 mb-6">
      {title && (
        <h2 className="text-xl font-bold text-foreground">{title}</h2>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        {block.isRequired ? (
          <Badge variant="default" className="text-xs">مطلوب</Badge>
        ) : (
          <Badge variant="secondary" className="text-xs">اختياري</Badge>
        )}
        {block.estimatedMinutes && (
          <span className="text-xs text-muted-foreground">{block.estimatedMinutes} دقيقة</span>
        )}
      </div>
      {instructions && (
        <p className="text-sm text-muted-foreground leading-relaxed">{instructions}</p>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Audio widget
// ──────────────────────────────────────────────────────────────────────
function AudioWidget({ url, label }: { url: string; label?: string }) {
  return (
    <div className="mt-4 space-y-1">
      {label && <p className="text-xs text-muted-foreground">{label}</p>}
      <audio controls className="w-full rounded-lg" src={url} />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// MCQ block
// ──────────────────────────────────────────────────────────────────────
function McqBlock({
  block,
  state,
  onSelect,
}: {
  block: ContentBlock;
  state: BlockState;
  onSelect: (optionId: string) => void;
}) {
  const result = state.result;

  return (
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
      <BlockHeader block={block} />

      <div className="p-6 bg-secondary rounded-2xl text-center space-y-4">
        {block.questionAr && (
          <h3 className="text-lg font-medium text-muted-foreground">{block.questionAr}</h3>
        )}
        {block.question && (
          <h2 className="text-2xl font-bold font-serif" dir="ltr">{block.question}</h2>
        )}
      </div>

      {isUsableUrl(block.audioUrl) && <AudioWidget url={block.audioUrl!} label={block.audioNote ?? undefined} />}

      <div className="space-y-3" dir="ltr">
        {(block.options ?? []).map((option) => {
          const isSelected = state.selectedOptionId === option.id;
          const hasResult = !!result;
          const isCorrect = hasResult && result.correct === true && isSelected;
          const isWrong = hasResult && result.correct === false && isSelected;
          const isCorrectUnselected = hasResult && result.correct === false && !isSelected;
          // We don't know which option is actually correct from the API (no correctOptionId exposed),
          // so we only show feedback on the selected option.
          let cls = "border-border hover:border-primary/40 bg-card";
          if (!hasResult && isSelected) cls = "border-primary bg-primary/5 shadow-sm";
          if (isCorrect) cls = "border-emerald-500 bg-emerald-50";
          if (isWrong) cls = "border-rose-500 bg-rose-50";
          if (hasResult && !isSelected) cls = "border-border opacity-60 bg-card";

          return (
            <button
              key={option.id}
              disabled={state.submitted || state.submitting}
              onClick={() => onSelect(option.id)}
              className={`w-full p-4 rounded-xl border-2 text-left transition-all duration-200 flex items-center justify-between ${cls}`}
            >
              <div>
                <span className="text-lg font-medium text-foreground">{option.text}</span>
                {option.textAr && (
                  <span className="block text-sm text-muted-foreground" dir="rtl">{option.textAr}</span>
                )}
              </div>
              {isCorrect && <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />}
              {isWrong && <XCircle className="h-5 w-5 text-rose-600 shrink-0" />}
            </button>
          );
        })}
      </div>

      {result && (result.explanationAr || result.explanation) && (
        <div className={`p-4 rounded-xl border ${result.correct ? "bg-emerald-50 border-emerald-200" : "bg-rose-50 border-rose-200"}`}>
          <p className="text-sm font-medium">
            {result.correct ? "✅ إجابة صحيحة" : "❌ إجابة خاطئة"}
          </p>
          {(result.explanationAr || result.explanation) && (
            <p className="text-sm mt-1 text-muted-foreground">
              {result.explanationAr || result.explanation}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Open-ended block
// ──────────────────────────────────────────────────────────────────────
function OpenEndedBlock({
  block,
  state,
  onChange,
}: {
  block: ContentBlock;
  state: BlockState;
  onChange: (text: string) => void;
}) {
  return (
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
      <BlockHeader block={block} />

      {block.contentAr && (
        <p className="text-lg leading-relaxed text-foreground" dir="rtl">{block.contentAr}</p>
      )}
      {block.content && (
        <div className="p-6 bg-secondary/50 rounded-2xl border border-border">
          <p className="text-xl leading-relaxed font-serif text-foreground" dir="ltr">{block.content}</p>
        </div>
      )}
      {block.promptAr && (
        <p className="text-base font-medium text-foreground">{block.promptAr}</p>
      )}
      {block.prompt && (
        <p className="text-sm text-muted-foreground" dir="ltr">{block.prompt}</p>
      )}

      {isUsableUrl(block.audioUrl) && <AudioWidget url={block.audioUrl!} label={block.audioNote ?? undefined} />}

      <textarea
        className="w-full border rounded-xl p-4 text-foreground bg-background resize-none min-h-[120px] focus:outline-none focus:ring-2 focus:ring-primary/40"
        placeholder="اكتب إجابتك هنا..."
        value={state.responseText ?? ""}
        disabled={state.submitted}
        onChange={(e) => onChange(e.target.value)}
        dir="ltr"
      />

      {state.result && (state.result.explanationAr || state.result.explanation) && (
        <div className="p-4 rounded-xl border bg-secondary/50">
          <p className="text-sm text-muted-foreground">
            {state.result.explanationAr || state.result.explanation}
          </p>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Speaking / pronunciation block (with MediaRecorder)
// ──────────────────────────────────────────────────────────────────────
function SpeakingBlock({
  block,
  state,
  onRecordingDone,
}: {
  block: ContentBlock;
  state: BlockState;
  onRecordingDone: (durationSec: number) => void;
}) {
  const mic = useMicRecorder();

  // Propagate duration when recording is done
  useEffect(() => {
    if (mic.status === "done" && mic.durationSec > 0) {
      onRecordingDone(mic.durationSec);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mic.status, mic.durationSec]);

  return (
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
      <BlockHeader block={block} />

      {block.promptAr && (
        <div className="text-center space-y-2 mb-4">
          <h3 className="text-xl font-bold text-foreground">{block.promptAr}</h3>
        </div>
      )}
      {block.prompt && (
        <p className="text-muted-foreground text-center" dir="ltr">{block.prompt}</p>
      )}
      {block.contentAr && (
        <p className="text-lg leading-relaxed text-foreground text-center" dir="rtl">{block.contentAr}</p>
      )}
      {block.content && (
        <div className="p-6 bg-secondary/50 rounded-2xl border text-center">
          <p className="text-2xl font-bold font-serif" dir="ltr">{block.content}</p>
        </div>
      )}

      {isUsableUrl(block.exampleAudio) && (
        <AudioWidget url={block.exampleAudio!} label="استمع للمثال الصوتي" />
      )}
      {isUsableUrl(block.audioUrl) && !isUsableUrl(block.exampleAudio) && (
        <AudioWidget url={block.audioUrl!} label={block.audioNote ?? undefined} />
      )}

      {/* Disclaimer — Arabic, explicit about no AI scoring */}
      <div className="text-xs text-muted-foreground bg-amber-50 border border-amber-200 rounded-lg p-3 leading-relaxed">
        ملاحظة: لا يتم تقييم التسجيل بالذكاء الاصطناعي في الوقت الحالي. التسجيل محلي فقط ولن يُرفع للسيرفر حتى يتوفر نظام تخزين الصوت الآمن.
      </div>

      <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-border rounded-3xl bg-secondary/20 gap-4">
        {mic.status === "idle" && (
          <button
            onClick={mic.start}
            disabled={state.submitted}
            className="h-24 w-24 rounded-full bg-primary flex items-center justify-center text-primary-foreground shadow-lg hover:scale-105 transition-transform"
          >
            <Mic className="h-10 w-10" />
          </button>
        )}
        {mic.status === "recording" && (
          <button
            onClick={mic.stop}
            className="h-24 w-24 rounded-full bg-rose-500 flex items-center justify-center text-white shadow-lg animate-pulse"
          >
            <StopCircle className="h-10 w-10" />
          </button>
        )}
        {mic.status === "done" && (
          <div className="w-full space-y-3">
            <audio controls className="w-full rounded-lg" src={mic.playbackUrl ?? undefined} />
            <p className="text-sm text-muted-foreground text-center">
              مدة التسجيل: {mic.durationSec} ثانية
            </p>
            {!state.submitted && (
              <Button variant="outline" size="sm" onClick={mic.reset} className="w-full">
                إعادة التسجيل
              </Button>
            )}
          </div>
        )}
        {mic.status === "unsupported" && (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <AlertCircle className="h-5 w-5 text-amber-500" />
            <span>التسجيل الصوتي غير مدعوم في هذا المتصفح.</span>
          </div>
        )}
        {mic.status === "denied" && (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <AlertCircle className="h-5 w-5 text-rose-500" />
            <span>لم يتم السماح بالوصول للميكروفون. يرجى السماح من إعدادات المتصفح.</span>
          </div>
        )}

        {mic.status === "idle" && (
          <p className="text-lg font-medium text-foreground">انقر للتحدث</p>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Vocabulary block
// ──────────────────────────────────────────────────────────────────────
function VocabularyBlock({ block }: { block: ContentBlock }) {
  return (
    <div className="space-y-4 animate-in slide-in-from-right-4 duration-300">
      <BlockHeader block={block} />
      {(!block.vocabularyItems || block.vocabularyItems.length === 0) && (
        <p className="text-muted-foreground text-sm">لا توجد مفردات.</p>
      )}
      {(block.vocabularyItems ?? []).map((vocab) => (
        <Card key={vocab.id} className="overflow-hidden border-2 border-border hover:border-primary/30 transition-colors">
          <CardContent className="p-0 flex items-stretch">
            <div className="w-16 bg-primary/5 flex items-center justify-center border-r border-border">
              <Volume2 className="h-6 w-6 text-primary" />
            </div>
            <div className="p-4 flex-1">
              <div className="flex justify-between items-start mb-2">
                <div className="text-xl font-bold text-foreground" dir="ltr">{vocab.word}</div>
                <div className="text-lg font-bold text-primary">{vocab.translation}</div>
              </div>
              {vocab.pronunciation && (
                <div className="text-sm text-muted-foreground mb-3 font-mono" dir="ltr">/{vocab.pronunciation}/</div>
              )}
              {isUsableUrl(vocab.audioNote) && (
                <AudioWidget url={vocab.audioNote!} />
              )}
              {vocab.exampleSentence && (
                <div className="mt-4 pt-4 border-t border-border/50 text-left space-y-1" dir="ltr">
                  <p className="text-sm italic text-foreground">{vocab.exampleSentence}</p>
                  {vocab.exampleSentenceAr && (
                    <p className="text-sm text-muted-foreground text-right" dir="rtl">{vocab.exampleSentenceAr}</p>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Passive text-like blocks (text, dialogue, explanation, pronunciation_guide, review, spelling)
// ──────────────────────────────────────────────────────────────────────
function TextBlock({ block }: { block: ContentBlock }) {
  return (
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
      <BlockHeader block={block} />
      {block.contentAr && (
        <p className="text-lg md:text-xl leading-relaxed text-foreground text-right" dir="rtl">
          {block.contentAr}
        </p>
      )}
      {block.content && (
        <div className="p-6 bg-secondary/50 rounded-2xl border border-border">
          <p className="text-xl md:text-2xl leading-relaxed text-foreground font-serif text-left" dir="ltr">
            {block.content}
          </p>
        </div>
      )}
      {isUsableUrl(block.audioUrl) && <AudioWidget url={block.audioUrl!} label={block.audioNote ?? undefined} />}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Audio placeholder block
// ──────────────────────────────────────────────────────────────────────
function AudioPlaceholderBlock({ block }: { block: ContentBlock }) {
  return (
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
      <BlockHeader block={block} />
      {isUsableUrl(block.audioUrl) ? (
        <AudioWidget url={block.audioUrl!} label={block.audioNote ?? "استمع للمقطع الصوتي"} />
      ) : (
        <Card className="border-border">
          <CardContent className="p-8 flex flex-col items-center justify-center text-center">
            <PlayCircle className="h-16 w-16 text-primary mb-4" />
            <h3 className="text-xl font-bold mb-2">استمع للمقطع الصوتي</h3>
            {block.audioNote && (
              <p className="text-sm text-muted-foreground mt-2">{block.audioNote}</p>
            )}
          </CardContent>
        </Card>
      )}
      {block.contentAr && (
        <p className="text-lg leading-relaxed text-foreground" dir="rtl">{block.contentAr}</p>
      )}
      {block.content && (
        <p className="text-lg leading-relaxed text-foreground font-serif" dir="ltr">{block.content}</p>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Main Lesson Component
// ──────────────────────────────────────────────────────────────────────
export default function Lesson({ params }: { params: { lessonId: string } }) {
  const lessonId = parseInt(params.lessonId, 10);
  const { data: lesson, isLoading, error } = useGetLesson(lessonId);
  const startLesson = useStartLesson();
  const submitActivity = useSubmitLessonActivity();
  const completeLesson = useCompleteLesson();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // All hooks must be unconditional
  const [currentBlockIndex, setCurrentBlockIndex] = useState(0);
  const [blockStates, setBlockStates] = useState<Record<number, BlockState>>({});
  const [finishResult, setFinishResult] = useState<LessonProgress | null>(null);
  const [startTime] = useState(Date.now());
  const initialized = useRef(false);

  useEffect(() => {
    if (lesson && !initialized.current) {
      initialized.current = true;
      startLesson.mutate({ lessonId });
    }
  // startLesson is stable (from useMutation), lessonId is a primitive
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson, lessonId]);

  // ── Loading / error guards ────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-6 mt-10">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  if (error || !lesson) {
    return (
      <div className="p-8 text-center mt-20">
        <h2 className="text-xl font-bold text-destructive mb-4">حدث خطأ في تحميل الدرس</h2>
        <Link href="/learn">
          <Button>العودة للمنهج</Button>
        </Link>
      </div>
    );
  }

  const blocks = lesson.contentBlocks ?? [];
  const currentBlock = blocks[currentBlockIndex] ?? null;
  const isLastBlock = currentBlockIndex === blocks.length - 1;
  const progress = blocks.length > 0 ? ((currentBlockIndex + 1) / blocks.length) * 100 : 100;

  // ── Per-block helpers ──────────────────────────────────────────────
  const getBlockState = (blockId: number): BlockState =>
    blockStates[blockId] ?? { submitted: false, submitting: false, result: null };

  const setBlockField = (blockId: number, patch: Partial<BlockState>) => {
    setBlockStates(prev => ({
      ...prev,
      [blockId]: { ...getBlockState(blockId), ...patch },
    }));
  };

  // ── Submit a single block via API ──────────────────────────────────
  const doSubmitBlock = (block: ContentBlock, extraPatch?: Partial<BlockState>) => {
    const st = { ...getBlockState(block.id), ...(extraPatch ?? {}) };
    setBlockField(block.id, { submitting: true });

    const payload: {
      clientSubmissionId: string;
      selectedOptionId?: string;
      responseText?: string;
      recordingDurationSeconds?: number;
    } = { clientSubmissionId: genClientId() };

    if (block.type === "mcq" && st.selectedOptionId) {
      payload.selectedOptionId = st.selectedOptionId;
    } else if (block.type === "open_ended" && st.responseText) {
      payload.responseText = st.responseText;
    } else if (
      (block.type === "speaking_prompt" || block.type === "pronunciation_guide") &&
      st.recordingDurationSeconds !== undefined
    ) {
      payload.recordingDurationSeconds = st.recordingDurationSeconds;
    }
    // passive blocks: just clientSubmissionId

    submitActivity.mutate(
      { lessonId, blockId: block.id, data: payload },
      {
        onSuccess: (result) => {
          setBlockField(block.id, { submitted: true, submitting: false, result });
          // Invalidate lesson detail so completedBlockIds updates
          queryClient.invalidateQueries({ queryKey: getGetLessonQueryKey(lessonId) });
        },
        onError: () => {
          setBlockField(block.id, { submitting: false });
          toast({
            variant: "destructive",
            title: "خطأ",
            description: "تعذّر إرسال إجابتك، حاول مجدداً.",
          });
        },
      }
    );
  };

  // ── "Continue" button handler ──────────────────────────────────────
  const handleContinue = () => {
    if (!currentBlock) {
      moveNext();
      return;
    }

    const st = getBlockState(currentBlock.id);

    // If already submitted, just move
    if (st.submitted) {
      moveNext();
      return;
    }

    // Validate required fields before submitting
    if (currentBlock.isRequired) {
      if (currentBlock.type === "mcq" && !st.selectedOptionId) {
        toast({ variant: "destructive", title: "الرجاء اختيار إجابة أولاً" });
        return;
      }
      if (currentBlock.type === "open_ended") {
        if (!st.responseText || st.responseText.trim() === "") {
          toast({ variant: "destructive", title: "الرجاء كتابة إجابة أولاً" });
          return;
        }
      }
      if (
        (currentBlock.type === "speaking_prompt" || currentBlock.type === "pronunciation_guide") &&
        !st.hasRecording
      ) {
        toast({ variant: "destructive", title: "الرجاء تسجيل إجابة صوتية أولاً" });
        return;
      }
    }

    doSubmitBlock(currentBlock);
  };

  const moveNext = () => {
    if (isLastBlock) {
      handleFinish();
    } else {
      setCurrentBlockIndex(prev => prev + 1);
    }
  };

  // After submission the user clicks Continue again to advance
  const handleContinueAfterSubmit = () => {
    if (isLastBlock) {
      handleFinish();
    } else {
      setCurrentBlockIndex(prev => prev + 1);
    }
  };

  // ── Finish lesson ──────────────────────────────────────────────────
  const handleFinish = () => {
    const timeSpentSeconds = Math.floor((Date.now() - startTime) / 1000);
    completeLesson.mutate(
      { lessonId, data: { timeSpentSeconds } },
      {
        onSuccess: async (data) => {
          // Invalidate everything that might reference this lesson's state
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() }),
            queryClient.invalidateQueries({ queryKey: getGetLevelsQueryKey() }),
            queryClient.invalidateQueries({ queryKey: getGetLevelQueryKey(lesson.levelId) }),
            queryClient.invalidateQueries({ queryKey: getGetLessonQueryKey(lessonId) }),
            queryClient.invalidateQueries({ queryKey: getGetLessonsQueryKey() }),
            queryClient.invalidateQueries({ queryKey: getGetLessonProgressQueryKey(lessonId) }),
          ]);
          setFinishResult(data);
        },
        onError: (err: unknown) => {
          // 422 — missing required blocks
          const apiError = err as { status?: number; data?: LessonCompletionError };
          if (apiError?.status === 422 && apiError?.data?.missingRequiredBlockIds) {
            const ids = apiError.data.missingRequiredBlockIds;
            const missing = blocks.filter(b => ids.includes(b.id));
            const names = missing.map(b => b.titleAr || b.title || `بلوك #${b.id}`).join("، ");
            toast({
              variant: "destructive",
              title: "الدرس غير مكتمل",
              description: `يجب إكمال: ${names}`,
            });
            // Navigate to first missing block
            const firstMissingIdx = blocks.findIndex(b => ids.includes(b.id));
            if (firstMissingIdx >= 0) setCurrentBlockIndex(firstMissingIdx);
          } else {
            toast({
              variant: "destructive",
              title: "خطأ",
              description: "لم نتمكن من حفظ نتيجتك. تأكد من اتصالك بالإنترنت.",
            });
          }
        },
      }
    );
  };

  // ── Finish screen ──────────────────────────────────────────────────
  if (finishResult) {
    const score = finishResult.lastScore ?? finishResult.bestScore ?? 0;
    const passed = finishResult.passed;
    const xpEarned = finishResult.xpEarned;

    return (
      <div dir="rtl" className="min-h-[100dvh] flex items-center justify-center p-4 bg-background">
        <Card className="max-w-lg w-full text-center shadow-xl border-t-8 border-t-primary">
          <CardContent className="pt-10 pb-8 px-6 space-y-6">
            <div className={`h-24 w-24 rounded-full flex items-center justify-center mx-auto mb-4 ${passed ? 'bg-emerald-100' : 'bg-rose-100'}`}>
              {passed ? (
                <CheckCircle2 className="h-12 w-12 text-emerald-500" />
              ) : (
                <XCircle className="h-12 w-12 text-rose-500" />
              )}
            </div>

            <h2 className="text-3xl font-bold text-foreground">
              {passed ? "أحسنت العمل!" : "حاول مرة أخرى"}
            </h2>

            <div className="flex justify-center gap-8 py-6">
              <div className="text-center">
                <div className="text-4xl font-bold text-foreground mb-1" dir="ltr">{score}%</div>
                <div className="text-sm text-muted-foreground">النتيجة</div>
              </div>
              <div className="w-px bg-border"></div>
              <div className="text-center">
                <div className="text-4xl font-bold text-amber-500 mb-1" dir="ltr">+{xpEarned}</div>
                <div className="text-sm text-muted-foreground">XP</div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 pt-4">
              <Button
                onClick={() => setLocation(`/learn/${lesson.levelId}`)}
                className="flex-1 h-14 text-lg rounded-xl"
              >
                الاستمرار
              </Button>
              {lesson.isCompleted && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setFinishResult(null);
                    setCurrentBlockIndex(0);
                  }}
                  className="flex-1 h-14 text-lg rounded-xl"
                >
                  مراجعة الدرس
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Determine if Continue is disabled ─────────────────────────────
  const currentState = currentBlock ? getBlockState(currentBlock.id) : null;
  const isSubmitting = currentState?.submitting ?? false;
  const isAlreadySubmitted = currentState?.submitted ?? false;

  // Continue is disabled during submit or if MCQ required and nothing selected yet
  let isContinueDisabled = isSubmitting || completeLesson.isPending;
  if (currentBlock && !isAlreadySubmitted && !isSubmitting) {
    if (currentBlock.type === "mcq" && !currentState?.selectedOptionId) {
      isContinueDisabled = true;
    }
  }

  // Label for continue button
  const continueLabel = () => {
    if (completeLesson.isPending || isSubmitting) {
      return <Loader2 className="h-5 w-5 animate-spin" />;
    }
    if (isAlreadySubmitted && isLastBlock) return "إنهاء الدرس";
    if (isAlreadySubmitted) return "متابعة";
    if (isLastBlock) return "إنهاء الدرس";
    return "متابعة";
  };

  const handleContinueBtn = () => {
    if (isAlreadySubmitted) {
      handleContinueAfterSubmit();
    } else {
      handleContinue();
    }
  };

  // ── Block renderer ─────────────────────────────────────────────────
  const renderBlock = () => {
    if (!currentBlock) return null;
    const st = getBlockState(currentBlock.id);

    switch (currentBlock.type) {
      case "text":
      case "explanation":
      case "review":
        return <TextBlock block={currentBlock} />;

      case "dialogue":
        return (
          <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
            <BlockHeader block={currentBlock} />
            {currentBlock.contentAr && (
              <div className="p-6 bg-secondary/50 rounded-2xl border border-border">
                <p className="text-lg leading-relaxed text-foreground" dir="rtl">{currentBlock.contentAr}</p>
              </div>
            )}
            {currentBlock.content && (
              <div className="p-6 bg-secondary/50 rounded-2xl border border-border">
                <p className="text-xl leading-relaxed font-serif text-foreground" dir="ltr">{currentBlock.content}</p>
              </div>
            )}
            {isUsableUrl(currentBlock.audioUrl) && <AudioWidget url={currentBlock.audioUrl!} label={currentBlock.audioNote ?? undefined} />}
          </div>
        );

      case "pronunciation_guide":
        return <TextBlock block={currentBlock} />;

      case "spelling":
        return (
          <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
            <BlockHeader block={currentBlock} />
            {currentBlock.contentAr && (
              <p className="text-lg leading-relaxed text-foreground" dir="rtl">{currentBlock.contentAr}</p>
            )}
            {currentBlock.content && (
              <div className="p-6 bg-secondary/50 rounded-2xl border border-border text-center">
                <p className="text-4xl font-bold font-serif tracking-widest" dir="ltr">{currentBlock.content}</p>
              </div>
            )}
            {isUsableUrl(currentBlock.audioUrl) && <AudioWidget url={currentBlock.audioUrl!} label={currentBlock.audioNote ?? undefined} />}
          </div>
        );

      case "vocabulary_list":
        return <VocabularyBlock block={currentBlock} />;

      case "mcq":
        return (
          <McqBlock
            block={currentBlock}
            state={st}
            onSelect={(optionId) => setBlockField(currentBlock.id, { selectedOptionId: optionId })}
          />
        );

      case "open_ended":
        return (
          <OpenEndedBlock
            block={currentBlock}
            state={st}
            onChange={(text) => setBlockField(currentBlock.id, { responseText: text })}
          />
        );

      case "speaking_prompt":
      case "pronunciation_guide" as string:
        // speaking_prompt is handled here (pronunciation_guide already matched above as TextBlock)
        if (currentBlock.type === "speaking_prompt") {
          return (
            <SpeakingBlock
              block={currentBlock}
              state={st}
              onRecordingDone={(dur) => setBlockField(currentBlock.id, { recordingDurationSeconds: dur, hasRecording: true })}
            />
          );
        }
        return <TextBlock block={currentBlock} />;

      case "audio_placeholder":
        return <AudioPlaceholderBlock block={currentBlock} />;

      default:
        return (
          <div className="space-y-4">
            <BlockHeader block={currentBlock} />
            <p className="text-muted-foreground text-sm">نوع المحتوى: {currentBlock.type}</p>
          </div>
        );
    }
  };

  // ── Layout ─────────────────────────────────────────────────────────
  return (
    <div dir="rtl" className="min-h-[100dvh] flex flex-col bg-background">
      {/* Top Bar */}
      <header className="h-16 border-b border-border flex items-center px-4 md:px-8 shrink-0">
        <Link href={`/learn/${lesson.levelId}`}>
          <Button variant="ghost" size="icon" className="shrink-0">
            <ArrowRight className="h-5 w-5" />
          </Button>
        </Link>
        <div className="flex-1 mx-4">
          <Progress value={progress} className="h-2" />
        </div>
        <span className="text-sm text-muted-foreground shrink-0">
          {currentBlockIndex + 1}/{blocks.length}
        </span>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto w-full p-4 md:p-8 pb-32">
          {blocks.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground">لا يوجد محتوى في هذا الدرس بعد.</div>
          ) : (
            renderBlock()
          )}
        </div>
      </main>

      {/* Bottom Bar */}
      <div className="fixed bottom-0 left-0 right-0 p-4 border-t border-border bg-card/80 backdrop-blur-md shrink-0 z-10 md:left-64">
        <div className="max-w-2xl mx-auto w-full flex justify-between items-center gap-4">
          <Button
            variant="ghost"
            onClick={() => setCurrentBlockIndex(prev => prev - 1)}
            disabled={currentBlockIndex === 0 || isSubmitting}
            className="text-muted-foreground"
          >
            السابق
          </Button>

          <Button
            size="lg"
            className="flex-1 md:flex-none md:w-48 h-14 rounded-xl text-lg font-bold shadow-md"
            onClick={handleContinueBtn}
            disabled={isContinueDisabled}
          >
            {continueLabel()}
          </Button>
        </div>
      </div>
    </div>
  );
}

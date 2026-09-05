/**
 * The marking queue.
 *
 * Everything AI could not finish ends up here. Clearing it is not bookkeeping:
 * a level evaluation holds its promotion until every question has a verdict, so
 * an unmarked answer is a student who passed and is still waiting.
 *
 * By default this shows only work the automatic retries have given up on. The
 * rest may still resolve by itself, and a queue full of items that will clear
 * on their own is a queue nobody trusts.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { cmsApi, type GradingQueueItem, type GradedAttempt } from "@/lib/cms-api";
import { CMSLayout } from "@/components/cms-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  RefreshCw,
  Play,
  Loader2,
  AlertCircle,
  CheckCircle2,
  RotateCcw,
} from "lucide-react";

/** Pull the student's written answer out of the response bag. */
function answerText(response: unknown): string | null {
  if (typeof response === "string") return response;
  if (response && typeof response === "object") {
    const text = (response as Record<string, unknown>).text;
    if (typeof text === "string") return text;
  }
  return null;
}

function waitedFor(iso: string | null): string {
  if (!iso) return "—";
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${Math.round(hours / 24)} days`;
}

export default function GradingQueue() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showAll, setShowAll] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["cms-grading-queue", showAll],
    queryFn: () => cmsApi.grading.queue(showAll),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["cms-grading-queue"] });
  const fail = (e: Error) =>
    toast({ title: "Error", description: e.message, variant: "destructive" });

  const sweepMut = useMutation({
    mutationFn: () => cmsApi.grading.sweep(),
    onSuccess: (r) => {
      invalidate();
      toast({
        title: "Retry finished",
        description: `Retried ${r.quizAttemptsRetried} quiz attempt(s) and ${r.activitiesRetried} activity(ies).`,
      });
    },
    onError: fail,
  });

  const items = data?.items ?? [];
  const counts = data?.counts;

  return (
    <CMSLayout>
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Marking Queue</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Answers the AI could not mark. A level evaluation holds its promotion until
              every question has a verdict.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => sweepMut.mutate()}
            disabled={sweepMut.isPending}
          >
            {sweepMut.isPending ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
            )}
            Retry automatically
          </Button>
        </div>

        {counts && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Waiting on a human" value={counts.exhausted} emphasis />
            <Stat label="Quiz answers pending" value={counts.quizResponses} />
            <Stat label="Lesson answers pending" value={counts.activities} />
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAll(false)}
            className={`text-xs px-2.5 py-1 rounded-md border ${
              !showAll
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white text-gray-600 border-gray-200"
            }`}
          >
            Needs a human
          </button>
          <button
            onClick={() => setShowAll(true)}
            className={`text-xs px-2.5 py-1 rounded-md border ${
              showAll
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white text-gray-600 border-gray-200"
            }`}
          >
            Everything pending
          </button>
          {!showAll && (
            <span className="text-xs text-gray-400">
              Hiding work that is still being retried automatically
            </span>
          )}
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Loading…</div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-10 text-center">
            <CheckCircle2 className="h-8 w-8 mx-auto text-emerald-500 mb-2" />
            <p className="text-sm font-medium text-gray-700">Nothing waiting.</p>
            <p className="text-xs text-gray-400 mt-1">
              {showAll
                ? "Every answer has a verdict."
                : "Nothing has exhausted its automatic retries."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <QueueItem
                key={`${item.kind}-${item.id}`}
                item={item}
                onMarked={invalidate}
                onError={fail}
              />
            ))}
          </div>
        )}
      </div>
    </CMSLayout>
  );
}

function Stat({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: number;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        emphasis && value > 0
          ? "border-amber-300 bg-amber-50"
          : "border-gray-200 bg-white"
      }`}
    >
      <div className="text-2xl font-bold tabular-nums text-gray-900">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

function QueueItem({
  item,
  onMarked,
  onError,
}: {
  item: GradingQueueItem;
  onMarked: () => void;
  onError: (e: Error) => void;
}) {
  const { toast } = useToast();
  const [score, setScore] = useState("");
  const [feedback, setFeedback] = useState("");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const written = answerText(item.response);

  const audioMut = useMutation({
    mutationFn: () => cmsApi.grading.mediaUrl(item.mediaAssetId as number),
    onSuccess: (r) => setAudioUrl(r.url),
    onError,
  });

  const markMut = useMutation({
    // Normalised to one shape here rather than branching on the response type
    // at the call site: only the quiz path returns an attempt, and a union of
    // the two makes every field on it unreachable.
    mutationFn: async (): Promise<{ attempt: GradedAttempt | null }> => {
      const body = { score: Number(score), feedbackAr: feedback || undefined };
      if (item.kind === "quiz_response") {
        const r = await cmsApi.grading.markQuizResponse(item.id, body);
        return { attempt: r.attempt };
      }
      await cmsApi.grading.markActivity(item.id, body);
      return { attempt: null };
    },
    onSuccess: ({ attempt }) => {
      onMarked();
      // Say what the mark actually did. "Saved" would hide the thing that
      // matters: whether this released a student who was stuck.
      if (attempt && attempt.pendingReviewCount === 0) {
        toast({
          title: attempt.passed ? "Marked — student passed" : "Marked — attempt complete",
          description: `Attempt score ${Math.round(attempt.score ?? 0)}%. Nothing else outstanding.`,
        });
      } else if (attempt) {
        toast({
          title: "Marked",
          description: `${attempt.pendingReviewCount} question(s) still outstanding on this attempt.`,
        });
      } else {
        toast({ title: "Marked" });
      }
    },
    onError,
  });

  const retryMut = useMutation({
    mutationFn: () => cmsApi.grading.retry(item.kind, item.id),
    onSuccess: () => {
      onMarked();
      toast({ title: "Queued for another automatic attempt" });
    },
    onError,
  });

  const scoreValid = score !== "" && Number(score) >= 0 && Number(score) <= 100;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-gray-100 text-gray-600">
              {item.blockType}
            </span>
            <span className="text-sm font-medium text-gray-800">{item.studentName}</span>
            <span className="text-xs text-gray-400">· {item.context}</span>
          </div>
          <p className="text-sm text-gray-600 mt-1">{item.prompt ?? "—"}</p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs text-gray-400">waiting {waitedFor(item.submittedAt)}</div>
          <div className="text-xs text-gray-400">{item.gradingAttempts} auto attempts</div>
        </div>
      </div>

      {item.lastGradingError && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 flex gap-1.5">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-px" />
          <span>{item.lastGradingError}</span>
        </div>
      )}

      {/* The passage, when the student was reading one — what to mark against */}
      {item.expectsReferenceReading && item.referenceText && (
        <div className="rounded-md bg-gray-50 border border-gray-200 p-2">
          <div className="text-xs text-gray-500 mb-1">They were asked to read:</div>
          <p className="text-sm text-gray-800" dir="ltr">
            {item.referenceText}
          </p>
        </div>
      )}

      {written && (
        <div className="rounded-md bg-gray-50 border border-gray-200 p-2">
          <div className="text-xs text-gray-500 mb-1">Their answer:</div>
          <p className="text-sm text-gray-800 whitespace-pre-wrap" dir="ltr">
            {written}
          </p>
        </div>
      )}

      {item.transcript && (
        <div className="rounded-md bg-gray-50 border border-gray-200 p-2">
          <div className="text-xs text-gray-500 mb-1">What the recogniser heard:</div>
          <p className="text-sm text-gray-800" dir="ltr">
            {item.transcript}
          </p>
        </div>
      )}

      {item.mediaAssetId && (
        <div className="space-y-2">
          {audioUrl ? (
            <audio controls src={audioUrl} className="w-full" />
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => audioMut.mutate()}
              disabled={audioMut.isPending}
            >
              {audioMut.isPending ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5 mr-1" />
              )}
              Listen to the recording
            </Button>
          )}
        </div>
      )}

      {!written && !item.transcript && !item.mediaAssetId && (
        <p className="text-xs text-gray-400 italic">
          Nothing was submitted for this question.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-[100px_1fr_auto] items-end">
        <div className="space-y-1">
          <Label className="text-xs text-gray-500">Score %</Label>
          <Input
            type="number"
            min={0}
            max={100}
            value={score}
            onChange={(e) => setScore(e.target.value)}
            className="text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-gray-500">Feedback for the student (Arabic)</Label>
          <Textarea
            rows={2}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            className="text-sm"
            dir="rtl"
          />
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={!scoreValid || markMut.isPending}
            onClick={() => markMut.mutate()}
          >
            Mark
          </Button>
          <Button
            size="sm"
            variant="outline"
            title="Reset the retry count and let the AI try again"
            disabled={retryMut.isPending}
            onClick={() => retryMut.mutate()}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

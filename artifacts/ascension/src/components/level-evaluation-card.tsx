/**
 * The evaluation gate at the end of a level (spec section 10).
 *
 * Renders whatever state the gate is in — open, waiting on lessons, cooling
 * down after a failure, or not authored yet — because a shut gate is normal and
 * the student needs to know what opens it. Every judgement shown here comes
 * from the server; this component formats and never decides.
 */

import { useLocation } from "wouter";
import { useGetLevelEvaluation } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { GraduationCap, Lock, Clock, RotateCcw, AlertCircle } from "lucide-react";

/** How long until a timestamp, in whole hours, rounded up. */
function hoursUntil(iso: string): number {
  return Math.max(1, Math.ceil((new Date(iso).getTime() - Date.now()) / 3_600_000));
}

export function LevelEvaluationCard({ levelId }: { levelId: number }) {
  const [, setLocation] = useLocation();
  const { data, isLoading, error } = useGetLevelEvaluation(levelId);

  if (isLoading) return <Skeleton className="h-40 w-full rounded-2xl" />;

  // A gate that failed to load is not worth an error banner on a page that is
  // otherwise fine — the lessons above it still work.
  if (error || !data) return null;

  const { evaluation, eligibility, remediation } = data;

  // No evaluation authored for this level yet, or it belongs to a level the
  // student is not on. Neither is something to show them.
  if (!evaluation) return null;
  if (eligibility.code === "NOT_CURRENT_LEVEL" || eligibility.code === "NOT_PLACED") return null;

  const open = eligibility.eligible;

  return (
    <Card
      className={`border-2 ${
        open ? "border-amber-300 bg-amber-50/60" : "border-border bg-muted/30"
      }`}
    >
      <CardContent className="p-6 space-y-4">
        <div className="flex items-start gap-4">
          <div
            className={`h-12 w-12 rounded-2xl flex items-center justify-center shrink-0 ${
              open ? "bg-amber-100 text-amber-700" : "bg-muted text-muted-foreground"
            }`}
          >
            {open ? <GraduationCap className="h-6 w-6" /> : <Lock className="h-5 w-5" />}
          </div>

          <div className="flex-1 min-w-0 space-y-1">
            <h3 className="text-lg font-bold">{evaluation.titleAr}</h3>
            <p className="text-sm text-muted-foreground truncate" dir="ltr">
              {evaluation.title}
            </p>
            <p className="text-xs text-muted-foreground">
              درجة النجاح {evaluation.passingScore}%
              {evaluation.timeLimitSec
                ? ` · ${Math.round(evaluation.timeLimitSec / 60)} دقيقة`
                : ""}
              {evaluation.maxAttempts !== null && evaluation.maxAttempts !== undefined
                ? ` · ${eligibility.attemptsUsed}/${evaluation.maxAttempts} محاولات`
                : ""}
            </p>
          </div>
        </div>

        {/* Why the gate is shut, and what opens it */}
        {eligibility.code === "LESSONS_INCOMPLETE" && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">
                أكمل دروس المستوى لفتح اختبار التقييم
              </span>
              <span className="font-medium">
                {eligibility.lessonsPassed}/{eligibility.lessonsTotal}
              </span>
            </div>
            <Progress value={eligibility.completedPercent} className="h-2" />
            <p className="text-xs text-muted-foreground">
              مطلوب {eligibility.requiredPercent}% — أنجزت {eligibility.completedPercent}%
            </p>
          </div>
        )}

        {eligibility.code === "COOLDOWN" && eligibility.retryAvailableAt && (
          <p className="text-sm flex items-center gap-2 text-muted-foreground">
            <Clock className="h-4 w-4 shrink-0" />
            يمكنك إعادة المحاولة بعد {hoursUntil(eligibility.retryAvailableAt)} ساعة.
          </p>
        )}

        {eligibility.code === "ATTEMPTS_EXHAUSTED" && (
          <p className="text-sm flex items-center gap-2 text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            لقد استنفدت محاولاتك في هذا الاختبار. تواصل مع الإدارة.
          </p>
        )}

        {/* Existing lessons to redo — never new material (spec section 9) */}
        {remediation.length > 0 && (
          <div className="space-y-2 pt-1">
            <p className="text-xs font-bold flex items-center gap-2">
              <RotateCcw className="h-3.5 w-3.5" />
              ابدأ بهذه الدروس
            </p>
            <div className="space-y-1.5">
              {remediation.slice(0, 3).map((l) => (
                <button
                  key={l.lessonId}
                  type="button"
                  onClick={() => setLocation(`/lesson/${l.lessonId}`)}
                  className="w-full text-right p-2.5 rounded-xl border bg-background hover:border-primary/40 transition-colors flex items-center justify-between gap-3"
                >
                  <span className="text-sm font-medium truncate">{l.titleAr}</span>
                  <span className="text-xs shrink-0 text-muted-foreground">
                    {l.bestScore === null ? "لم تُدرس" : `${Math.round(l.bestScore)}%`}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {open && (
          <Button
            onClick={() => setLocation(`/quiz/${evaluation.quizId}`)}
            className="w-full rounded-xl"
            size="lg"
          >
            ابدأ اختبار التقييم
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

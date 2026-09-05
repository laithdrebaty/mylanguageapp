/**
 * Finding work that was left unmarked, and trying again.
 *
 * WHY THIS HAS TO EXIST
 * ──────────────────────
 * Grading runs as an in-process job, so it is lost if the server restarts
 * between a submit and the job running. It is also skipped whenever AI was
 * unavailable — a provider outage, an exhausted quota, a misconfiguration. Both
 * are handled safely at the time: the answer stays `pending` rather than being
 * marked wrong.
 *
 * But `pending` was a dead end. Nothing looked for it again, so a student's
 * answer could sit unmarked indefinitely, and for a level evaluation that means
 * a student who passed never gets promoted. The failure was silent and
 * permanent, which is the worst combination.
 *
 * This sweep is the other half of that safety: work left behind is picked up
 * later, a bounded number of times, and what is still stuck after that is
 * surfaced to staff to mark by hand.
 *
 * WHY IT IS BOUNDED
 * ──────────────────
 * An answer that can never be marked — a recording that will not transcribe, a
 * model that always returns nonsense for it — would otherwise be retried
 * forever against a paid API. `MAX_ATTEMPTS` turns "broken forever" into
 * "escalated to a human", which is the outcome anyone would want.
 */

import { and, eq, lt, sql, isNull, or } from "drizzle-orm";
import {
  db,
  quizResponsesTable,
  quizAttemptsTable,
  learningActivityAttemptsTable,
} from "@workspace/db";
import { gradeQuizAttempt, gradeSpeakingActivity, gradeLessonActivity } from "./grading-runner";
import { logger } from "../lib/logger";

/**
 * How long to leave work alone before treating it as stranded.
 *
 * Long enough that the sweep never races the job that is already handling it —
 * grading a written answer takes seconds, transcription tens of seconds — and
 * short enough that a student is not waiting for an hour.
 */
const STALE_AFTER_MS = parseInt(process.env.GRADING_SWEEP_STALE_MS ?? "300000", 10); // 5 min

/** Tries per item before it is left for a human. */
const MAX_ATTEMPTS = parseInt(process.env.GRADING_SWEEP_MAX_ATTEMPTS ?? "3", 10);

/** How often to look. */
const INTERVAL_MS = parseInt(process.env.GRADING_SWEEP_INTERVAL_MS ?? "600000", 10); // 10 min

/** Items per sweep, so one pass cannot spend an hour and a quota all at once. */
const BATCH_SIZE = parseInt(process.env.GRADING_SWEEP_BATCH ?? "20", 10);

export interface SweepResult {
  quizAttemptsRetried: number;
  activitiesRetried: number;
}

/**
 * One pass.
 *
 * Exported so it can be run on demand from an admin endpoint and in tests,
 * rather than only on a timer that is awkward to observe.
 */
export async function sweepStalePending(): Promise<SweepResult> {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);

  // ── Quiz responses ──────────────────────────────────────────────────────
  // Grouped by attempt: grading is per-attempt, and re-finalising the attempt
  // is what actually unblocks promotion, so retrying one response at a time
  // would do the expensive part repeatedly for no benefit.
  const staleResponses = await db
    .selectDistinct({ attemptId: quizResponsesTable.attemptId })
    .from(quizResponsesTable)
    .innerJoin(quizAttemptsTable, eq(quizAttemptsTable.id, quizResponsesTable.attemptId))
    .where(
      and(
        eq(quizResponsesTable.gradedBy, "pending"),
        lt(quizResponsesTable.createdAt, cutoff),
        lt(quizResponsesTable.gradingAttempts, MAX_ATTEMPTS),
        // An attempt still in progress has not been submitted; there is nothing
        // to grade and the student may still be answering.
        sql`${quizAttemptsTable.status} <> 'in_progress'`,
      ),
    )
    .limit(BATCH_SIZE);

  for (const { attemptId } of staleResponses) {
    // Counted before the try, not after: a run that crashes must still burn an
    // attempt, or a reliably-crashing item loops forever.
    await db
      .update(quizResponsesTable)
      .set({ gradingAttempts: sql`${quizResponsesTable.gradingAttempts} + 1` })
      .where(
        and(
          eq(quizResponsesTable.attemptId, attemptId),
          eq(quizResponsesTable.gradedBy, "pending"),
        ),
      );

    try {
      await gradeQuizAttempt(attemptId);
    } catch (err) {
      logger.error({ err, attemptId }, "Sweep: quiz attempt grading failed");
      await db
        .update(quizResponsesTable)
        .set({ lastGradingError: err instanceof Error ? err.message.slice(0, 500) : "unknown" })
        .where(
          and(
            eq(quizResponsesTable.attemptId, attemptId),
            eq(quizResponsesTable.gradedBy, "pending"),
          ),
        );
    }
  }

  // ── Lesson activities ───────────────────────────────────────────────────
  const staleActivities = await db
    .select({
      id: learningActivityAttemptsTable.id,
      mediaAssetId: learningActivityAttemptsTable.mediaAssetId,
      responseText: learningActivityAttemptsTable.responseText,
    })
    .from(learningActivityAttemptsTable)
    .where(
      and(
        eq(learningActivityAttemptsTable.evaluationStatus, "pending"),
        lt(learningActivityAttemptsTable.submittedAt, cutoff),
        lt(learningActivityAttemptsTable.gradingAttempts, MAX_ATTEMPTS),
        // Something to grade: a recording or written text. An attempt with
        // neither cannot be marked by anything and would burn retries.
        or(
          sql`${learningActivityAttemptsTable.mediaAssetId} IS NOT NULL`,
          sql`${learningActivityAttemptsTable.responseText} IS NOT NULL`,
        ),
      ),
    )
    .limit(BATCH_SIZE);

  for (const activity of staleActivities) {
    await db
      .update(learningActivityAttemptsTable)
      .set({ gradingAttempts: sql`${learningActivityAttemptsTable.gradingAttempts} + 1` })
      .where(eq(learningActivityAttemptsTable.id, activity.id));

    try {
      if (activity.mediaAssetId) {
        await gradeSpeakingActivity(activity.id);
      } else {
        await gradeLessonActivity(activity.id);
      }
    } catch (err) {
      logger.error({ err, activityId: activity.id }, "Sweep: activity grading failed");
      await db
        .update(learningActivityAttemptsTable)
        .set({ lastGradingError: err instanceof Error ? err.message.slice(0, 500) : "unknown" })
        .where(eq(learningActivityAttemptsTable.id, activity.id));
    }
  }

  const result = {
    quizAttemptsRetried: staleResponses.length,
    activitiesRetried: staleActivities.length,
  };

  if (result.quizAttemptsRetried > 0 || result.activitiesRetried > 0) {
    logger.info(result, "Grading sweep retried stranded work");
  }

  return result;
}

/** What is still waiting, for the marking queue and for monitoring. */
export async function countPendingWork(): Promise<{
  quizResponses: number;
  activities: number;
  exhausted: number;
}> {
  const [{ responses }] = await db
    .select({ responses: sql<number>`count(*)::int` })
    .from(quizResponsesTable)
    .where(eq(quizResponsesTable.gradedBy, "pending"));

  const [{ activities }] = await db
    .select({ activities: sql<number>`count(*)::int` })
    .from(learningActivityAttemptsTable)
    .where(eq(learningActivityAttemptsTable.evaluationStatus, "pending"));

  // Work the sweep has given up on. This is the number that matters
  // operationally: it is the queue a human has to clear.
  const [{ exhausted }] = await db
    .select({ exhausted: sql<number>`count(*)::int` })
    .from(quizResponsesTable)
    .where(
      and(
        eq(quizResponsesTable.gradedBy, "pending"),
        sql`${quizResponsesTable.gradingAttempts} >= ${MAX_ATTEMPTS}`,
      ),
    );

  return { quizResponses: responses, activities, exhausted };
}

// ─── Timer ────────────────────────────────────────────────────────────────────

let timer: NodeJS.Timeout | null = null;

/**
 * Start sweeping on an interval.
 *
 * With more than one API instance every instance sweeps, which is wasteful but
 * not harmful: grading is idempotent, and an item already marked is skipped by
 * the `pending` filter. A real queue would make this a single worker; that is
 * the same change as moving jobs off `JOB_QUEUE=memory`.
 */
export function startGradingSweeper(): void {
  if (timer) return;
  if (process.env.GRADING_SWEEP_ENABLED === "false") {
    logger.info("Grading sweeper disabled by configuration");
    return;
  }

  timer = setInterval(() => {
    void sweepStalePending().catch((err) => {
      logger.error({ err }, "Grading sweep failed");
    });
  }, INTERVAL_MS);

  // Do not hold the process open for the timer alone.
  timer.unref?.();

  logger.info({ intervalMs: INTERVAL_MS, staleAfterMs: STALE_AFTER_MS }, "Grading sweeper started");
}

export function stopGradingSweeper(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export { MAX_ATTEMPTS, STALE_AFTER_MS };

/**
 * Student-facing quiz routes.
 *
 * Only 'published' quizzes are ever served here, and every block goes through
 * sanitizeBlockForStudent so answer keys stay on the server. Scores are
 * computed server-side; anything a client submits as a score is ignored.
 */

import { Router, type IRouter } from "express";
import { eq, and, asc, desc, isNull, sql } from "drizzle-orm";
import {
  db,
  quizzesTable,
  quizAttemptsTable,
  quizResponsesTable,
  contentBlocksTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import {
  sanitizeBlockForStudent,
  gradeResponse,
  blockPoints,
  isNonScoring,
  type QuizBlockConfig,
} from "../services/quiz-grading";
import { assertUsableRecording, MediaValidationError } from "../services/media";
import { jobs } from "../services/jobs";
import {
  getEvaluationEligibility,
  applyEvaluationOutcome,
  getLevelRemediation,
} from "../services/progression";

const router: IRouter = Router();

/**
 * Why an evaluation is closed, in the student's language. Arabic is the UI
 * language, so these read as the student sees them; the machine-readable `code`
 * travels alongside for the client to branch on.
 */
const EVALUATION_BLOCKED_MESSAGES: Record<string, string> = {
  NOT_PLACED: "أكمل اختبار تحديد المستوى أولاً.",
  NO_EVALUATION: "لا يوجد اختبار تقييم لهذا المستوى بعد.",
  NOT_CURRENT_LEVEL: "هذا الاختبار ليس لمستواك الحالي.",
  LESSONS_INCOMPLETE: "أكمل دروس هذا المستوى قبل خوض اختبار التقييم.",
  COOLDOWN: "راجع الدروس ثم أعد المحاولة لاحقاً.",
  ATTEMPTS_EXHAUSTED: "لقد استنفدت محاولاتك في هذا الاختبار.",
};

/** Deterministic shuffle so a reload doesn't reorder mid-attempt. */
function seededShuffle<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function loadPublishedQuiz(id: number) {
  const [quiz] = await db
    .select()
    .from(quizzesTable)
    .where(
      and(
        eq(quizzesTable.id, id),
        eq(quizzesTable.status, "published"),
        isNull(quizzesTable.softDeletedAt),
      ),
    )
    .limit(1);
  return quiz ?? null;
}

// ─── Discovery ───────────────────────────────────────────────────────────────

/** Published quizzes, with this student's best result so far. */
router.get("/quizzes", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId!;

  const quizzes = await db
    .select()
    .from(quizzesTable)
    .where(and(eq(quizzesTable.status, "published"), isNull(quizzesTable.softDeletedAt)))
    .orderBy(desc(quizzesTable.updatedAt));

  const attempts = await db
    .select()
    .from(quizAttemptsTable)
    .where(eq(quizAttemptsTable.userId, userId));

  res.json({
    quizzes: quizzes.map((q) => {
      const mine = attempts.filter((a) => a.quizId === q.id);
      const graded = mine.filter((a) => a.score !== null);
      return {
        id: q.id,
        title: q.title,
        titleAr: q.titleAr,
        description: q.description,
        descriptionAr: q.descriptionAr,
        levelId: q.levelId,
        timeLimitSec: q.timeLimitSec,
        maxAttempts: q.maxAttempts,
        passingScore: q.passingScore,
        xpReward: q.xpReward,
        attemptsUsed: mine.length,
        attemptsRemaining: q.maxAttempts === null ? null : Math.max(0, q.maxAttempts - mine.length),
        bestScore: graded.length ? Math.max(...graded.map((a) => a.score as number)) : null,
        passed: mine.some((a) => a.passed === true),
        activeAttemptId: mine.find((a) => a.status === "in_progress")?.id ?? null,
      };
    }),
  });
});

/** Quiz metadata and its blocks, with answer keys stripped. */
router.get("/quizzes/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid quiz ID" }); return; }

  const quiz = await loadPublishedQuiz(id);
  if (!quiz) { res.status(404).json({ error: "Quiz not found" }); return; }

  const blocks = await db
    .select()
    .from(contentBlocksTable)
    .where(and(eq(contentBlocksTable.quizId, id), eq(contentBlocksTable.isActive, true)))
    .orderBy(asc(contentBlocksTable.order));

  const ordered = quiz.shuffleBlocks
    ? seededShuffle(blocks, quiz.id * 1000 + req.session.userId!)
    : blocks;

  res.json({
    id: quiz.id,
    title: quiz.title,
    titleAr: quiz.titleAr,
    description: quiz.description,
    descriptionAr: quiz.descriptionAr,
    instructions: quiz.instructions,
    instructionsAr: quiz.instructionsAr,
    timeLimitSec: quiz.timeLimitSec,
    maxAttempts: quiz.maxAttempts,
    passingScore: quiz.passingScore,
    contentVersion: quiz.contentVersion,
    blocks: ordered.map((b) =>
      sanitizeBlockForStudent(b, {
        revealAnswers: quiz.revealAnswers === "immediate",
      }),
    ),
  });
});

// ─── Attempts ────────────────────────────────────────────────────────────────

/** Start an attempt, or resume the one already in progress. */
router.post("/quizzes/:id/attempts", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid quiz ID" }); return; }
  const userId = req.session.userId!;

  const quiz = await loadPublishedQuiz(id);
  if (!quiz) { res.status(404).json({ error: "Quiz not found" }); return; }

  // Resuming is not a new attempt and must not consume the allowance.
  const [active] = await db
    .select()
    .from(quizAttemptsTable)
    .where(
      and(
        eq(quizAttemptsTable.quizId, id),
        eq(quizAttemptsTable.userId, userId),
        eq(quizAttemptsTable.status, "in_progress"),
      ),
    )
    .limit(1);

  if (active) { res.json({ ...active, resumed: true }); return; }

  // A level evaluation is a gate, not an ordinary quiz: it opens only once the
  // student has worked through the level it closes. Checked here rather than in
  // the UI because it decides whether someone advances.
  if (quiz.kind === "level_evaluation" && quiz.levelId !== null) {
    const eligibility = await getEvaluationEligibility(userId, quiz.levelId);
    if (!eligibility.eligible) {
      res.status(403).json({
        error: EVALUATION_BLOCKED_MESSAGES[eligibility.code ?? "NO_EVALUATION"],
        code: eligibility.code,
        eligibility,
      });
      return;
    }
  }

  if (quiz.maxAttempts !== null) {
    const [{ used }] = await db
      .select({ used: sql<number>`count(*)::int` })
      .from(quizAttemptsTable)
      .where(and(eq(quizAttemptsTable.quizId, id), eq(quizAttemptsTable.userId, userId)));

    if (used >= quiz.maxAttempts) {
      res.status(409).json({
        error: `You have used all ${quiz.maxAttempts} attempts for this quiz.`,
        code: "QUIZ_ATTEMPTS_EXHAUSTED",
      });
      return;
    }
  }

  const [attempt] = await db
    .insert(quizAttemptsTable)
    .values({ quizId: id, userId, contentVersion: quiz.contentVersion })
    .returning();

  res.status(201).json({ ...attempt, resumed: false });
});

/** Save (or overwrite) the answer to one block. */
router.put("/quiz-attempts/:attemptId/responses/:blockId", requireAuth, async (req, res): Promise<void> => {
  const attemptId = parseInt(req.params.attemptId as string, 10);
  const blockId = parseInt(req.params.blockId as string, 10);
  if (isNaN(attemptId) || isNaN(blockId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [attempt] = await db
    .select()
    .from(quizAttemptsTable)
    .where(and(eq(quizAttemptsTable.id, attemptId), eq(quizAttemptsTable.userId, req.session.userId!)))
    .limit(1);

  if (!attempt) { res.status(404).json({ error: "Attempt not found" }); return; }
  if (attempt.status !== "in_progress") {
    res.status(409).json({ error: "This attempt has already been submitted." });
    return;
  }

  const [block] = await db
    .select()
    .from(contentBlocksTable)
    .where(and(eq(contentBlocksTable.id, blockId), eq(contentBlocksTable.quizId, attempt.quizId)))
    .limit(1);

  if (!block) { res.status(404).json({ error: "Block not found on this quiz" }); return; }

  const { response, mediaId } = req.body;

  // A recording is accepted only after the server has confirmed it landed in
  // the bucket and belongs to this student. `mediaKey` is derived from the
  // verified asset rather than taken from the request, so a client cannot point
  // a response at an object it does not own.
  let mediaKey: string | null = null;
  let mediaAssetId: number | null = null;
  if (mediaId !== undefined && mediaId !== null) {
    try {
      const asset = await assertUsableRecording(
        Number(mediaId),
        req.session.userId!,
        "quiz_response",
      );
      mediaKey = asset.key;
      mediaAssetId = asset.id;
    } catch (err) {
      if (err instanceof MediaValidationError) {
        res.status(err.code === "NOT_FOUND" ? 404 : 400).json({
          error: err.message,
          code: err.code,
        });
        return;
      }
      throw err;
    }
  }

  // Upsert — re-answering a block replaces the previous response.
  const [saved] = await db
    .insert(quizResponsesTable)
    .values({
      attemptId, blockId,
      response: response ?? null,
      mediaKey,
      mediaAssetId,
    })
    .onConflictDoUpdate({
      target: [quizResponsesTable.attemptId, quizResponsesTable.blockId],
      set: {
        response: response ?? null,
        mediaKey,
        mediaAssetId,
        updatedAt: new Date(),
      },
    })
    .returning();

  // Never echo grading fields back while the attempt is live.
  res.json({ id: saved.id, blockId: saved.blockId, saved: true });
});

/**
 * Submit for grading.
 *
 * Objective blocks are scored immediately. Blocks needing AI or a teacher are
 * left pending, and the attempt reports how many are outstanding — the score
 * shown is over what could be graded so far.
 */
router.post("/quiz-attempts/:attemptId/submit", requireAuth, async (req, res): Promise<void> => {
  const attemptId = parseInt(req.params.attemptId as string, 10);
  if (isNaN(attemptId)) { res.status(400).json({ error: "Invalid attempt ID" }); return; }

  const [attempt] = await db
    .select()
    .from(quizAttemptsTable)
    .where(and(eq(quizAttemptsTable.id, attemptId), eq(quizAttemptsTable.userId, req.session.userId!)))
    .limit(1);

  if (!attempt) { res.status(404).json({ error: "Attempt not found" }); return; }
  if (attempt.status !== "in_progress") {
    res.status(409).json({ error: "This attempt has already been submitted." });
    return;
  }

  const [quiz] = await db.select().from(quizzesTable).where(eq(quizzesTable.id, attempt.quizId)).limit(1);
  const blocks = await db
    .select()
    .from(contentBlocksTable)
    .where(and(eq(contentBlocksTable.quizId, attempt.quizId), eq(contentBlocksTable.isActive, true)));

  const responses = await db
    .select()
    .from(quizResponsesTable)
    .where(eq(quizResponsesTable.attemptId, attemptId));

  const byBlock = new Map(responses.map((r) => [r.blockId, r]));

  let earned = 0;
  /** Points of blocks that actually received a verdict — the score's denominator. */
  let gradedPoints = 0;
  let pending = 0;

  await db.transaction(async (tx) => {
    for (const block of blocks) {
      if (isNonScoring(block.type)) continue;

      const config = (block.config ?? null) as QuizBlockConfig | null;
      const points = blockPoints(config);

      const existing = byBlock.get(block.id);
      const verdict = gradeResponse(block.type, config, existing?.response ?? null, {
        hasMedia: existing?.mediaAssetId != null,
      });

      if (verdict.score === null) {
        pending += 1;
      } else {
        earned += (verdict.score / 100) * points;
        gradedPoints += points;
      }

      const values = {
        attemptId,
        blockId: block.id,
        response: existing?.response ?? null,
        mediaKey: existing?.mediaKey ?? null,
        mediaAssetId: existing?.mediaAssetId ?? null,
        score: verdict.score,
        gradedBy: verdict.gradedBy,
        feedback: verdict.feedback,
      };

      await tx
        .insert(quizResponsesTable)
        .values(values)
        .onConflictDoUpdate({
          target: [quizResponsesTable.attemptId, quizResponsesTable.blockId],
          set: {
            score: verdict.score,
            gradedBy: verdict.gradedBy,
            feedback: verdict.feedback,
            updatedAt: new Date(),
          },
        });
    }

    // Score over the blocks that have a verdict. Blocks still awaiting an AI or
    // teacher assessment are excluded from both halves of the fraction, so the
    // interim figure reads as "x% of what has been graded so far" rather than
    // being dragged down by work nobody has looked at yet.
    const score = gradedPoints > 0 ? (earned / gradedPoints) * 100 : 0;

    await tx
      .update(quizAttemptsTable)
      .set({
        status: pending > 0 ? "grading" : "graded",
        score,
        // Withhold pass/fail until every block has a verdict.
        passed: pending > 0 ? null : score >= (quiz?.passingScore ?? 75),
        pendingReviewCount: pending,
        submittedAt: new Date(),
        gradedAt: pending > 0 ? null : new Date(),
      })
      .where(eq(quizAttemptsTable.id, attemptId));
  });

  const [updated] = await db
    .select()
    .from(quizAttemptsTable)
    .where(eq(quizAttemptsTable.id, attemptId))
    .limit(1);

  const payload: Record<string, unknown> = {
    id: updated.id,
    status: updated.status,
    score: updated.score,
    passed: updated.passed,
    pendingReviewCount: updated.pendingReviewCount,
    passingScore: quiz?.passingScore ?? 75,
  };

  // A passed level evaluation moves the student up; a failed one sends them
  // back to the lessons they scored worst on. Both are decided from data the
  // server already has — no AI is involved in either.
  if (quiz?.kind === "level_evaluation" && quiz.levelId !== null) {
    payload.promotion = await applyEvaluationOutcome(attemptId);
    if (updated.passed === false) {
      payload.remediation = await getLevelRemediation(
        updated.userId,
        quiz.levelId,
      );
    }
  }

  res.json(payload);

  // Written answers are graded after the response is sent. An exam with three
  // of them is three model calls, and a submit must not hang on them; the
  // attempt already reports how many blocks are outstanding, and the job
  // re-finalises it — including promotion — when the verdicts land.
  if (pending > 0) {
    jobs.enqueue("grade_quiz_attempt", { attemptId });
  }
});

/** Review a finished attempt. Answer keys appear only once it is submitted. */
router.get("/quiz-attempts/:attemptId", requireAuth, async (req, res): Promise<void> => {
  const attemptId = parseInt(req.params.attemptId as string, 10);
  if (isNaN(attemptId)) { res.status(400).json({ error: "Invalid attempt ID" }); return; }

  const [attempt] = await db
    .select()
    .from(quizAttemptsTable)
    .where(and(eq(quizAttemptsTable.id, attemptId), eq(quizAttemptsTable.userId, req.session.userId!)))
    .limit(1);

  if (!attempt) { res.status(404).json({ error: "Attempt not found" }); return; }

  const [quiz] = await db.select().from(quizzesTable).where(eq(quizzesTable.id, attempt.quizId)).limit(1);
  const submitted = attempt.status !== "in_progress";

  const blocks = await db
    .select()
    .from(contentBlocksTable)
    .where(and(eq(contentBlocksTable.quizId, attempt.quizId), eq(contentBlocksTable.isActive, true)))
    .orderBy(asc(contentBlocksTable.order));

  const responses = await db
    .select()
    .from(quizResponsesTable)
    .where(eq(quizResponsesTable.attemptId, attemptId));

  const byBlock = new Map(responses.map((r) => [r.blockId, r]));

  res.json({
    attempt: {
      id: attempt.id,
      quizId: attempt.quizId,
      status: attempt.status,
      score: attempt.score,
      passed: attempt.passed,
      pendingReviewCount: attempt.pendingReviewCount,
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
    },
    quiz: quiz ? { id: quiz.id, title: quiz.title, titleAr: quiz.titleAr, passingScore: quiz.passingScore } : null,
    blocks: blocks.map((b) => {
      const r = byBlock.get(b.id);
      return {
        ...sanitizeBlockForStudent(b, { revealAnswers: submitted }),
        response: r
          ? {
              response: r.response,
              mediaKey: r.mediaKey,
              // Grading detail is meaningless (and revealing) pre-submission.
              score: submitted ? r.score : null,
              gradedBy: submitted ? r.gradedBy : null,
              feedback: submitted ? r.feedback : null,
              // Arabic is the student's language, so this is the one they read.
              feedbackAr: submitted ? r.feedbackAr : null,
            }
          : null,
      };
    }),
  });
});

export default router;

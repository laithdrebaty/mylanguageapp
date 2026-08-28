import { Router, type IRouter } from "express";
import { eq, and, asc, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  lessonsTable,
  levelsTable,
  contentBlocksTable,
  exercisesTable,
  exerciseOptionsTable,
  lessonProgressTable,
  lessonBlockProgressTable,
  learningActivityAttemptsTable,
  vocabularyTable,
  studentProfilesTable,
} from "@workspace/db";
import { requireAuth, requireStudent } from "../middlewares/auth";
import { cached, CK, TTL } from "../services/cache";
import {
  getCompletedLessonIds,
  getCompletedBlockIds,
  deriveLessonStateWithOrders,
  getStudentCurriculumContext,
  getCurriculumLevels,
  resolveAudioUrl,
  deriveLessonScore,
  getMissingRequiredBlockIds,
  maybeAdvanceLevel,
  findNextLesson,
  publishedLessonFilter,
} from "../services/learning";

const router: IRouter = Router();

// ─── GET /lessons ─────────────────────────────────────────────────────────────
// Requires student session; returns lessons in the student's curriculum
// with authoritative state values.

router.get("/lessons", requireStudent, async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const levelId = req.query.levelId ? parseInt(req.query.levelId as string, 10) : undefined;

  const ctx = await getStudentCurriculumContext(userId);
  if (!ctx) {
    res.status(403).json({ error: "No curriculum assigned. Complete placement test first." });
    return;
  }

  // Determine current level order for state derivation
  let currentLevelOrder: number | null = null;
  if (ctx.currentLevelId) {
    const [lvl] = await db
      .select({ order: levelsTable.order })
      .from(levelsTable)
      .where(eq(levelsTable.id, ctx.currentLevelId))
      .limit(1);
    currentLevelOrder = lvl?.order ?? null;
  }

  // Only show lessons from the student's curriculum
  const levelIds = await db
    .select({ id: levelsTable.id, order: levelsTable.order })
    .from(levelsTable)
    .where(eq(levelsTable.curriculumId, ctx.curriculumId));

  const allowedLevelIds = levelIds.map((l) => l.id);
  const levelOrderMap = new Map(levelIds.map((l) => [l.id, l.order]));

  if (allowedLevelIds.length === 0) {
    res.json([]);
    return;
  }

  const whereFilter = levelId
    ? and(
        eq(lessonsTable.levelId, levelId),
        inArray(lessonsTable.levelId, allowedLevelIds),
        publishedLessonFilter(),
      )
    : and(inArray(lessonsTable.levelId, allowedLevelIds), publishedLessonFilter());

  const [lessons, completedIds, progressRows] = await Promise.all([
    db.select().from(lessonsTable).where(whereFilter).orderBy(asc(lessonsTable.order)),
    getCompletedLessonIds(userId),
    db
      .select()
      .from(lessonProgressTable)
      .where(eq(lessonProgressTable.userId, userId)),
  ]);

  // Group lessons by level for sequential unlock calculation
  const lessonsByLevel = new Map<number, typeof lessons>();
  for (const lesson of lessons) {
    const arr = lessonsByLevel.get(lesson.levelId) ?? [];
    arr.push(lesson);
    lessonsByLevel.set(lesson.levelId, arr);
  }

  const result = lessons.map((lesson) => {
    const levelOrder = levelOrderMap.get(lesson.levelId) ?? 999;
    const levelLessons = (lessonsByLevel.get(lesson.levelId) ?? []).sort(
      (a, b) => a.order - b.order,
    );
    const idx = levelLessons.findIndex((l) => l.id === lesson.id);
    const prevLessonId = idx > 0 ? levelLessons[idx - 1].id : null;
    const progressRow = progressRows.find((p) => p.lessonId === lesson.id);
    const state = deriveLessonStateWithOrders(
      lesson,
      levelOrder,
      currentLevelOrder,
      completedIds,
      prevLessonId,
      progressRow?.status,
    );

    return {
      id: lesson.id,
      levelId: lesson.levelId,
      title: lesson.title,
      titleAr: lesson.titleAr,
      description: lesson.description ?? null,
      descriptionAr: lesson.descriptionAr ?? null,
      order: lesson.order,
      lessonType: lesson.lessonType,
      estimatedMinutes: lesson.estimatedMinutes,
      state,
      // Legacy compatibility
      isUnlocked: state !== "LOCKED",
      isCompleted: state === "COMPLETED",
      bestScore: progressRow?.bestScore ?? null,
      xpReward: lesson.xpReward,
    };
  });

  res.json(result);
});

// ─── Lesson content bundle (cached) ──────────────────────────────────────────

interface LessonContentBundle {
  lesson: {
    id: number;
    levelId: number;
    title: string;
    titleAr: string;
    description: string | null;
    descriptionAr: string | null;
    order: number;
    lessonType: string;
    estimatedMinutes: number;
    xpReward: number;
    passingScore: number;
    contentVersion: number;
    objectives: string[] | null;
    objectivesAr: string[] | null;
  };
  levelCode: string;
  levelOrder: number;
  levelId: number;
  levelCurriculumId: number;
  contentBlocks: Array<{
    id: number;
    type: string;
    order: number;
    title: string | null;
    titleAr: string | null;
    instructions: string | null;
    instructionsAr: string | null;
    isRequired: boolean;
    estimatedMinutes: number | null;
    config: unknown;
    content: string | null;
    contentAr: string | null;
    audioNote: string | null;
    vocabularyItems: Array<{
      id: number;
      levelId: number;
      lessonId: number | null;
      word: string;
      translation: string;
      exampleSentence: string | null;
      exampleSentenceAr: string | null;
      pronunciation: string | null;
      audioNote: string | null;
    }> | null;
    exerciseId: number | null;
    exerciseType: string | null;
    question: string | null;
    questionAr: string | null;
    options: Array<{ id: string; text: string; textAr: string | null }> | null;
    prompt: string | null;
    promptAr: string | null;
    exampleAudio: string | null;
    audioUrl: string | null;
  }>;
}

async function loadLessonContent(lessonId: number): Promise<LessonContentBundle | null> {
  const [lesson] = await db
    .select()
    .from(lessonsTable)
    .where(and(eq(lessonsTable.id, lessonId), publishedLessonFilter()))
    .limit(1);
  if (!lesson) return null;

  const [level, blocks, exercises, vocab] = await Promise.all([
    db
      .select()
      .from(levelsTable)
      .where(eq(levelsTable.id, lesson.levelId))
      .limit(1)
      .then((r) => r[0]),
    db
      .select()
      .from(contentBlocksTable)
      .where(and(eq(contentBlocksTable.lessonId, lessonId), eq(contentBlocksTable.isActive, true)))
      .orderBy(asc(contentBlocksTable.order)),
    db.select().from(exercisesTable).where(eq(exercisesTable.lessonId, lessonId)),
    db.select().from(vocabularyTable).where(eq(vocabularyTable.lessonId, lessonId)),
  ]);

  const exerciseIds = exercises.map((e) => e.id);
  const allOptions =
    exerciseIds.length > 0
      ? await db
          .select()
          .from(exerciseOptionsTable)
          .where(inArray(exerciseOptionsTable.exerciseId, exerciseIds))
      : [];

  const contentBlocks = blocks.map((block) => {
    const exercise = exercises.find((e) => e.contentBlockId === block.id) ?? null;
    const options = exercise
      ? allOptions
          .filter((o) => o.exerciseId === exercise.id)
          .map((o) => ({ id: o.optionId, text: o.text, textAr: o.textAr ?? null }))
      : null;

    return {
      id: block.id,
      type: block.type,
      order: block.order,
      title: block.title ?? null,
      titleAr: block.titleAr ?? null,
      instructions: block.instructions ?? null,
      instructionsAr: block.instructionsAr ?? null,
      isRequired: block.isRequired,
      estimatedMinutes: block.estimatedMinutes ?? null,
      config: block.config ?? null,
      content: block.content ?? null,
      contentAr: block.contentAr ?? null,
      audioNote: block.audioNote ?? null,
      vocabularyItems:
        block.type === "vocabulary_list"
          ? vocab.map((v) => ({
              id: v.id,
              levelId: v.levelId,
              lessonId: v.lessonId ?? null,
              word: v.word,
              translation: v.translation,
              exampleSentence: v.exampleSentence ?? null,
              exampleSentenceAr: v.exampleSentenceAr ?? null,
              pronunciation: v.pronunciation ?? null,
              audioNote: v.audioNote ?? null,
            }))
          : null,
      exerciseId: exercise?.id ?? null,
      exerciseType: exercise?.exerciseType ?? null,
      question: exercise?.question ?? null,
      questionAr: exercise?.questionAr ?? null,
      // Never expose correctOptionId before submission
      options,
      prompt: block.prompt ?? null,
      promptAr: block.promptAr ?? null,
      exampleAudio: block.exampleAudio ?? null,
      audioUrl: resolveAudioUrl(block, exercise),
    };
  });

  return {
    lesson: {
      id: lesson.id,
      levelId: lesson.levelId,
      title: lesson.title,
      titleAr: lesson.titleAr,
      description: lesson.description ?? null,
      descriptionAr: lesson.descriptionAr ?? null,
      order: lesson.order,
      lessonType: lesson.lessonType,
      estimatedMinutes: lesson.estimatedMinutes,
      xpReward: lesson.xpReward,
      passingScore: lesson.passingScore,
      contentVersion: lesson.contentVersion,
      objectives: lesson.objectives ?? null,
      objectivesAr: lesson.objectivesAr ?? null,
    },
    levelCode: level?.code ?? "",
    levelOrder: level?.order ?? 1,
    levelId: level?.id ?? lesson.levelId,
    levelCurriculumId: level?.curriculumId ?? 0,
    contentBlocks,
  };
}

// ─── GET /lessons/:lessonId ───────────────────────────────────────────────────

router.get("/lessons/:lessonId", requireStudent, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.lessonId) ? req.params.lessonId[0] : req.params.lessonId;
  const lessonId = parseInt(raw, 10);
  if (isNaN(lessonId)) {
    res.status(400).json({ error: "Invalid lesson ID" });
    return;
  }

  const userId = req.session.userId!;

  // Load static content from cache
  const bundle = await cached(CK.lessonContent(lessonId), TTL.LESSON_CONTENT, () =>
    loadLessonContent(lessonId),
  );

  if (!bundle) {
    res.status(404).json({ error: "Lesson not found" });
    return;
  }

  // Enforce curriculum access
  const ctx = await getStudentCurriculumContext(userId);
  if (!ctx || ctx.curriculumId !== bundle.levelCurriculumId) {
    res.status(403).json({ error: "You do not have access to this lesson" });
    return;
  }

  const [completedIds, progressRow, currentLevel] = await Promise.all([
    getCompletedLessonIds(userId),
    db
      .select()
      .from(lessonProgressTable)
      .where(
        and(
          eq(lessonProgressTable.userId, userId),
          eq(lessonProgressTable.lessonId, lessonId),
        ),
      )
      .limit(1)
      .then((r) => r[0] ?? null),
    ctx.currentLevelId
      ? db
          .select({ order: levelsTable.order })
          .from(levelsTable)
          .where(eq(levelsTable.id, ctx.currentLevelId))
          .limit(1)
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
  ]);

  // Find the previous lesson in order for unlock derivation
  const prevLessonId = await (async () => {
    if (bundle.lesson.order <= 1) return null;
    const siblings = await db
      .select({ id: lessonsTable.id, order: lessonsTable.order })
      .from(lessonsTable)
      .where(
        and(
          eq(lessonsTable.levelId, bundle.lesson.levelId),
          eq(lessonsTable.status, "published"),
          isNull(lessonsTable.softDeletedAt),
        ),
      )
      .orderBy(asc(lessonsTable.order));
    const idx = siblings.findIndex((l) => l.id === lessonId);
    return idx > 0 ? siblings[idx - 1].id : null;
  })();

  const currentLevelOrder = currentLevel?.order ?? null;
  const state = deriveLessonStateWithOrders(
    bundle.lesson,
    bundle.levelOrder,
    currentLevelOrder,
    completedIds,
    prevLessonId,
    progressRow?.status,
  );

  // Enforce that locked lessons are not accessible for detail
  if (state === "LOCKED") {
    res.status(403).json({ error: "This lesson is locked" });
    return;
  }

  const completedBlockIds = await getCompletedBlockIds(
    userId,
    lessonId,
    bundle.lesson.contentVersion,
  );

  res.json({
    id: bundle.lesson.id,
    levelId: bundle.lesson.levelId,
    levelCode: bundle.levelCode,
    title: bundle.lesson.title,
    titleAr: bundle.lesson.titleAr,
    description: bundle.lesson.description,
    descriptionAr: bundle.lesson.descriptionAr,
    order: bundle.lesson.order,
    lessonType: bundle.lesson.lessonType,
    estimatedMinutes: bundle.lesson.estimatedMinutes,
    contentVersion: bundle.lesson.contentVersion,
    state,
    // Legacy
    isUnlocked: true,
    isCompleted: state === "COMPLETED",
    bestScore: progressRow?.bestScore ?? null,
    xpReward: bundle.lesson.xpReward,
    passingScore: bundle.lesson.passingScore,
    contentBlocks: bundle.contentBlocks,
    completedBlockIds,
    objectives: bundle.lesson.objectives,
    objectivesAr: bundle.lesson.objectivesAr,
  });
});

// ─── POST /lessons/:lessonId/start ────────────────────────────────────────────

router.post("/lessons/:lessonId/start", requireStudent, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.lessonId) ? req.params.lessonId[0] : req.params.lessonId;
  const lessonId = parseInt(raw, 10);
  const userId = req.session.userId!;

  if (isNaN(lessonId)) {
    res.status(400).json({ error: "Invalid lesson ID" });
    return;
  }

  const [lessonRow] = await db
    .select()
    .from(lessonsTable)
    .where(and(eq(lessonsTable.id, lessonId), publishedLessonFilter()))
    .limit(1);

  if (!lessonRow) {
    res.status(404).json({ error: "Lesson not found" });
    return;
  }

  // Enforce curriculum access
  const ctx = await getStudentCurriculumContext(userId);
  if (!ctx) {
    res.status(403).json({ error: "No curriculum assigned" });
    return;
  }

  const [level] = await db
    .select()
    .from(levelsTable)
    .where(eq(levelsTable.id, lessonRow.levelId))
    .limit(1);

  if (!level || level.curriculumId !== ctx.curriculumId) {
    res.status(403).json({ error: "This lesson does not belong to your curriculum" });
    return;
  }

  // Check unlock state
  const [completedIds, currentLevel] = await Promise.all([
    getCompletedLessonIds(userId),
    ctx.currentLevelId
      ? db
          .select({ order: levelsTable.order })
          .from(levelsTable)
          .where(eq(levelsTable.id, ctx.currentLevelId))
          .limit(1)
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
  ]);

  const siblings = await db
    .select({ id: lessonsTable.id, order: lessonsTable.order })
    .from(lessonsTable)
    .where(
      and(
        eq(lessonsTable.levelId, lessonRow.levelId),
        publishedLessonFilter(),
      ),
    )
    .orderBy(asc(lessonsTable.order));

  const idx = siblings.findIndex((l) => l.id === lessonId);
  const prevLessonId = idx > 0 ? siblings[idx - 1].id : null;
  const currentLevelOrder = currentLevel?.order ?? null;

  const state = deriveLessonStateWithOrders(
    lessonRow,
    level.order,
    currentLevelOrder,
    completedIds,
    prevLessonId,
    null,
  );

  if (state === "LOCKED") {
    res.status(403).json({ error: "This lesson is locked" });
    return;
  }

  const [existing] = await db
    .select()
    .from(lessonProgressTable)
    .where(
      and(
        eq(lessonProgressTable.userId, userId),
        eq(lessonProgressTable.lessonId, lessonId),
      ),
    )
    .limit(1);

  if (existing) {
    // Preserve completed revisit history — don't overwrite completedAt/passed
    if (existing.status === "not_started" || existing.status === "completed" || existing.status === "passed" || existing.status === "failed") {
      await db
        .update(lessonProgressTable)
        .set({ status: "in_progress", startedAt: existing.startedAt ?? new Date() })
        .where(eq(lessonProgressTable.id, existing.id));
    }
    res.json({
      ...existing,
      status: "in_progress",
      startedAt: existing.startedAt ?? new Date(),
      nextLessonUnlocked: false,
    });
    return;
  }

  const [progress] = await db
    .insert(lessonProgressTable)
    .values({
      userId,
      lessonId,
      contentVersion: lessonRow.contentVersion,
      status: "in_progress",
      attempts: 0,
      passed: false,
      xpEarned: 0,
      startedAt: new Date(),
    })
    .returning();

  res.json({ ...progress, nextLessonUnlocked: false });
});

// ─── POST /lessons/:lessonId/blocks/:blockId/submit ───────────────────────────

const submitBlockSchema = z.object({
  clientSubmissionId: z.string().min(1),
  selectedOptionId: z.string().optional(),
  responseText: z.string().optional(),
  mediaReference: z.string().optional(),
  recordingDurationSeconds: z.number().int().min(0).optional(),
  timeSpentSeconds: z.number().int().min(0).optional(),
});

router.post(
  "/lessons/:lessonId/blocks/:blockId/submit",
  requireStudent,
  async (req, res): Promise<void> => {
    const lessonId = parseInt(
      Array.isArray(req.params.lessonId) ? req.params.lessonId[0] : req.params.lessonId,
      10,
    );
    const blockId = parseInt(
      Array.isArray(req.params.blockId) ? req.params.blockId[0] : req.params.blockId,
      10,
    );
    const userId = req.session.userId!;

    if (isNaN(lessonId) || isNaN(blockId)) {
      res.status(400).json({ error: "Invalid lesson or block ID" });
      return;
    }

    const parsed = submitBlockSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.errors.map((e) => ({ path: e.path.join("."), message: e.message })),
      });
      return;
    }

    const {
      clientSubmissionId,
      selectedOptionId,
      responseText,
      mediaReference,
      recordingDurationSeconds,
    } = parsed.data;

    // Idempotency check
    const [existingAttempt] = await db
      .select()
      .from(learningActivityAttemptsTable)
      .where(
        and(
          eq(learningActivityAttemptsTable.userId, userId),
          eq(learningActivityAttemptsTable.clientSubmissionId, clientSubmissionId),
        ),
      )
      .limit(1);

    if (existingAttempt) {
      res.json({
        attemptId: existingAttempt.id,
        blockId: existingAttempt.blockId,
        completed: true,
        correct: existingAttempt.isCorrect ?? null,
        score: existingAttempt.score ?? null,
        evaluationStatus: existingAttempt.evaluationStatus,
      });
      return;
    }

    // Validate lesson is published and accessible
    const [lessonRow] = await db
      .select()
      .from(lessonsTable)
      .where(and(eq(lessonsTable.id, lessonId), publishedLessonFilter()))
      .limit(1);

    if (!lessonRow) {
      res.status(404).json({ error: "Lesson not found" });
      return;
    }

    // Validate block belongs to lesson and is active
    const [block] = await db
      .select()
      .from(contentBlocksTable)
      .where(
        and(
          eq(contentBlocksTable.id, blockId),
          eq(contentBlocksTable.lessonId, lessonId),
          eq(contentBlocksTable.isActive, true),
        ),
      )
      .limit(1);

    if (!block) {
      res.status(404).json({ error: "Block not found in this lesson" });
      return;
    }

    // Enforce curriculum access
    const ctx = await getStudentCurriculumContext(userId);
    if (!ctx) {
      res.status(403).json({ error: "No curriculum assigned" });
      return;
    }

    const [level] = await db
      .select({ curriculumId: levelsTable.curriculumId })
      .from(levelsTable)
      .where(eq(levelsTable.id, lessonRow.levelId))
      .limit(1);

    if (!level || level.curriculumId !== ctx.curriculumId) {
      res.status(403).json({ error: "This lesson does not belong to your curriculum" });
      return;
    }

    // Find exercise for this block (if any)
    const [exercise] = await db
      .select()
      .from(exercisesTable)
      .where(
        and(
          eq(exercisesTable.contentBlockId, blockId),
          eq(exercisesTable.lessonId, lessonId),
        ),
      )
      .limit(1);

    let activityType = "passive";
    let isCorrect: boolean | null = null;
    let score: number | null = null;
    let evaluationStatus: "graded" | "pending" | "skipped" = "skipped";
    let explanation: string | null = null;
    let explanationAr: string | null = null;

    if (exercise) {
      activityType = exercise.exerciseType;

      if (exercise.exerciseType === "mcq") {
        if (!selectedOptionId) {
          res.status(400).json({ error: "selectedOptionId is required for MCQ" });
          return;
        }

        // Validate option belongs to this exercise
        const [option] = await db
          .select()
          .from(exerciseOptionsTable)
          .where(
            and(
              eq(exerciseOptionsTable.exerciseId, exercise.id),
              eq(exerciseOptionsTable.optionId, selectedOptionId),
            ),
          )
          .limit(1);

        if (!option) {
          res.status(400).json({ error: "Invalid option for this exercise" });
          return;
        }

        // Server-side grading — never trust client
        isCorrect = exercise.correctOptionId === selectedOptionId;
        score = isCorrect ? 100 : 0;
        evaluationStatus = "graded";
        explanation = exercise.explanation ?? null;
        explanationAr = exercise.explanationAr ?? null;
      } else if (
        exercise.exerciseType === "speaking" ||
        exercise.exerciseType === "pronunciation"
      ) {
        // Accept recorded metadata; score async
        evaluationStatus = "pending";
        isCorrect = null;
        score = null;
      } else {
        // open_ended, fill_blank, translation
        evaluationStatus = "pending";
        isCorrect = null;
        score = null;
      }
    }

    // Persist attempt
    const [attempt] = await db
      .insert(learningActivityAttemptsTable)
      .values({
        userId,
        lessonId,
        blockId,
        exerciseId: exercise?.id ?? null,
        contentVersion: lessonRow.contentVersion,
        activityType,
        clientSubmissionId,
        selectedOptionId: selectedOptionId ?? null,
        responseText: responseText ?? null,
        mediaReference: mediaReference ?? null,
        recordingDurationSeconds: recordingDurationSeconds ?? null,
        isCorrect,
        score,
        evaluationStatus,
        metadata: null,
      })
      .returning();

    // Mark block progress complete
    await db
      .insert(lessonBlockProgressTable)
      .values({
        userId,
        lessonId,
        blockId,
        contentVersion: lessonRow.contentVersion,
        completedAt: new Date(),
      })
      .onConflictDoNothing();

    const responsePayload: Record<string, unknown> = {
      attemptId: attempt.id,
      blockId,
      completed: true,
      correct: isCorrect,
      score,
      evaluationStatus,
    };

    // Only expose explanation after MCQ submission
    if (exercise?.exerciseType === "mcq") {
      responsePayload.explanation = explanation;
      responsePayload.explanationAr = explanationAr;
    }

    res.json(responsePayload);
  },
);

// ─── POST /lessons/:lessonId/complete ─────────────────────────────────────────

router.post("/lessons/:lessonId/complete", requireStudent, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.lessonId) ? req.params.lessonId[0] : req.params.lessonId;
  const lessonId = parseInt(raw, 10);
  const userId = req.session.userId!;

  if (isNaN(lessonId)) {
    res.status(400).json({ error: "Invalid lesson ID" });
    return;
  }

  const bodySchema = z.object({
    timeSpentSeconds: z.number().int().min(0).optional(),
  });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const { timeSpentSeconds } = parsed.data;

  const [lesson] = await db
    .select()
    .from(lessonsTable)
    .where(and(eq(lessonsTable.id, lessonId), publishedLessonFilter()))
    .limit(1);

  if (!lesson) {
    res.status(404).json({ error: "Lesson not found" });
    return;
  }

  // Enforce curriculum access
  const ctx = await getStudentCurriculumContext(userId);
  if (!ctx) {
    res.status(403).json({ error: "No curriculum assigned" });
    return;
  }

  const [level] = await db
    .select({ curriculumId: levelsTable.curriculumId })
    .from(levelsTable)
    .where(eq(levelsTable.id, lesson.levelId))
    .limit(1);

  if (!level || level.curriculumId !== ctx.curriculumId) {
    res.status(403).json({ error: "This lesson does not belong to your curriculum" });
    return;
  }

  // Check for missing required blocks
  const missingRequiredBlockIds = await getMissingRequiredBlockIds(
    userId,
    lessonId,
    lesson.contentVersion,
  );

  if (missingRequiredBlockIds.length > 0) {
    res.status(422).json({
      error: "Required blocks not completed",
      missingRequiredBlockIds,
    });
    return;
  }

  // Derive score server-side — ignore any client-submitted score
  const score = await deriveLessonScore(userId, lessonId, lesson.contentVersion);
  const passed = score >= lesson.passingScore;
  const xpEarned = passed ? lesson.xpReward : Math.floor(lesson.xpReward * 0.25);

  const [existing] = await db
    .select()
    .from(lessonProgressTable)
    .where(
      and(
        eq(lessonProgressTable.userId, userId),
        eq(lessonProgressTable.lessonId, lessonId),
      ),
    )
    .limit(1);

  let progress;

  if (existing) {
    const newBest =
      existing.bestScore === null ? score : Math.max(existing.bestScore, score);
    const wasAlreadyPassed = existing.passed;

    [progress] = await db
      .update(lessonProgressTable)
      .set({
        status: passed ? "passed" : "completed",
        lastScore: score,
        bestScore: newBest,
        attempts: existing.attempts + 1,
        passed: wasAlreadyPassed || passed,
        // Award XP only once
        xpEarned: wasAlreadyPassed ? existing.xpEarned : passed ? xpEarned : existing.xpEarned,
        // Preserve original completedAt on revisits if already completed
        completedAt: existing.completedAt ?? new Date(),
        timeSpentSeconds: existing.timeSpentSeconds + (timeSpentSeconds ?? 0),
      })
      .where(eq(lessonProgressTable.id, existing.id))
      .returning();

    if (passed && !wasAlreadyPassed) {
      await db
        .update(studentProfilesTable)
        .set({ totalXp: sql`total_xp + ${xpEarned}` })
        .where(eq(studentProfilesTable.userId, userId));
    }
  } else {
    [progress] = await db
      .insert(lessonProgressTable)
      .values({
        userId,
        lessonId,
        contentVersion: lesson.contentVersion,
        status: passed ? "passed" : "completed",
        lastScore: score,
        bestScore: score,
        attempts: 1,
        passed,
        xpEarned,
        timeSpentSeconds: timeSpentSeconds ?? 0,
        startedAt: new Date(),
        completedAt: new Date(),
      })
      .returning();

    if (passed) {
      await db
        .update(studentProfilesTable)
        .set({ totalXp: sql`total_xp + ${xpEarned}` })
        .where(eq(studentProfilesTable.userId, userId));
    }
  }

  // Maybe advance to next level
  const { advanced, newLevelId } = await maybeAdvanceLevel(userId, lessonId);

  // Find next lesson
  const nextLessonRow = await findNextLesson(lessonId);

  res.json({
    ...progress,
    score,
    nextLessonId: nextLessonRow?.id ?? null,
    nextLessonUnlocked: passed && !!nextLessonRow,
    levelAdvanced: advanced,
    newLevelId,
  });
});

// ─── GET /lessons/:lessonId/progress ─────────────────────────────────────────

router.get("/lessons/:lessonId/progress", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.lessonId) ? req.params.lessonId[0] : req.params.lessonId;
  const lessonId = parseInt(raw, 10);
  const userId = req.session.userId!;

  if (isNaN(lessonId)) {
    res.status(400).json({ error: "Invalid lesson ID" });
    return;
  }

  const [progress] = await db
    .select()
    .from(lessonProgressTable)
    .where(
      and(
        eq(lessonProgressTable.userId, userId),
        eq(lessonProgressTable.lessonId, lessonId),
      ),
    )
    .limit(1);

  if (!progress) {
    res.status(404).json({ error: "No progress found" });
    return;
  }

  res.json({ ...progress, nextLessonUnlocked: false });
});

export default router;

import { Router, type IRouter } from "express";
import { eq, and, asc, inArray, sql } from "drizzle-orm";
import {
  db, lessonsTable, levelsTable, contentBlocksTable, exercisesTable, exerciseOptionsTable,
  lessonProgressTable, vocabularyTable, studentProfilesTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

async function getCompletedLessonIds(userId: number): Promise<Set<number>> {
  const rows = await db.select({ lessonId: lessonProgressTable.lessonId })
    .from(lessonProgressTable)
    .where(and(eq(lessonProgressTable.userId, userId), eq(lessonProgressTable.passed, true)));
  return new Set(rows.map((r) => r.lessonId));
}

router.get("/lessons", async (req, res): Promise<void> => {
  const levelId = req.query.levelId ? parseInt(req.query.levelId as string, 10) : undefined;
  const userId = req.session?.userId;

  const where = levelId
    ? and(eq(lessonsTable.levelId, levelId), eq(lessonsTable.isPublished, true))
    : eq(lessonsTable.isPublished, true);

  const [lessons, completedIds] = await Promise.all([
    db.select().from(lessonsTable).where(where).orderBy(asc(lessonsTable.order)),
    userId ? getCompletedLessonIds(userId) : Promise.resolve(new Set<number>()),
  ]);

  const [profile, levels, progressRows] = await Promise.all([
    userId
      ? db.select().from(studentProfilesTable).where(eq(studentProfilesTable.userId, userId)).limit(1).then(r => r[0] ?? null)
      : Promise.resolve(null),
    (() => {
      const levelIds = [...new Set(lessons.map((l) => l.levelId))];
      return levelIds.length > 0
        ? db.select().from(levelsTable).where(inArray(levelsTable.id, levelIds))
        : Promise.resolve([]);
    })(),
    userId
      ? db.select().from(lessonProgressTable).where(eq(lessonProgressTable.userId, userId))
      : Promise.resolve([]),
  ]);

  const currentLevelId = profile?.currentLevelId ?? null;
  const levelMap = new Map(levels.map((lv) => [lv.id, lv]));

  const result = lessons.map((lesson) => {
    const prev = lessons
      .filter((l) => l.levelId === lesson.levelId && l.order < lesson.order)
      .sort((a, b) => b.order - a.order)[0];
    const level = levelMap.get(lesson.levelId);
    const levelUnlocked = lesson.levelId === currentLevelId || (level?.order ?? 999) <= 1;
    const isUnlocked = lesson.order === 1 ? levelUnlocked : (prev ? completedIds.has(prev.id) : false);
    const progress = progressRows.find((p) => p.lessonId === lesson.id);
    return {
      id: lesson.id,
      levelId: lesson.levelId,
      levelCode: level?.code ?? "",
      title: lesson.title,
      titleAr: lesson.titleAr,
      description: lesson.description ?? null,
      descriptionAr: lesson.descriptionAr ?? null,
      order: lesson.order,
      lessonType: lesson.lessonType,
      estimatedMinutes: lesson.estimatedMinutes,
      isUnlocked,
      isCompleted: completedIds.has(lesson.id),
      bestScore: progress?.bestScore ?? null,
      xpReward: lesson.xpReward,
    };
  });

  res.json(result);
});

router.get("/lessons/:lessonId", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.lessonId) ? req.params.lessonId[0] : req.params.lessonId;
  const lessonId = parseInt(raw, 10);
  if (isNaN(lessonId)) { res.status(400).json({ error: "Invalid lesson ID" }); return; }

  const [lesson] = await db.select().from(lessonsTable).where(eq(lessonsTable.id, lessonId)).limit(1);
  if (!lesson) { res.status(404).json({ error: "Lesson not found" }); return; }

  const userId = req.session?.userId;

  // Fetch all lesson content in parallel
  const [level, blocks, exercises, vocab, progress] = await Promise.all([
    db.select().from(levelsTable).where(eq(levelsTable.id, lesson.levelId)).limit(1).then(r => r[0]),
    db.select().from(contentBlocksTable)
      .where(eq(contentBlocksTable.lessonId, lessonId))
      .orderBy(asc(contentBlocksTable.order)),
    db.select().from(exercisesTable).where(eq(exercisesTable.lessonId, lessonId)),
    db.select().from(vocabularyTable).where(eq(vocabularyTable.lessonId, lessonId)),
    userId
      ? db.select().from(lessonProgressTable)
          .where(and(eq(lessonProgressTable.userId, userId), eq(lessonProgressTable.lessonId, lessonId)))
          .limit(1)
          .then(r => r[0])
      : Promise.resolve(undefined),
  ]);

  // Fetch exercise options for THIS lesson's exercises only (was a full-table scan bug)
  const exerciseIds = exercises.map((e) => e.id);
  const allExerciseOptions = exerciseIds.length > 0
    ? await db.select().from(exerciseOptionsTable)
        .where(inArray(exerciseOptionsTable.exerciseId, exerciseIds))
    : [];

  // Unlock logic
  const completedIds = userId ? await getCompletedLessonIds(userId) : new Set<number>();
  const prevLesson = lesson.order > 1
    ? await db.select().from(lessonsTable)
        .where(and(eq(lessonsTable.levelId, lesson.levelId), eq(lessonsTable.order, lesson.order - 1)))
        .limit(1)
        .then(r => r[0] ?? null)
    : null;

  let profile = null;
  if (userId) {
    profile = await db.select().from(studentProfilesTable)
      .where(eq(studentProfilesTable.userId, userId))
      .limit(1)
      .then(r => r[0] ?? null);
  }
  const currentLevelId = profile?.currentLevelId ?? null;
  const levelUnlocked = level?.id === currentLevelId || level?.order === 1;
  const isUnlocked = lesson.order === 1 ? levelUnlocked : (prevLesson ? completedIds.has(prevLesson.id) : false);

  const contentBlocks = blocks.map((block) => {
    const exercise = exercises.find((e) => e.contentBlockId === block.id);
    const vocabItems = block.type === "vocabulary_list" ? vocab : [];
    const options = exercise
      ? allExerciseOptions
          .filter((o) => o.exerciseId === exercise.id)
          .map((o) => ({ id: o.optionId, text: o.text, textAr: o.textAr ?? null }))
      : null;

    return {
      id: block.id,
      type: block.type,
      order: block.order,
      content: block.content ?? null,
      contentAr: block.contentAr ?? null,
      audioNote: block.audioNote ?? null,
      vocabularyItems: block.type === "vocabulary_list"
        ? vocabItems.map((v) => ({
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
      question: exercise?.question ?? null,
      questionAr: exercise?.questionAr ?? null,
      options,
      prompt: block.prompt ?? null,
      promptAr: block.promptAr ?? null,
      exampleAudio: block.exampleAudio ?? null,
    };
  });

  res.json({
    id: lesson.id,
    levelId: lesson.levelId,
    levelCode: level?.code ?? "",
    title: lesson.title,
    titleAr: lesson.titleAr,
    description: lesson.description ?? null,
    descriptionAr: lesson.descriptionAr ?? null,
    order: lesson.order,
    lessonType: lesson.lessonType,
    estimatedMinutes: lesson.estimatedMinutes,
    isUnlocked,
    isCompleted: completedIds.has(lesson.id),
    bestScore: progress?.bestScore ?? null,
    xpReward: lesson.xpReward,
    passingScore: lesson.passingScore,
    contentBlocks,
    objectives: lesson.objectives ?? null,
    objectivesAr: lesson.objectivesAr ?? null,
  });
});

router.post("/lessons/:lessonId/start", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.lessonId) ? req.params.lessonId[0] : req.params.lessonId;
  const lessonId = parseInt(raw, 10);
  const userId = req.session.userId!;

  if (isNaN(lessonId)) { res.status(400).json({ error: "Invalid lesson ID" }); return; }

  const [existing] = await db.select().from(lessonProgressTable)
    .where(and(eq(lessonProgressTable.userId, userId), eq(lessonProgressTable.lessonId, lessonId)))
    .limit(1);

  if (existing) {
    if (existing.status === "not_started") {
      await db.update(lessonProgressTable)
        .set({ status: "in_progress", startedAt: new Date() })
        .where(eq(lessonProgressTable.id, existing.id));
    }
    res.json({ ...existing, status: "in_progress", startedAt: existing.startedAt ?? new Date(), nextLessonUnlocked: false });
    return;
  }

  const [progress] = await db.insert(lessonProgressTable).values({
    userId,
    lessonId,
    status: "in_progress",
    attempts: 0,
    passed: false,
    xpEarned: 0,
    startedAt: new Date(),
  }).returning();

  res.json({ ...progress, nextLessonUnlocked: false });
});

router.post("/lessons/:lessonId/complete", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.lessonId) ? req.params.lessonId[0] : req.params.lessonId;
  const lessonId = parseInt(raw, 10);
  const userId = req.session.userId!;

  if (isNaN(lessonId)) { res.status(400).json({ error: "Invalid lesson ID" }); return; }

  const { score, totalQuestions, correctAnswers, speakingScore, timeSpentSeconds } = req.body;

  if (typeof score !== "number" || score < 0 || score > 100) {
    res.status(400).json({ error: "score must be a number between 0 and 100" });
    return;
  }

  const [lesson] = await db.select().from(lessonsTable).where(eq(lessonsTable.id, lessonId)).limit(1);
  if (!lesson) { res.status(404).json({ error: "Lesson not found" }); return; }

  const passed = score >= lesson.passingScore;
  const xpEarned = passed ? lesson.xpReward : Math.floor(lesson.xpReward * 0.25);

  const [existing] = await db.select().from(lessonProgressTable)
    .where(and(eq(lessonProgressTable.userId, userId), eq(lessonProgressTable.lessonId, lessonId)))
    .limit(1);

  let progress;
  if (existing) {
    const newBest = existing.bestScore === null ? score : Math.max(existing.bestScore, score);
    const wasAlreadyPassed = existing.passed;
    [progress] = await db.update(lessonProgressTable).set({
      status: passed ? "passed" : "failed",
      lastScore: score,
      bestScore: newBest,
      speakingScore: speakingScore ?? existing.speakingScore,
      attempts: existing.attempts + 1,
      passed: wasAlreadyPassed || passed,
      xpEarned: wasAlreadyPassed ? existing.xpEarned : (passed ? xpEarned : existing.xpEarned),
      completedAt: new Date(),
    }).where(eq(lessonProgressTable.id, existing.id)).returning();

    // Award XP atomically using SQL increment — no race condition
    if (passed && !wasAlreadyPassed) {
      await db.update(studentProfilesTable)
        .set({ totalXp: sql`total_xp + ${xpEarned}` })
        .where(eq(studentProfilesTable.userId, userId));
    }
  } else {
    [progress] = await db.insert(lessonProgressTable).values({
      userId,
      lessonId,
      status: passed ? "passed" : "failed",
      lastScore: score,
      bestScore: score,
      speakingScore: speakingScore ?? null,
      attempts: 1,
      passed,
      xpEarned,
      timeSpentSeconds: timeSpentSeconds ?? 0,
      startedAt: new Date(),
      completedAt: new Date(),
    }).returning();

    // Award XP atomically using SQL increment
    if (passed) {
      await db.update(studentProfilesTable)
        .set({ totalXp: sql`total_xp + ${xpEarned}` })
        .where(eq(studentProfilesTable.userId, userId));
    }
  }

  // Check if next lesson was unlocked
  const [nextLesson] = await db.select().from(lessonsTable)
    .where(and(eq(lessonsTable.levelId, lesson.levelId), eq(lessonsTable.order, lesson.order + 1)))
    .limit(1);

  res.json({ ...progress, nextLessonUnlocked: passed && !!nextLesson });
});

router.get("/lessons/:lessonId/progress", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.lessonId) ? req.params.lessonId[0] : req.params.lessonId;
  const lessonId = parseInt(raw, 10);
  const userId = req.session.userId!;

  if (isNaN(lessonId)) { res.status(400).json({ error: "Invalid lesson ID" }); return; }

  const [progress] = await db.select().from(lessonProgressTable)
    .where(and(eq(lessonProgressTable.userId, userId), eq(lessonProgressTable.lessonId, lessonId)))
    .limit(1);

  if (!progress) { res.status(404).json({ error: "No progress found" }); return; }

  res.json({ ...progress, nextLessonUnlocked: false });
});

export default router;

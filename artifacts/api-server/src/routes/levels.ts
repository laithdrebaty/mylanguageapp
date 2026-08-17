import { Router, type IRouter } from "express";
import { eq, asc, and } from "drizzle-orm";
import { db, levelsTable, lessonsTable, lessonProgressTable, studentProfilesTable, curriculaTable } from "@workspace/db";

const router: IRouter = Router();

async function getCompletedLessonIds(userId: number | undefined): Promise<Set<number>> {
  if (!userId) return new Set();
  const rows = await db
    .select({ lessonId: lessonProgressTable.lessonId })
    .from(lessonProgressTable)
    .where(and(eq(lessonProgressTable.userId, userId), eq(lessonProgressTable.passed, true)));
  return new Set(rows.map((r) => r.lessonId));
}

/** Resolve which curriculum to use: from query param or student's enrolled curriculum or platform default */
async function resolveCurriculumId(
  queryCurriculumId: number | undefined,
  userId: number | undefined,
): Promise<number | null> {
  if (queryCurriculumId) return queryCurriculumId;

  if (userId) {
    const [profile] = await db
      .select({ curriculumId: studentProfilesTable.curriculumId })
      .from(studentProfilesTable)
      .where(eq(studentProfilesTable.userId, userId))
      .limit(1);
    if (profile?.curriculumId) return profile.curriculumId;
  }

  // Fall back to the first active curriculum
  const [defaultC] = await db
    .select({ id: curriculaTable.id })
    .from(curriculaTable)
    .where(eq(curriculaTable.isActive, true))
    .orderBy(curriculaTable.id)
    .limit(1);
  return defaultC?.id ?? null;
}

router.get("/levels", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  const queryCurriculumId = req.query.curriculumId ? parseInt(req.query.curriculumId as string, 10) : undefined;
  const curriculumId = await resolveCurriculumId(queryCurriculumId, userId);

  const where = curriculumId ? eq(levelsTable.curriculumId, curriculumId) : undefined;
  const levels = await db
    .select()
    .from(levelsTable)
    .where(where)
    .orderBy(asc(levelsTable.order));

  const completedIds = await getCompletedLessonIds(userId);
  const allLessons = curriculumId
    ? await db.select().from(lessonsTable)
    : [];

  let profile = null;
  if (userId) {
    const [p] = await db
      .select()
      .from(studentProfilesTable)
      .where(eq(studentProfilesTable.userId, userId))
      .limit(1);
    profile = p;
  }
  const currentLevelId = profile?.currentLevelId ?? null;

  const result = levels.map((level) => {
    const levelLessons = allLessons.filter((l) => l.levelId === level.id && l.isPublished);
    const completedInLevel = levelLessons.filter((l) => completedIds.has(l.id)).length;
    const isCurrentLevel = level.id === currentLevelId;
    const isUnlocked = isCurrentLevel || level.order === 1;
    const isCompleted = levelLessons.length > 0 && completedInLevel === levelLessons.length;
    return {
      id: level.id,
      curriculumId: level.curriculumId,
      code: level.code,
      name: level.name,
      nameAr: level.nameAr,
      description: level.description ?? null,
      descriptionAr: level.descriptionAr ?? null,
      order: level.order,
      totalLessons: levelLessons.length,
      completedLessons: completedInLevel,
      isUnlocked,
      isCompleted,
    };
  });

  res.json(result);
});

router.get("/levels/:levelId", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.levelId) ? req.params.levelId[0] : req.params.levelId;
  const levelId = parseInt(raw, 10);
  if (isNaN(levelId)) { res.status(400).json({ error: "Invalid level ID" }); return; }

  const [level] = await db
    .select()
    .from(levelsTable)
    .where(eq(levelsTable.id, levelId))
    .limit(1);
  if (!level) { res.status(404).json({ error: "Level not found" }); return; }

  const userId = req.session?.userId;
  const completedIds = await getCompletedLessonIds(userId);

  let profile = null;
  if (userId) {
    const [p] = await db
      .select()
      .from(studentProfilesTable)
      .where(eq(studentProfilesTable.userId, userId))
      .limit(1);
    profile = p;
  }
  const currentLevelId = profile?.currentLevelId ?? null;

  const levelLessons = await db
    .select()
    .from(lessonsTable)
    .where(and(eq(lessonsTable.levelId, levelId), eq(lessonsTable.isPublished, true)))
    .orderBy(asc(lessonsTable.order));

  const completedInLevel = levelLessons.filter((l) => completedIds.has(l.id)).length;
  const isCurrentLevel = level.id === currentLevelId;
  const isUnlocked = isCurrentLevel || level.order === 1;
  const isCompleted = levelLessons.length > 0 && completedInLevel === levelLessons.length;

  const lessonSummaries = levelLessons.map((lesson, idx) => {
    const unlocked = idx === 0 ? isUnlocked : completedIds.has(levelLessons[idx - 1].id);
    return {
      id: lesson.id,
      levelId: lesson.levelId,
      levelCode: level.code,
      title: lesson.title,
      titleAr: lesson.titleAr,
      description: lesson.description ?? null,
      descriptionAr: lesson.descriptionAr ?? null,
      order: lesson.order,
      lessonType: lesson.lessonType,
      estimatedMinutes: lesson.estimatedMinutes,
      isUnlocked: unlocked,
      isCompleted: completedIds.has(lesson.id),
      bestScore: null,
      xpReward: lesson.xpReward,
    };
  });

  res.json({
    id: level.id,
    curriculumId: level.curriculumId,
    code: level.code,
    name: level.name,
    nameAr: level.nameAr,
    description: level.description ?? null,
    descriptionAr: level.descriptionAr ?? null,
    order: level.order,
    totalLessons: levelLessons.length,
    completedLessons: completedInLevel,
    isUnlocked,
    isCompleted,
    lessons: lessonSummaries,
  });
});

export default router;

import { Router, type IRouter } from "express";
import { eq, and, gte, desc, inArray, sql } from "drizzle-orm";
import {
  db, usersTable, studentProfilesTable, lessonProgressTable,
  lessonsTable, levelsTable, studentSubscriptionsTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/dashboard", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId!;

  // Fetch user + profile in parallel (independent queries)
  const [[user], [profile], [subscription]] = await Promise.all([
    db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1),
    db.select().from(studentProfilesTable).where(eq(studentProfilesTable.userId, userId)).limit(1),
    db.select().from(studentSubscriptionsTable)
      .where(and(eq(studentSubscriptionsTable.userId, userId), eq(studentSubscriptionsTable.status, "active")))
      .limit(1),
  ]);

  if (!user || !profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }

  // Fetch current level + all progress in parallel
  const [[currentLevel], allProgress] = await Promise.all([
    profile.currentLevelId
      ? db.select().from(levelsTable).where(eq(levelsTable.id, profile.currentLevelId)).limit(1)
      : Promise.resolve([undefined]),
    db.select().from(lessonProgressTable).where(eq(lessonProgressTable.userId, userId)),
  ]);

  const allLessonsInLevel = currentLevel
    ? await db
        .select()
        .from(lessonsTable)
        .where(and(eq(lessonsTable.levelId, currentLevel.id), eq(lessonsTable.isPublished, true)))
    : [];

  const passedIds = new Set(allProgress.filter((p) => p.passed).map((p) => p.lessonId));
  const completedInLevel = allLessonsInLevel.filter((l) => passedIds.has(l.id)).length;

  const nextLesson = [...allLessonsInLevel]
    .sort((a, b) => a.order - b.order)
    .find((l) => !passedIds.has(l.id));

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weeklyCompleted = allProgress.filter(
    (p) => p.completedAt && p.completedAt >= weekAgo && p.passed,
  );
  const xpThisWeek = weeklyCompleted.reduce((sum, p) => sum + p.xpEarned, 0);

  // Get 5 most recent completed lessons
  const recentProgress = allProgress
    .filter((p) => p.completedAt !== null)
    .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0))
    .slice(0, 5);

  // Batch-fetch recent lessons in one query (was N+1)
  const recentLessons: Array<{
    lessonId: number;
    lessonTitle: string;
    lessonTitleAr: string;
    completedAt: string;
    score: number;
    passed: boolean;
  }> = [];

  if (recentProgress.length > 0) {
    const recentLessonIds = recentProgress.map((p) => p.lessonId);
    const fetchedLessons = await db.select().from(lessonsTable).where(inArray(lessonsTable.id, recentLessonIds));
    const lessonMap = new Map(fetchedLessons.map((l) => [l.id, l]));

    for (const p of recentProgress) {
      const lesson = lessonMap.get(p.lessonId);
      if (lesson) {
        recentLessons.push({
          lessonId: p.lessonId,
          lessonTitle: lesson.title,
          lessonTitleAr: lesson.titleAr,
          completedAt: p.completedAt!.toISOString(),
          score: p.lastScore ?? 0,
          passed: p.passed,
        });
      }
    }
  }

  const levelProgressPercent =
    allLessonsInLevel.length > 0 ? (completedInLevel / allLessonsInLevel.length) * 100 : 0;

  res.json({
    student: {
      id: profile.id,
      userId: user.id,
      name: user.name,
      email: user.email,
      currentLevelCode: currentLevel?.code ?? null,
      currentLevelId: profile.currentLevelId ?? null,
      curriculumId: profile.curriculumId ?? null,
      streakDays: profile.streakDays,
      totalLessonsCompleted: passedIds.size,
      totalXp: profile.totalXp,
      placementCompleted: profile.placementCompleted,
      subscriptionPlan: subscription?.planCode ?? null,
      bio: profile.bio ?? null,
      preferredLanguage: user.preferredLanguage,
      country: user.country,
      createdAt: user.createdAt,
    },
    currentLevel: currentLevel
      ? {
          id: currentLevel.id,
          curriculumId: currentLevel.curriculumId,
          code: currentLevel.code,
          name: currentLevel.name,
          nameAr: currentLevel.nameAr,
          description: currentLevel.description ?? null,
          descriptionAr: currentLevel.descriptionAr ?? null,
          order: currentLevel.order,
          totalLessons: allLessonsInLevel.length,
          completedLessons: completedInLevel,
          isUnlocked: true,
          isCompleted: completedInLevel === allLessonsInLevel.length,
        }
      : null,
    nextLesson: nextLesson
      ? {
          id: nextLesson.id,
          levelId: nextLesson.levelId,
          levelCode: currentLevel?.code ?? "",
          title: nextLesson.title,
          titleAr: nextLesson.titleAr,
          description: nextLesson.description ?? null,
          descriptionAr: nextLesson.descriptionAr ?? null,
          order: nextLesson.order,
          lessonType: nextLesson.lessonType,
          estimatedMinutes: nextLesson.estimatedMinutes,
          isUnlocked: true,
          isCompleted: false,
          bestScore: null,
          xpReward: nextLesson.xpReward,
        }
      : null,
    totalLessonsCompleted: passedIds.size,
    totalLessonsInLevel: allLessonsInLevel.length,
    levelProgressPercent,
    weeklyProgress: {
      lessonsThisWeek: weeklyCompleted.length,
      xpThisWeek,
      streakDays: profile.streakDays,
    },
    recentActivity: recentLessons,
  });
});

export default router;

import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, lessonProgressTable, lessonsTable, levelsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/review/recent", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId!;

  const recentProgress = await db.select().from(lessonProgressTable)
    .where(and(eq(lessonProgressTable.userId, userId), eq(lessonProgressTable.passed, true)))
    .orderBy(desc(lessonProgressTable.completedAt))
    .limit(10);

  const result = await Promise.all(
    recentProgress.map(async (p) => {
      const [lesson] = await db.select().from(lessonsTable).where(eq(lessonsTable.id, p.lessonId)).limit(1);
      const [level] = lesson
        ? await db.select().from(levelsTable).where(eq(levelsTable.id, lesson.levelId)).limit(1)
        : [null];
      if (!lesson) return null;
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
        isUnlocked: true,
        isCompleted: true,
        bestScore: p.bestScore ?? null,
        xpReward: lesson.xpReward,
      };
    })
  );

  res.json(result.filter(Boolean));
});

router.get("/review/weak-areas", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId!;

  const progress = await db.select().from(lessonProgressTable)
    .where(and(eq(lessonProgressTable.userId, userId)))
    .orderBy(desc(lessonProgressTable.attempts));

  // Weak areas: attempted but best score < 75% or failed
  const weakProgress = progress.filter((p) => p.bestScore !== null && p.bestScore < 75);

  const result = await Promise.all(
    weakProgress.slice(0, 10).map(async (p) => {
      const [lesson] = await db.select().from(lessonsTable).where(eq(lessonsTable.id, p.lessonId)).limit(1);
      if (!lesson) return null;
      return {
        lessonId: p.lessonId,
        lessonTitle: lesson.title,
        lessonTitleAr: lesson.titleAr,
        bestScore: p.bestScore ?? 0,
        attempts: p.attempts,
        lessonType: lesson.lessonType,
      };
    })
  );

  res.json(result.filter(Boolean));
});

export default router;

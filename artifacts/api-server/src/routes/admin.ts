import { Router, type IRouter } from "express";
import { eq, and, count, avg } from "drizzle-orm";
import {
  db, usersTable, studentSubscriptionsTable, lessonProgressTable,
  lessonsTable, levelsTable,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/admin/stats", requireAdmin, async (req, res): Promise<void> => {
  const allUsers = await db.select().from(usersTable);
  const students = allUsers.filter((u) => u.role === "student");

  const activeSubscriptions = await db.select().from(studentSubscriptionsTable)
    .where(eq(studentSubscriptionsTable.status, "active"));

  const generalCount = activeSubscriptions.filter((s) => s.planCode === "general_english").length;
  const proCount = activeSubscriptions.filter((s) => s.planCode === "professional_english").length;

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const newStudents = students.filter((u) => u.createdAt >= weekAgo).length;

  const allProgress = await db.select().from(lessonProgressTable);
  const passedCount = allProgress.filter((p) => p.passed).length;
  const scores = allProgress.filter((p) => p.bestScore !== null).map((p) => p.bestScore!);
  const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

  res.json({
    totalStudents: students.length,
    activeSubscriptions: activeSubscriptions.length,
    lessonsCompleted: passedCount,
    avgScore: Math.round(avgScore * 10) / 10,
    generalPlanCount: generalCount,
    professionalPlanCount: proCount,
    newStudentsThisWeek: newStudents,
  });
});

router.get("/admin/students", requireAdmin, async (req, res): Promise<void> => {
  const page = parseInt(req.query.page as string ?? "1", 10);
  const limit = parseInt(req.query.limit as string ?? "20", 10);
  const offset = (page - 1) * limit;

  const all = await db.select().from(usersTable).where(eq(usersTable.role, "student"));
  const total = all.length;
  const paged = all.slice(offset, offset + limit);

  res.json({
    students: paged.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      preferredLanguage: u.preferredLanguage,
      country: u.country,
      createdAt: u.createdAt,
    })),
    total,
    page,
    limit,
  });
});

router.get("/admin/lessons", requireAdmin, async (req, res): Promise<void> => {
  const lessons = await db.select().from(lessonsTable);
  res.json(lessons.map((l) => ({
    id: l.id,
    levelId: l.levelId,
    title: l.title,
    titleAr: l.titleAr,
    description: l.description ?? null,
    descriptionAr: l.descriptionAr ?? null,
    order: l.order,
    lessonType: l.lessonType,
    estimatedMinutes: l.estimatedMinutes,
    isPublished: l.isPublished,
    xpReward: l.xpReward,
    passingScore: l.passingScore,
  })));
});

router.post("/admin/lessons", requireAdmin, async (req, res): Promise<void> => {
  const { levelId, title, titleAr, lessonType, estimatedMinutes, order, description, descriptionAr, isPublished, xpReward, passingScore } = req.body;

  if (!levelId || !title || !titleAr || !lessonType || !order) {
    res.status(400).json({ error: "levelId, title, titleAr, lessonType, and order are required" });
    return;
  }

  const [lesson] = await db.insert(lessonsTable).values({
    levelId,
    title,
    titleAr,
    description: description ?? null,
    descriptionAr: descriptionAr ?? null,
    order,
    lessonType,
    estimatedMinutes: estimatedMinutes ?? 35,
    isPublished: isPublished ?? false,
    xpReward: xpReward ?? 50,
    passingScore: passingScore ?? 75,
  }).returning();

  res.status(201).json({
    id: lesson.id,
    levelId: lesson.levelId,
    title: lesson.title,
    titleAr: lesson.titleAr,
    description: lesson.description ?? null,
    descriptionAr: lesson.descriptionAr ?? null,
    order: lesson.order,
    lessonType: lesson.lessonType,
    estimatedMinutes: lesson.estimatedMinutes,
    isPublished: lesson.isPublished,
    xpReward: lesson.xpReward,
    passingScore: lesson.passingScore,
  });
});

router.patch("/admin/lessons/:lessonId", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.lessonId) ? req.params.lessonId[0] : req.params.lessonId;
  const lessonId = parseInt(raw, 10);
  if (isNaN(lessonId)) { res.status(400).json({ error: "Invalid lesson ID" }); return; }

  const update: Record<string, unknown> = {};
  const fields = ["title", "titleAr", "description", "descriptionAr", "order", "lessonType", "estimatedMinutes", "isPublished", "xpReward", "passingScore"];
  for (const f of fields) {
    if (req.body[f] !== undefined) update[f] = req.body[f];
  }

  const [lesson] = await db.update(lessonsTable).set(update).where(eq(lessonsTable.id, lessonId)).returning();
  if (!lesson) { res.status(404).json({ error: "Lesson not found" }); return; }

  res.json({
    id: lesson.id,
    levelId: lesson.levelId,
    title: lesson.title,
    titleAr: lesson.titleAr,
    description: lesson.description ?? null,
    descriptionAr: lesson.descriptionAr ?? null,
    order: lesson.order,
    lessonType: lesson.lessonType,
    estimatedMinutes: lesson.estimatedMinutes,
    isPublished: lesson.isPublished,
    xpReward: lesson.xpReward,
    passingScore: lesson.passingScore,
  });
});

export default router;

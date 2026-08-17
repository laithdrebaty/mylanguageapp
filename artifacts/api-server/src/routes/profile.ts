import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, usersTable, studentProfilesTable, lessonProgressTable, studentSubscriptionsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/profile", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId!;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  const [profile] = await db.select().from(studentProfilesTable).where(eq(studentProfilesTable.userId, userId)).limit(1);
  const [subscription] = await db.select().from(studentSubscriptionsTable)
    .where(and(eq(studentSubscriptionsTable.userId, userId), eq(studentSubscriptionsTable.status, "active")))
    .limit(1);

  if (!user || !profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }

  const completedCount = await db.select().from(lessonProgressTable)
    .where(and(eq(lessonProgressTable.userId, userId), eq(lessonProgressTable.passed, true)));

  res.json({
    id: profile.id,
    userId: user.id,
    name: user.name,
    email: user.email,
    currentLevelCode: profile.currentLevelCode,
    streakDays: profile.streakDays,
    totalLessonsCompleted: completedCount.length,
    totalXp: profile.totalXp,
    placementCompleted: profile.placementCompleted,
    subscriptionPlan: subscription?.planCode ?? null,
    bio: profile.bio ?? null,
    preferredLanguage: user.preferredLanguage,
    country: user.country,
    createdAt: user.createdAt,
  });
});

router.patch("/profile", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const { name, bio, preferredLanguage, country } = req.body;

  const userUpdate: Record<string, unknown> = {};
  if (name) userUpdate.name = name;
  if (preferredLanguage) userUpdate.preferredLanguage = preferredLanguage;
  if (country) userUpdate.country = country;

  if (Object.keys(userUpdate).length > 0) {
    await db.update(usersTable).set(userUpdate).where(eq(usersTable.id, userId));
  }

  if (bio !== undefined) {
    await db.update(studentProfilesTable).set({ bio }).where(eq(studentProfilesTable.userId, userId));
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  const [profile] = await db.select().from(studentProfilesTable).where(eq(studentProfilesTable.userId, userId)).limit(1);
  const completedCount = await db.select().from(lessonProgressTable)
    .where(and(eq(lessonProgressTable.userId, userId), eq(lessonProgressTable.passed, true)));

  res.json({
    id: profile.id,
    userId: user.id,
    name: user.name,
    email: user.email,
    currentLevelCode: profile.currentLevelCode,
    streakDays: profile.streakDays,
    totalLessonsCompleted: completedCount.length,
    totalXp: profile.totalXp,
    placementCompleted: profile.placementCompleted,
    subscriptionPlan: null,
    bio: profile.bio ?? null,
    preferredLanguage: user.preferredLanguage,
    country: user.country,
    createdAt: user.createdAt,
  });
});

export default router;

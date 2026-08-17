import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, usersTable, studentProfilesTable, curriculaTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

/** Look up the default curriculum (first active one by id) */
async function getDefaultCurriculumId(): Promise<number | null> {
  const [curriculum] = await db
    .select({ id: curriculaTable.id })
    .from(curriculaTable)
    .where(eq(curriculaTable.isActive, true))
    .orderBy(curriculaTable.id)
    .limit(1);
  return curriculum?.id ?? null;
}

router.post("/auth/register", async (req, res): Promise<void> => {
  const { name, email, password, preferredLanguage = "ar", country = "SY" } = req.body;

  if (!name || !email || !password) {
    res.status(400).json({ error: "Name, email and password are required" });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters" });
    return;
  }

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase())).limit(1);
  if (existing) {
    res.status(409).json({ error: "Email already registered" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const [user] = await db.insert(usersTable).values({
    name,
    email: email.toLowerCase(),
    passwordHash,
    preferredLanguage: preferredLanguage ?? "ar",
    country: country ?? "SY",
    role: "student",
  }).returning();

  // Enroll student in the default curriculum (null if none exists yet)
  const curriculumId = await getDefaultCurriculumId();

  await db.insert(studentProfilesTable).values({
    userId: user.id,
    curriculumId: curriculumId ?? undefined,
    currentLevelId: undefined, // assigned after placement test
    streakDays: 0,
    totalXp: 0,
    placementCompleted: false,
  });

  req.session.userId = user.id;
  req.session.role = user.role;
  req.session.name = user.name;
  req.session.email = user.email;

  res.status(201).json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      preferredLanguage: user.preferredLanguage,
      country: user.country,
      createdAt: user.createdAt,
    },
  });
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase())).limit(1);
  if (!user) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  req.session.userId = user.id;
  req.session.role = user.role;
  req.session.name = user.name;
  req.session.email = user.email;

  res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      preferredLanguage: user.preferredLanguage,
      country: user.country,
      createdAt: user.createdAt,
    },
  });
});

router.post("/auth/logout", (req, res): void => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId!)).limit(1);
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }
  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    preferredLanguage: user.preferredLanguage,
    country: user.country,
    createdAt: user.createdAt,
  });
});

export default router;

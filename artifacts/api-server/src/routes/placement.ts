import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import {
  db,
  placementQuestionsTable,
  placementOptionsTable,
  placementResultsTable,
  studentProfilesTable,
  levelsTable,
  curriculaTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

/**
 * Assign a level based on score percentage using the curriculum's own level order.
 * Works for any level system (CEFR, JLPT, HSK, custom) — no level codes are
 * hard-coded. The mapping is: 0% → first level, 100% → highest level,
 * with a soft cap so new students aren't placed too far ahead on short tests.
 */
async function assignLevelFromCurriculum(
  curriculumId: number,
  percentage: number,
): Promise<{ id: number; code: string; name: string; nameAr: string } | null> {
  const levels = await db
    .select()
    .from(levelsTable)
    .where(eq(levelsTable.curriculumId, curriculumId))
    .orderBy(asc(levelsTable.order));

  if (levels.length === 0) return null;

  // Soft cap: a 10-question placement test shouldn't place students at the very
  // top — cap effective percentage at 60% so students earn their way up.
  const effectivePercent = Math.min(percentage, 60);
  const rawIndex = Math.floor((effectivePercent / 100) * levels.length);
  const index = Math.max(0, Math.min(rawIndex, levels.length - 1));
  const level = levels[index];
  return { id: level.id, code: level.code, name: level.name, nameAr: level.nameAr };
}

router.get("/placement-test", async (req, res): Promise<void> => {
  const questions = await db
    .select()
    .from(placementQuestionsTable)
    .orderBy(asc(placementQuestionsTable.order));
  const allOptions = await db.select().from(placementOptionsTable);

  const questionsWithOptions = questions.map((q) => ({
    id: q.id,
    questionText: q.questionText,
    questionTextAr: q.questionTextAr,
    type: q.type,
    order: q.order,
    options: allOptions
      .filter((o) => o.questionId === q.id)
      .map((o) => ({ id: o.optionId, text: o.text, textAr: o.textAr ?? null })),
  }));

  res.json({ questions: questionsWithOptions });
});

router.post("/placement-test/submit", requireAuth, async (req, res): Promise<void> => {
  const { answers } = req.body;
  if (!Array.isArray(answers) || answers.length === 0) {
    res.status(400).json({ error: "Answers array is required" });
    return;
  }

  const questions = await db.select().from(placementQuestionsTable);
  const allOptions = await db.select().from(placementOptionsTable);

  let correct = 0;
  for (const answer of answers) {
    const option = allOptions.find(
      (o) =>
        o.questionId === answer.questionId &&
        o.optionId === answer.selectedOptionId &&
        o.isCorrect,
    );
    if (option) correct++;
  }

  const total = questions.length || answers.length;
  const percentage = total > 0 ? (correct / total) * 100 : 0;

  // Resolve the student's curriculum
  const [profile] = await db
    .select()
    .from(studentProfilesTable)
    .where(eq(studentProfilesTable.userId, req.session.userId!))
    .limit(1);

  // Fall back to the default curriculum if the student profile has none
  let curriculumId = profile?.curriculumId ?? null;
  if (!curriculumId) {
    const [defaultCurriculum] = await db
      .select({ id: curriculaTable.id })
      .from(curriculaTable)
      .where(eq(curriculaTable.isActive, true))
      .orderBy(curriculaTable.id)
      .limit(1);
    curriculumId = defaultCurriculum?.id ?? null;
  }

  if (!curriculumId) {
    res.status(500).json({ error: "No curriculum configured — cannot assign a level" });
    return;
  }

  const level = await assignLevelFromCurriculum(curriculumId, percentage);
  if (!level) {
    res.status(500).json({ error: "No levels found in curriculum — cannot assign a level" });
    return;
  }

  // Save result
  await db.insert(placementResultsTable).values({
    userId: req.session.userId!,
    curriculumId,
    score: correct,
    total,
    percentage,
    assignedLevelCode: level.code,
    assignedLevelId: level.id,
  });

  // Update student profile with their assigned level and curriculum
  await db
    .update(studentProfilesTable)
    .set({
      currentLevelId: level.id,
      curriculumId,
      placementCompleted: true,
    })
    .where(eq(studentProfilesTable.userId, req.session.userId!));

  res.json({
    score: correct,
    total,
    percentage,
    assignedLevelCode: level.code,
    assignedLevelName: level.name,
    assignedLevelNameAr: level.nameAr,
    message: `You have been placed at ${level.name}`,
    messageAr: `تم تصنيفك في مستوى ${level.nameAr}`,
  });
});

export default router;

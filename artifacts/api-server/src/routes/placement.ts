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
  const userId = req.session.userId!;

  // Reject retaking placement once completed (409)
  const [profile] = await db
    .select()
    .from(studentProfilesTable)
    .where(eq(studentProfilesTable.userId, userId))
    .limit(1);

  if (profile?.placementCompleted) {
    res.status(409).json({ error: "Placement test already completed" });
    return;
  }

  const { answers } = req.body;
  if (!Array.isArray(answers) || answers.length === 0) {
    res.status(400).json({ error: "Answers array is required" });
    return;
  }

  const questions = await db
    .select()
    .from(placementQuestionsTable)
    .orderBy(asc(placementQuestionsTable.order));
  const allOptions = await db.select().from(placementOptionsTable);

  // Validate: no duplicate question IDs in submitted answers
  const submittedQuestionIds = answers.map((a: { questionId: unknown }) => a.questionId);
  const uniqueSubmittedIds = new Set(submittedQuestionIds);
  if (uniqueSubmittedIds.size !== submittedQuestionIds.length) {
    res.status(400).json({ error: "Duplicate question IDs in answers" });
    return;
  }

  // Validate: all submitted question IDs must exist in the actual test
  const validQuestionIds = new Set(questions.map((q) => q.id));
  for (const qid of submittedQuestionIds) {
    if (!validQuestionIds.has(qid as number)) {
      res.status(400).json({ error: `Unknown question ID: ${qid}` });
      return;
    }
  }

  // Validate: no duplicate option selections for the same question
  const optionsByQuestion = new Map<number, string>();
  for (const answer of answers) {
    const { questionId, selectedOptionId } = answer as { questionId: number; selectedOptionId: string };
    if (!questionId || !selectedOptionId) {
      res.status(400).json({ error: "Each answer must have questionId and selectedOptionId" });
      return;
    }
    // Validate option belongs to the question (reject foreign options)
    const validOptions = allOptions.filter(
      (o) => o.questionId === questionId && o.optionId === selectedOptionId,
    );
    if (validOptions.length === 0) {
      res.status(400).json({ error: `Invalid option '${selectedOptionId}' for question ${questionId}` });
      return;
    }
    optionsByQuestion.set(questionId, selectedOptionId);
  }

  // Score: count answered questions correctly; unanswered questions count as incorrect
  let correct = 0;
  for (const question of questions) {
    const selectedOptionId = optionsByQuestion.get(question.id);
    if (!selectedOptionId) {
      // Unanswered — counts as incorrect
      continue;
    }
    const isCorrect = allOptions.some(
      (o) => o.questionId === question.id && o.optionId === selectedOptionId && o.isCorrect,
    );
    if (isCorrect) correct++;
  }

  const total = questions.length;
  const percentage = total > 0 ? (correct / total) * 100 : 0;

  // Resolve the student's curriculum
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

  // Save result and update profile transactionally
  await db.transaction(async (tx) => {
    await tx.insert(placementResultsTable).values({
      userId,
      curriculumId,
      score: correct,
      total,
      percentage,
      assignedLevelCode: level.code,
      assignedLevelId: level.id,
    });

    if (profile) {
      await tx
        .update(studentProfilesTable)
        .set({
          currentLevelId: level.id,
          curriculumId,
          placementCompleted: true,
        })
        .where(eq(studentProfilesTable.userId, userId));
    } else {
      await tx.insert(studentProfilesTable).values({
        userId,
        currentLevelId: level.id,
        curriculumId,
        placementCompleted: true,
      });
    }
  });

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

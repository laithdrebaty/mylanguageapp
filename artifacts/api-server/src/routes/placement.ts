import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { db, placementQuestionsTable, placementOptionsTable, placementResultsTable, studentProfilesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";

// Map score percentage to level code
function assignLevel(percentage: number): { code: string; name: string; nameAr: string } {
  if (percentage < 20) return { code: "A1.1", name: "Beginner – A1.1", nameAr: "مبتدئ – أ1.1" };
  if (percentage < 35) return { code: "A1.2", name: "Elementary – A1.2", nameAr: "أساسي – أ1.2" };
  if (percentage < 50) return { code: "A2.1", name: "Pre-Intermediate – A2.1", nameAr: "ما قبل المتوسط – أ2.1" };
  if (percentage < 65) return { code: "A2.2", name: "Pre-Intermediate – A2.2", nameAr: "ما قبل المتوسط – أ2.2" };
  if (percentage < 75) return { code: "B1.1", name: "Intermediate – B1.1", nameAr: "متوسط – ب1.1" };
  return { code: "B1.2", name: "Intermediate – B1.2", nameAr: "متوسط – ب1.2" };
}

const router: IRouter = Router();

router.get("/placement-test", async (req, res): Promise<void> => {
  const questions = await db.select().from(placementQuestionsTable).orderBy(asc(placementQuestionsTable.order));
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
      (o) => o.questionId === answer.questionId && o.optionId === answer.selectedOptionId && o.isCorrect
    );
    if (option) correct++;
  }

  const total = questions.length || answers.length;
  const percentage = total > 0 ? (correct / total) * 100 : 0;
  const level = assignLevel(percentage);

  // Save result
  await db.insert(placementResultsTable).values({
    userId: req.session.userId!,
    score: correct,
    total,
    percentage,
    assignedLevelCode: level.code,
  });

  // Update student profile
  await db.update(studentProfilesTable)
    .set({ currentLevelCode: level.code, placementCompleted: true })
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

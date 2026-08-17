import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, exercisesTable, exerciseOptionsTable, exerciseAttemptsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.post("/exercises/:exerciseId/submit", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.exerciseId) ? req.params.exerciseId[0] : req.params.exerciseId;
  const exerciseId = parseInt(raw, 10);
  if (isNaN(exerciseId)) { res.status(400).json({ error: "Invalid exercise ID" }); return; }

  const { selectedOptionId } = req.body;
  if (!selectedOptionId) { res.status(400).json({ error: "selectedOptionId is required" }); return; }

  const [exercise] = await db.select().from(exercisesTable).where(eq(exercisesTable.id, exerciseId)).limit(1);
  if (!exercise) { res.status(404).json({ error: "Exercise not found" }); return; }

  const correct = exercise.correctOptionId === selectedOptionId;

  // Record attempt
  await db.insert(exerciseAttemptsTable).values({
    userId: req.session.userId!,
    exerciseId,
    selectedOptionId,
    correct,
  });

  res.json({
    correct,
    correctOptionId: exercise.correctOptionId,
    explanation: exercise.explanation ?? null,
    explanationAr: exercise.explanationAr ?? null,
  });
});

export default router;

/**
 * Level evaluation discovery and promotion history.
 *
 * Sitting the evaluation itself reuses the quiz endpoints — an evaluation *is*
 * a quiz, and duplicating the attempt/response/grading machinery for it would
 * mean two things to keep correct instead of one. What lives here is everything
 * around that: which quiz gates this level, whether the student may sit it yet,
 * and how they arrived at the level they are on.
 */

import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import {
  getLevelEvaluation,
  getEvaluationEligibility,
  getLevelRemediation,
  getProgressionHistory,
} from "../services/progression";

const router: IRouter = Router();

/**
 * The evaluation gate on a level, and whether this student may sit it.
 *
 * Always 200 when the level exists — a closed gate is a normal state to render,
 * not an error. `evaluation: null` means the curriculum team has not published
 * one for this level yet.
 */
router.get("/levels/:levelId/evaluation", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.levelId) ? req.params.levelId[0] : req.params.levelId;
  const levelId = parseInt(raw as string, 10);

  if (isNaN(levelId)) {
    res.status(400).json({ error: "Invalid level ID" });
    return;
  }

  const userId = req.session.userId!;
  const [quiz, eligibility] = await Promise.all([
    getLevelEvaluation(levelId),
    getEvaluationEligibility(userId, levelId),
  ]);

  if (!quiz) {
    res.json({ evaluation: null, eligibility, remediation: [] });
    return;
  }

  // Show the way back into the curriculum whenever the gate is shut for a
  // reason the student can actually do something about (spec section 10:
  // direct them to existing lessons before another attempt).
  const needsRemediation =
    eligibility.code === "LESSONS_INCOMPLETE" || eligibility.code === "COOLDOWN";

  res.json({
    evaluation: {
      quizId: quiz.id,
      title: quiz.title,
      titleAr: quiz.titleAr,
      description: quiz.description,
      descriptionAr: quiz.descriptionAr,
      levelId: quiz.levelId,
      timeLimitSec: quiz.timeLimitSec,
      maxAttempts: quiz.maxAttempts,
      passingScore: quiz.passingScore,
      cooldownHours: quiz.cooldownHours,
    },
    eligibility,
    remediation: needsRemediation ? await getLevelRemediation(userId, levelId) : [],
  });
});

/** How this student got to the level they are on. */
router.get("/progression", requireAuth, async (req, res): Promise<void> => {
  res.json({ history: await getProgressionHistory(req.session.userId!) });
});

export default router;

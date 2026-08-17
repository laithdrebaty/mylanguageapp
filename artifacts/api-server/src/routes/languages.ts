import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, languagesTable, curriculaTable } from "@workspace/db";

const router: IRouter = Router();

/**
 * GET /languages
 * Returns all active languages.
 * A language record is the prerequisite for creating a curriculum.
 * New target or learner languages can be added by inserting into the languages
 * table without any code change.
 */
router.get("/languages", async (_req, res): Promise<void> => {
  const languages = await db
    .select()
    .from(languagesTable)
    .where(eq(languagesTable.isActive, true))
    .orderBy(languagesTable.name);

  res.json(
    languages.map((l) => ({
      id: l.id,
      code: l.code,
      name: l.name,
      nameNative: l.nameNative,
      rtl: l.rtl,
    })),
  );
});

/**
 * GET /curricula
 * Returns all active curricula with their language metadata.
 * Each curriculum owns its own level hierarchy — a new curriculum can use
 * CEFR, JLPT, HSK, or any completely custom level set simply by inserting
 * levels with the desired curriculum_id.
 */
router.get("/curricula", async (_req, res): Promise<void> => {
  const curricula = await db
    .select()
    .from(curriculaTable)
    .where(eq(curriculaTable.isActive, true))
    .orderBy(curriculaTable.id);

  res.json(
    curricula.map((c) => ({
      id: c.id,
      targetLanguageCode: c.targetLanguageCode,
      learnerLanguageCode: c.learnerLanguageCode,
      name: c.name,
      nameInLearnerLanguage: c.nameInLearnerLanguage,
      levelFramework: c.levelFramework,
      description: c.description ?? null,
      descriptionInLearnerLanguage: c.descriptionInLearnerLanguage ?? null,
    })),
  );
});

export default router;

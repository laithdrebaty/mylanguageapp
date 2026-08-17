import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, languagesTable, curriculaTable } from "@workspace/db";
import { cached, CK, TTL } from "../services/cache";

const router: IRouter = Router();

/**
 * GET /languages
 * Cache: 1 h (languages change only when an admin inserts a new language row)
 */
router.get("/languages", async (_req, res): Promise<void> => {
  const languages = await cached(CK.langList(), TTL.LANG_CURRICULA, async () => {
    const rows = await db
      .select()
      .from(languagesTable)
      .where(eq(languagesTable.isActive, true))
      .orderBy(languagesTable.name);
    return rows.map((l) => ({
      id: l.id,
      code: l.code,
      name: l.name,
      nameNative: l.nameNative,
      rtl: l.rtl,
    }));
  });

  res.json(languages);
});

/**
 * GET /curricula
 * Cache: 1 h (curricula are defined at platform setup; new ones are rare admin ops)
 */
router.get("/curricula", async (_req, res): Promise<void> => {
  const curricula = await cached(CK.curriculaList(), TTL.LANG_CURRICULA, async () => {
    const rows = await db
      .select()
      .from(curriculaTable)
      .where(eq(curriculaTable.isActive, true))
      .orderBy(curriculaTable.id);
    return rows.map((c) => ({
      id: c.id,
      targetLanguageCode: c.targetLanguageCode,
      learnerLanguageCode: c.learnerLanguageCode,
      name: c.name,
      nameInLearnerLanguage: c.nameInLearnerLanguage,
      levelFramework: c.levelFramework,
      description: c.description ?? null,
      descriptionInLearnerLanguage: c.descriptionInLearnerLanguage ?? null,
    }));
  });

  res.json(curricula);
});

export default router;

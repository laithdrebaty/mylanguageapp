import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, vocabularyTable } from "@workspace/db";
import { cached, CK, TTL } from "../services/cache";

const router: IRouter = Router();

/**
 * GET /vocabulary?lessonId=&levelId=
 * Cache: 15 min per lesson/level. Vocabulary is stable between admin updates.
 */
router.get("/vocabulary", async (req, res): Promise<void> => {
  const lessonId = req.query.lessonId ? parseInt(req.query.lessonId as string, 10) : undefined;
  const levelId  = req.query.levelId  ? parseInt(req.query.levelId  as string, 10) : undefined;

  const mapItem = (v: typeof vocabularyTable.$inferSelect) => ({
    id: v.id,
    levelId: v.levelId,
    lessonId: v.lessonId ?? null,
    word: v.word,
    translation: v.translation,
    exampleSentence: v.exampleSentence ?? null,
    exampleSentenceAr: v.exampleSentenceAr ?? null,
    pronunciation: v.pronunciation ?? null,
    audioNote: v.audioNote ?? null,
  });

  if (lessonId && !isNaN(lessonId)) {
    const items = await cached(CK.vocabByLesson(lessonId), TTL.VOCABULARY, () =>
      db.select().from(vocabularyTable).where(eq(vocabularyTable.lessonId, lessonId)).then(r => r.map(mapItem)),
    );
    res.json(items);
    return;
  }

  if (levelId && !isNaN(levelId)) {
    const items = await cached(CK.vocabByLevel(levelId), TTL.VOCABULARY, () =>
      db.select().from(vocabularyTable).where(eq(vocabularyTable.levelId, levelId)).then(r => r.map(mapItem)),
    );
    res.json(items);
    return;
  }

  // No filter — unbounded; not cached (rarely used, admin-only context)
  const items = await db.select().from(vocabularyTable);
  res.json(items.map(mapItem));
});

export default router;

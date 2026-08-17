import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, vocabularyTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/vocabulary", async (req, res): Promise<void> => {
  const lessonId = req.query.lessonId ? parseInt(req.query.lessonId as string, 10) : undefined;
  const levelId = req.query.levelId ? parseInt(req.query.levelId as string, 10) : undefined;

  let query = db.select().from(vocabularyTable);

  let items;
  if (lessonId && !isNaN(lessonId)) {
    items = await db.select().from(vocabularyTable).where(eq(vocabularyTable.lessonId, lessonId));
  } else if (levelId && !isNaN(levelId)) {
    items = await db.select().from(vocabularyTable).where(eq(vocabularyTable.levelId, levelId));
  } else {
    items = await db.select().from(vocabularyTable);
  }

  res.json(items.map((v) => ({
    id: v.id,
    levelId: v.levelId,
    lessonId: v.lessonId ?? null,
    word: v.word,
    translation: v.translation,
    exampleSentence: v.exampleSentence ?? null,
    exampleSentenceAr: v.exampleSentenceAr ?? null,
    pronunciation: v.pronunciation ?? null,
    audioNote: v.audioNote ?? null,
  })));
});

export default router;

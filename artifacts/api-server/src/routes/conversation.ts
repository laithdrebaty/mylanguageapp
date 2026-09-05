/**
 * The AI conversation tutor, from the student's side.
 *
 * Every cap is enforced in the service, not here — this file is transport. The
 * one thing it does add is turning each refusal into a status code that means
 * what it says: a spent allowance is not a server error, and a student who has
 * finished their ten minutes should be told that, not shown a failure.
 */

import { Router, type IRouter } from "express";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { db, studentSubscriptionsTable } from "@workspace/db";
import { requireStudent } from "../middlewares/auth";
import {
  startConversation,
  takeTurn,
  endConversation,
  getActiveSession,
  transcribeSpokenTurn,
  ConversationBlockedError,
  ConversationUnavailableError,
} from "../services/conversation";
import { assertUsableRecording, MediaValidationError } from "../services/media";

const router: IRouter = Router();

async function planFor(userId: number): Promise<string> {
  const [sub] = await db
    .select({ planCode: studentSubscriptionsTable.planCode })
    .from(studentSubscriptionsTable)
    .where(
      and(
        eq(studentSubscriptionsTable.userId, userId),
        eq(studentSubscriptionsTable.status, "active"),
      ),
    )
    .orderBy(desc(studentSubscriptionsTable.startedAt))
    .limit(1);
  return sub?.planCode ?? "free";
}

function handleError(err: unknown, res: import("express").Response): void {
  if (err instanceof ConversationBlockedError) {
    // 409, not 400: the request was well formed, the conversation's state
    // simply does not allow it.
    res.status(409).json({ error: err.message, code: err.reason });
    return;
  }
  if (err instanceof ConversationUnavailableError) {
    // A spent quota is the student's allowance, not a fault — 429. Anything
    // else here is the deployment's problem, not the request's.
    const status = err.reason.startsWith("AI_QUOTA") ? 429 : 503;
    res.status(status).json({ error: err.message, code: err.reason });
    return;
  }
  if (err instanceof MediaValidationError) {
    res.status(400).json({ error: err.message, code: err.code });
    return;
  }
  throw err;
}

/** Resume whatever is open, so a reload does not lose the thread. */
router.get("/conversation/active", requireStudent, async (req, res): Promise<void> => {
  res.json({ session: await getActiveSession(req.session.userId!) });
});

const startSchema = z.object({
  lessonId: z.number().int().positive(),
  blockId: z.number().int().positive().nullable().optional(),
});

router.post("/conversation/start", requireStudent, async (req, res): Promise<void> => {
  const parsed = startSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.errors });
    return;
  }

  try {
    const userId = req.session.userId!;
    res.status(201).json(
      await startConversation(userId, parsed.data.lessonId, parsed.data.blockId ?? null, {
        subscriptionPlan: await planFor(userId),
      }),
    );
  } catch (err) {
    handleError(err, res);
  }
});

const turnSchema = z.object({
  /** What the student typed. Omitted when they spoke instead. */
  message: z.string().min(1).max(2000).optional(),
  /** A verified recording, when they spoke their turn. */
  mediaId: z.number().int().positive().optional(),
});

router.post("/conversation/:id/turn", requireStudent, async (req, res): Promise<void> => {
  const sessionId = parseInt(req.params.id as string, 10);
  if (isNaN(sessionId)) {
    res.status(400).json({ error: "Invalid session ID" });
    return;
  }

  const parsed = turnSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.errors });
    return;
  }

  const { message, mediaId } = parsed.data;
  if (!message && mediaId === undefined) {
    res.status(400).json({ error: "Send either a message or a recording" });
    return;
  }

  try {
    const userId = req.session.userId!;
    const plan = await planFor(userId);

    let said = message ?? "";
    let transcript: string | null = null;

    if (mediaId !== undefined) {
      // Same rule as everywhere else: a recording is only accepted once the
      // server has confirmed it exists and belongs to this student.
      const asset = await assertUsableRecording(mediaId, userId, "lesson_activity");
      // The client cannot transcribe, so the server does. Without this the
      // tutor would be replying to a placeholder rather than to what was said.
      transcript = await transcribeSpokenTurn(asset.key, asset.mimeType, {
        userId,
        subscriptionPlan: plan,
      });
      said = transcript;
    }

    res.json(
      await takeTurn(userId, sessionId, said, {
        subscriptionPlan: plan,
        mediaAssetId: mediaId ?? null,
        transcript,
      }),
    );
  } catch (err) {
    handleError(err, res);
  }
});

router.post("/conversation/:id/end", requireStudent, async (req, res): Promise<void> => {
  const sessionId = parseInt(req.params.id as string, 10);
  if (isNaN(sessionId)) {
    res.status(400).json({ error: "Invalid session ID" });
    return;
  }
  await endConversation(req.session.userId!, sessionId, "completed");
  res.json({ ended: true });
});

export default router;

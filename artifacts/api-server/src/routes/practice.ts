/**
 * Voice practice, from the student's side.
 *
 * Transport only — every rule lives in services/practice.ts. What this file
 * adds is the status code each refusal deserves: being already in a call is a
 * state conflict (409), a spent daily allowance is the student's allowance and
 * not a fault (429), and "nobody is available" is not a refusal at all. It is
 * a 200 with an empty result, because it is a normal thing for a small pool to
 * be empty and an error page is the wrong way to say so.
 */

import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import {
  getPreferences,
  savePreferences,
  joinQueue,
  leaveQueue,
  pollStatus,
  acceptSession,
  endSession,
  sendSignal,
  readSignals,
  iceServers,
  blockUser,
  unblockUser,
  listBlocks,
  reportUser,
  recentCalls,
  PracticeBlockedError,
  PRACTICE_LIMITS,
} from "../services/practice";
import { audit } from "../services/cms-audit";

const router: IRouter = Router();

function handleError(err: unknown, res: import("express").Response): void {
  if (err instanceof PracticeBlockedError) {
    const status = err.reason === "DAILY_LIMIT" ? 429 : err.reason === "NOT_YOURS" ? 403 : 409;
    res.status(status).json({ error: err.message, code: err.reason });
    return;
  }
  throw err;
}

const badRequest = (res: import("express").Response, details: unknown): void => {
  res.status(400).json({ error: "Validation failed", details });
};

// ─── Preferences ──────────────────────────────────────────────────────────────

router.get("/practice/profile", requireAuth, async (req, res): Promise<void> => {
  res.json({
    profile: await getPreferences(req.session.userId!),
    limits: PRACTICE_LIMITS,
  });
});

const preferencesSchema = z.object({
  isAvailable: z.boolean(),
  goals: z.array(z.string().max(40)).max(10).default([]),
  interests: z.array(z.string().max(40)).max(10).default([]),
  professionalField: z.string().max(40).nullable().optional(),
  availableHours: z.array(z.number().int().min(0).max(23)).max(24).default([]),
});

router.put("/practice/profile", requireAuth, async (req, res): Promise<void> => {
  const parsed = preferencesSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error.errors);

  res.json({
    profile: await savePreferences(req.session.userId!, {
      ...parsed.data,
      professionalField: parsed.data.professionalField ?? null,
    }),
  });
});

// ─── Finding a partner ────────────────────────────────────────────────────────

router.post("/practice/queue", requireAuth, async (req, res): Promise<void> => {
  try {
    res.status(201).json(await joinQueue(req.session.userId!));
  } catch (err) {
    handleError(err, res);
  }
});

router.delete("/practice/queue", requireAuth, async (req, res): Promise<void> => {
  await leaveQueue(req.session.userId!);
  res.json({ ok: true });
});

/**
 * The one endpoint the client polls, while queued and while in a call.
 *
 * It refreshes presence and closes anything overdue, which is why it is a POST
 * despite reading like a GET — it changes state on purpose.
 */
router.post("/practice/poll", requireAuth, async (req, res): Promise<void> => {
  try {
    res.json(await pollStatus(req.session.userId!));
  } catch (err) {
    handleError(err, res);
  }
});

// ─── One call ─────────────────────────────────────────────────────────────────

function sessionIdOf(req: import("express").Request): number | null {
  const id = parseInt(req.params.id as string, 10);
  return Number.isNaN(id) ? null : id;
}

router.post("/practice/sessions/:id/accept", requireAuth, async (req, res): Promise<void> => {
  const id = sessionIdOf(req);
  if (id === null) return badRequest(res, "Invalid session id");

  try {
    res.json({ session: await acceptSession(id, req.session.userId!) });
  } catch (err) {
    handleError(err, res);
  }
});

const endSchema = z.object({
  reason: z.enum(["ended_by_user", "declined", "connection_failed"]).optional(),
});

router.post("/practice/sessions/:id/end", requireAuth, async (req, res): Promise<void> => {
  const id = sessionIdOf(req);
  if (id === null) return badRequest(res, "Invalid session id");

  const parsed = endSchema.safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed.error.errors);

  try {
    res.json({
      session: await endSession(id, req.session.userId!, parsed.data.reason ?? "ended_by_user"),
    });
  } catch (err) {
    handleError(err, res);
  }
});

// ─── WebRTC signalling ────────────────────────────────────────────────────────

/**
 * What to hand RTCPeerConnection.
 *
 * Served rather than bundled so a TURN relay can be switched on with
 * environment variables, and so its credentials never sit in public JavaScript.
 */
router.get("/practice/ice-servers", requireAuth, (_req, res): void => {
  res.json(iceServers());
});

const signalSchema = z.object({
  kind: z.enum(["offer", "answer", "ice", "bye"]),
  // SDP and ICE candidates are opaque to the server; it only carries them.
  payload: z.unknown(),
});

router.post("/practice/sessions/:id/signal", requireAuth, async (req, res): Promise<void> => {
  const id = sessionIdOf(req);
  if (id === null) return badRequest(res, "Invalid session id");

  const parsed = signalSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error.errors);

  try {
    await sendSignal(id, req.session.userId!, parsed.data.kind, parsed.data.payload ?? null);
    res.status(201).json({ ok: true });
  } catch (err) {
    handleError(err, res);
  }
});

router.get("/practice/sessions/:id/signals", requireAuth, async (req, res): Promise<void> => {
  const id = sessionIdOf(req);
  if (id === null) return badRequest(res, "Invalid session id");

  const after = parseInt((req.query.after as string) ?? "0", 10);

  try {
    res.json({
      signals: await readSignals(id, req.session.userId!, Number.isNaN(after) ? 0 : after),
    });
  } catch (err) {
    handleError(err, res);
  }
});

// ─── Safety ───────────────────────────────────────────────────────────────────

const blockSchema = z.object({
  userId: z.number().int().positive(),
  sessionId: z.number().int().positive().nullable().optional(),
});

router.post("/practice/block", requireAuth, async (req, res): Promise<void> => {
  const parsed = blockSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error.errors);

  const userId = req.session.userId!;
  try {
    // The audit row is written in the service, because a block also happens as
    // a side effect of reporting someone.
    await blockUser(userId, parsed.data.userId, parsed.data.sessionId ?? null);
    res.status(201).json({ ok: true });
  } catch (err) {
    handleError(err, res);
  }
});

router.delete("/practice/block/:userId", requireAuth, async (req, res): Promise<void> => {
  const blockedId = parseInt(req.params.userId as string, 10);
  if (Number.isNaN(blockedId)) return badRequest(res, "Invalid user id");

  const userId = req.session.userId!;
  await unblockUser(userId, blockedId);
  res.json({ ok: true });
});

router.get("/practice/blocks", requireAuth, async (req, res): Promise<void> => {
  res.json({ blocks: await listBlocks(req.session.userId!) });
});

const reportSchema = z.object({
  userId: z.number().int().positive(),
  sessionId: z.number().int().positive().nullable().optional(),
  reason: z.enum(["harassment", "inappropriate", "spam", "language", "other"]),
  detail: z.string().max(2000).nullable().optional(),
  /** Reporting someone almost always means not wanting to meet them again. */
  alsoBlock: z.boolean().default(true),
});

router.post("/practice/report", requireAuth, async (req, res): Promise<void> => {
  const parsed = reportSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error.errors);

  const reporterId = req.session.userId!;
  try {
    const { reportId } = await reportUser({
      reporterId,
      reportedId: parsed.data.userId,
      sessionId: parsed.data.sessionId ?? null,
      reason: parsed.data.reason,
      detail: parsed.data.detail ?? null,
      alsoBlock: parsed.data.alsoBlock,
    });

    await audit(reporterId, "practice_report", "practice_report", reportId, null, "open", {
      reportedId: parsed.data.userId,
      reason: parsed.data.reason,
    });

    res.status(201).json({ reportId });
  } catch (err) {
    handleError(err, res);
  }
});

// ─── History ──────────────────────────────────────────────────────────────────

router.get("/practice/history", requireAuth, async (req, res): Promise<void> => {
  res.json({ calls: await recentCalls(req.session.userId!) });
});

export default router;

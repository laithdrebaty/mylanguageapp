/**
 * AI Quota Enforcement Service
 *
 * Two-layer architecture:
 *   Fast layer  → Redis atomic counters (INCR + EXPIRE) for real-time enforcement
 *   Durable layer → PostgreSQL ai_usage_logs table for billing, auditing, abuse detection
 *
 * FAILURE BEHAVIOR
 * ─────────────────
 * Redis unavailable → FAIL CLOSED (deny the AI request)
 * This is intentional: at $2–$4/month subscriptions, allowing unlimited AI
 * requests because Redis is down would be extremely costly. Students see a
 * "service temporarily unavailable" message rather than unlimited access.
 *
 * PER-SUBSCRIPTION LIMITS (configurable via env vars)
 * ─────────────────────────────────────────────────────
 * free:                  0 AI requests/day (no AI access)
 * general_english:       AI_DAILY_LIMIT_GENERAL (default 5)  per day
 * professional_english:  AI_DAILY_LIMIT_PRO     (default 20) per day
 * admin:                 unlimited
 *
 * REDIS KEYS
 * ──────────
 * v1:ai:daily:{userId}:{YYYY-MM-DD}     → daily request counter (TTL: 25h)
 * v1:ai:lock:{userId}                   → concurrent request lock (TTL: 60s)
 *
 * USAGE
 * ──────
 * const ctx = { userId, subscriptionPlan, feature };
 * await quota.checkAndIncrement(ctx);  // throws if quota exceeded or Redis down
 * // ... call AI provider ...
 * await quota.recordUsage({ ...ctx, modelId, tokensUsed, succeeded });
 */

import { withRedisCritical, withRedis } from "./redis";
import { pool } from "@workspace/db";
import type { AIFeature } from "./ai";
import { logger } from "../lib/logger";

// ─── Config ───────────────────────────────────────────────────────────────────

const DAILY_LIMITS: Record<string, number> = {
  free:                  0,
  general_english:       parseInt(process.env.AI_DAILY_LIMIT_GENERAL ?? "5", 10),
  professional_english:  parseInt(process.env.AI_DAILY_LIMIT_PRO ?? "20", 10),
  admin:                 Infinity,
};

function getDailyLimit(plan: string | null): number {
  return DAILY_LIMITS[plan ?? "free"] ?? 0;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QuotaContext {
  userId: number;
  subscriptionPlan: string | null;
  feature: AIFeature;
}

export interface UsageRecord extends QuotaContext {
  provider: string;
  modelId: string;
  tokensUsed: number;
  costUsd?: number;
  succeeded: boolean;
  requestId?: string;
}

// ─── Quota check ──────────────────────────────────────────────────────────────

/**
 * Check whether the user has quota remaining, then atomically increment
 * the counter if they do.
 *
 * Throws:
 *   - QuotaExceededError if the daily limit is reached
 *   - Error if Redis is unavailable (fail closed)
 */
export async function checkAndIncrement(ctx: QuotaContext): Promise<void> {
  const limit = getDailyLimit(ctx.subscriptionPlan);

  // Admin bypass
  if (!isFinite(limit)) return;

  // Free plan — no AI access at all
  if (limit === 0) {
    throw Object.assign(
      new Error("AI features are not available on the free plan. Please upgrade to access this feature."),
      { status: 403, code: "AI_QUOTA_PLAN_INELIGIBLE" },
    );
  }

  const redisKey = `v1:ai:daily:${ctx.userId}:${todayKey()}`;

  // Fails closed if Redis unavailable (withRedisCritical throws)
  await withRedisCritical(async (r) => {
    // INCR is atomic — no race condition
    const current = await r.incr(redisKey);

    // Set TTL on first request of the day (25h to handle timezone drift)
    if (current === 1) await r.expire(redisKey, 25 * 3600);

    if (current > limit) {
      // Decrement to not count the failed attempt
      await r.decr(redisKey);
      throw Object.assign(
        new Error(
          `Daily AI request limit reached (${limit} requests/day for your plan). ` +
          `Your limit resets at midnight UTC.`,
        ),
        { status: 429, code: "AI_QUOTA_EXCEEDED" },
      );
    }
  }, "AI quota check");
}

/**
 * Get current daily usage for a user. Returns null if Redis is unavailable.
 * Used for displaying quota info in the API without enforcing limits.
 */
export async function getDailyUsage(userId: number): Promise<{ used: number; limit: number } | null> {
  return withRedis(async (r) => {
    const key = `v1:ai:daily:${userId}:${todayKey()}`;
    const raw = await r.get(key);
    return { used: parseInt(raw ?? "0", 10), limit: 0 }; // limit filled by caller
  }, null);
}

// ─── Usage persistence ────────────────────────────────────────────────────────

/**
 * Persist an AI usage record to PostgreSQL for billing and audit.
 * Called after the AI request completes (success or failure).
 * Non-blocking — logged on error but never throws.
 */
export async function recordUsage(record: UsageRecord): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO ai_usage_logs
         (user_id, feature, provider, model_id, tokens_used, cost_usd, succeeded, request_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        record.userId,
        record.feature,
        record.provider,
        record.modelId,
        record.tokensUsed,
        record.costUsd ?? null,
        record.succeeded,
        record.requestId ?? null,
      ],
    );
  } catch (err) {
    // Log but never let a logging failure affect the user experience
    logger.error({ err, userId: record.userId, feature: record.feature }, "Failed to persist AI usage record");
  }
}

// ─── Distributed lock (for concurrent request control) ───────────────────────

/**
 * Acquire a per-user lock to prevent concurrent AI requests.
 * Returns true if the lock was acquired; false if another request is in flight.
 * Lock auto-expires after 60 seconds.
 */
export async function acquireLock(userId: number): Promise<boolean> {
  return withRedis(async (r) => {
    const key = `v1:ai:lock:${userId}`;
    // SET NX EX: set only if not exists, with 60s expiry
    const result = await r.set(key, "1", "EX", 60, "NX");
    return result === "OK";
  }, true); // fail open: if Redis is down, allow the request
}

export async function releaseLock(userId: number): Promise<void> {
  await withRedis(async (r) => {
    await r.del(`v1:ai:lock:${userId}`);
    return null;
  }, null);
}

-- =============================================================================
-- Migration 007: Open-answer grading
--
-- Two things the grader needs that did not exist:
--
--   1. Token prices, so a call can be costed. Without them `ai_usage_logs.
--      cost_usd` stays null, the month-to-date total reads $0, and the monthly
--      budget ceiling in ai_settings can never trigger.
--   2. Somewhere to keep an AI verdict on a lesson activity. Quiz responses
--      already have `ai_meta` and `feedback`; learning_activity_attempts had
--      only a score.
--
-- Idempotent — safe to run multiple times on any database state.
-- =============================================================================

BEGIN;

-- ─── Token prices, per provider ──────────────────────────────────────────────
-- Per million tokens, which is how every provider quotes them. Null means
-- "unknown", and an unknown price records a null cost rather than guessing —
-- a fabricated cost is worse than no cost, because the budget would act on it.

ALTER TABLE ai_providers
  ADD COLUMN IF NOT EXISTS input_price_per_mtok  REAL,
  ADD COLUMN IF NOT EXISTS output_price_per_mtok REAL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_providers_prices_check') THEN
    ALTER TABLE ai_providers
      ADD CONSTRAINT ai_providers_prices_check
      CHECK (
        (input_price_per_mtok  IS NULL OR input_price_per_mtok  >= 0) AND
        (output_price_per_mtok IS NULL OR output_price_per_mtok >= 0)
      );
  END IF;
END $$;

-- Split the token count so cost can be computed from two different rates.
ALTER TABLE ai_usage_logs
  ADD COLUMN IF NOT EXISTS prompt_tokens     INTEGER,
  ADD COLUMN IF NOT EXISTS completion_tokens INTEGER;

-- ─── AI verdicts on a lesson activity ────────────────────────────────────────
-- `quiz_responses` already carries feedback and ai_meta. Give the lesson path
-- the same, so an open-ended answer inside a lesson can be graded and explained
-- the same way as one inside a quiz.

ALTER TABLE learning_activity_attempts
  ADD COLUMN IF NOT EXISTS feedback     TEXT,
  ADD COLUMN IF NOT EXISTS feedback_ar  TEXT,
  ADD COLUMN IF NOT EXISTS graded_by    TEXT NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS ai_meta      JSONB;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'laa_graded_by_check') THEN
    ALTER TABLE learning_activity_attempts
      ADD CONSTRAINT laa_graded_by_check
      CHECK (graded_by IN ('auto', 'ai', 'teacher', 'pending'));
  END IF;
END $$;

-- Rows written before this migration were graded by application logic or left
-- pending; label them accordingly rather than letting the 'auto' default claim
-- the pending ones were decided.
UPDATE learning_activity_attempts
   SET graded_by = 'pending'
 WHERE evaluation_status = 'pending'
   AND graded_by = 'auto';

-- Finding the work still awaiting a verdict, without scanning every attempt.
CREATE INDEX IF NOT EXISTS laa_pending_idx
  ON learning_activity_attempts (submitted_at)
  WHERE evaluation_status = 'pending';

CREATE INDEX IF NOT EXISTS quiz_responses_pending_idx
  ON quiz_responses (attempt_id)
  WHERE graded_by = 'pending';

COMMIT;

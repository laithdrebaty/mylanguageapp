-- =============================================================================
-- Migration 010: Grading recovery and manual marking
--
-- Everything that needs AI to mark it can end up `pending`, and until now
-- pending was a dead end. Jobs run in-process, so a restart between submit and
-- run loses one; a provider outage leaves work behind; and no human could mark
-- any of it. A student's answer could sit unmarked forever with nothing that
-- would ever notice.
--
-- Two things fix that, and both need somewhere to record state:
--   1. A sweeper that finds stale pending work and tries again — which needs to
--      know how many times it has already tried, or a permanently unmarkable
--      answer becomes an infinite retry loop against a paid API.
--   2. A marking queue for staff, which needs to know why something is waiting.
--
-- Idempotent — safe to run multiple times on any database state.
-- =============================================================================

BEGIN;

-- ─── Retry accounting ────────────────────────────────────────────────────────

ALTER TABLE quiz_responses
  ADD COLUMN IF NOT EXISTS grading_attempts   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_grading_error TEXT,
  ADD COLUMN IF NOT EXISTS last_graded_at     TIMESTAMPTZ;

ALTER TABLE learning_activity_attempts
  ADD COLUMN IF NOT EXISTS grading_attempts   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_grading_error TEXT,
  ADD COLUMN IF NOT EXISTS last_graded_at     TIMESTAMPTZ;

-- The sweeper's query: pending work, oldest first, that has not exhausted its
-- retries. Partial so the index stays small — graded rows are the vast
-- majority and are never scanned for this.
CREATE INDEX IF NOT EXISTS quiz_responses_sweep_idx
  ON quiz_responses (created_at)
  WHERE graded_by = 'pending';

CREATE INDEX IF NOT EXISTS laa_sweep_idx
  ON learning_activity_attempts (submitted_at)
  WHERE evaluation_status = 'pending';

-- ─── Who marked it by hand ───────────────────────────────────────────────────
-- `graded_by` already records 'teacher', but not *which* teacher. A mark a
-- human gave is a decision someone is accountable for.

ALTER TABLE quiz_responses
  ADD COLUMN IF NOT EXISTS graded_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE learning_activity_attempts
  ADD COLUMN IF NOT EXISTS graded_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

COMMIT;

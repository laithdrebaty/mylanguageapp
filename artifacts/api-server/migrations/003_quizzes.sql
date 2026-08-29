-- =============================================================================
-- Migration 003: Quizzes
-- Idempotent — safe to run multiple times on any database state.
-- =============================================================================

BEGIN;

-- ─── content_blocks becomes polymorphic ──────────────────────────────────────
-- A block hangs off EITHER a lesson OR a quiz. Reusing one block table keeps a
-- single student renderer, editor, and AI assessment path.

ALTER TABLE content_blocks
  ADD COLUMN IF NOT EXISTS quiz_id INTEGER;

-- lesson_id must become nullable so quiz-owned blocks can leave it empty.
ALTER TABLE content_blocks
  ALTER COLUMN lesson_id DROP NOT NULL;

-- ─── Quizzes ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS quizzes (
  id                       SERIAL PRIMARY KEY,
  title                    TEXT        NOT NULL,
  title_ar                 TEXT        NOT NULL,
  description              TEXT,
  description_ar           TEXT,
  instructions             TEXT,
  instructions_ar          TEXT,
  level_id                 INTEGER     REFERENCES levels(id),
  time_limit_sec           INTEGER,
  max_attempts             INTEGER,
  passing_score            INTEGER     NOT NULL DEFAULT 75,
  xp_reward                INTEGER     NOT NULL DEFAULT 50,
  shuffle_blocks           BOOLEAN     NOT NULL DEFAULT FALSE,
  reveal_answers           TEXT        NOT NULL DEFAULT 'after_submit',
  status                   TEXT        NOT NULL DEFAULT 'draft',
  content_version          INTEGER     NOT NULL DEFAULT 1,
  tags                     TEXT[],
  teacher_notes            TEXT,
  created_by               INTEGER     REFERENCES users(id),
  soft_deleted_at          TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS quizzes_status_idx   ON quizzes (status);
CREATE INDEX IF NOT EXISTS quizzes_level_idx    ON quizzes (level_id);

-- Now that quizzes exists, wire up the FK and the either/or invariant.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'content_blocks_quiz_id_fk'
  ) THEN
    ALTER TABLE content_blocks
      ADD CONSTRAINT content_blocks_quiz_id_fk
      FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'content_blocks_parent_ck'
  ) THEN
    ALTER TABLE content_blocks
      ADD CONSTRAINT content_blocks_parent_ck
      CHECK (num_nonnulls(lesson_id, quiz_id) = 1);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS content_blocks_quiz_order_idx
  ON content_blocks (quiz_id, "order");

-- ─── Attempts ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id                    SERIAL PRIMARY KEY,
  quiz_id               INTEGER     NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  user_id               INTEGER     NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  content_version       INTEGER     NOT NULL DEFAULT 1,
  status                TEXT        NOT NULL DEFAULT 'in_progress',
  score                 REAL,
  passed                BOOLEAN,
  pending_review_count  INTEGER     NOT NULL DEFAULT 0,
  started_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at          TIMESTAMPTZ,
  graded_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS quiz_attempts_user_quiz_idx
  ON quiz_attempts (user_id, quiz_id);
CREATE INDEX IF NOT EXISTS quiz_attempts_status_idx
  ON quiz_attempts (status);

-- One in-progress attempt per student per quiz.
CREATE UNIQUE INDEX IF NOT EXISTS quiz_attempts_one_active_idx
  ON quiz_attempts (user_id, quiz_id)
  WHERE status = 'in_progress';

-- ─── Responses ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS quiz_responses (
  id           SERIAL PRIMARY KEY,
  attempt_id   INTEGER     NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
  block_id     INTEGER     NOT NULL REFERENCES content_blocks(id) ON DELETE CASCADE,
  response     JSONB,
  media_key    TEXT,
  transcript   TEXT,
  score        REAL,
  graded_by    TEXT        NOT NULL DEFAULT 'pending',
  feedback     TEXT,
  feedback_ar  TEXT,
  ai_meta      JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ
);

-- One response row per block per attempt; re-answering updates in place.
CREATE UNIQUE INDEX IF NOT EXISTS quiz_responses_attempt_block_idx
  ON quiz_responses (attempt_id, block_id);
-- Drives the teacher's "needs grading" queue.
CREATE INDEX IF NOT EXISTS quiz_responses_pending_idx
  ON quiz_responses (graded_by) WHERE graded_by = 'pending';

COMMIT;

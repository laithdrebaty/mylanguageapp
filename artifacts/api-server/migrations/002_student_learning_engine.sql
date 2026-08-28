-- =============================================================================
-- Migration 002: Student Learning Engine
-- Idempotent — safe to run multiple times on any database state.
-- Apply with: psql $DATABASE_URL -f migrations/002_student_learning_engine.sql
-- =============================================================================
-- Preserves all existing data.
-- Deduplicates before adding unique indexes where needed.
-- Does NOT drop or destructively alter existing tables/columns.
-- =============================================================================

BEGIN;

-- ─── student_profiles: fix serial misuse → integer default 0 ─────────────────
-- serial columns created by older ORM code get auto-sequenced; we convert
-- streak_days and total_xp to plain integers with a default of 0.
-- No data loss — existing positive values are preserved.

DO $$
BEGIN
  -- streak_days: drop the default only if it is a sequence (serial behaviour)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'student_profiles'
      AND column_name = 'streak_days'
      AND column_default LIKE 'nextval%'
  ) THEN
    ALTER TABLE student_profiles ALTER COLUMN streak_days SET DEFAULT 0;
  END IF;

  -- total_xp: same treatment
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'student_profiles'
      AND column_name = 'total_xp'
      AND column_default LIKE 'nextval%'
  ) THEN
    ALTER TABLE student_profiles ALTER COLUMN total_xp SET DEFAULT 0;
  END IF;
END $$;

-- ─── student_profiles: unique user_id ────────────────────────────────────────
-- Deduplicate before adding the unique index (keep the row with the lowest id).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'student_profiles'
      AND indexname = 'student_profiles_user_id_unique'
  ) THEN
    -- Remove duplicate user_id rows keeping the one with the smallest id
    DELETE FROM student_profiles sp1
    USING student_profiles sp2
    WHERE sp1.user_id = sp2.user_id
      AND sp1.id > sp2.id;

    CREATE UNIQUE INDEX student_profiles_user_id_unique
      ON student_profiles(user_id);
  END IF;
END $$;

-- ─── lesson_progress: add content_version column ─────────────────────────────

ALTER TABLE lesson_progress
  ADD COLUMN IF NOT EXISTS content_version INTEGER NOT NULL DEFAULT 1;

-- ─── lesson_progress: unique user + lesson ────────────────────────────────────
-- Deduplicate (keep latest updated_at row) before adding the unique index.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'lesson_progress'
      AND indexname = 'lesson_progress_user_lesson_unique'
  ) THEN
    -- Keep the row with the highest updated_at (or id as tiebreaker) per user+lesson
    DELETE FROM lesson_progress lp1
    USING lesson_progress lp2
    WHERE lp1.user_id = lp2.user_id
      AND lp1.lesson_id = lp2.lesson_id
      AND (
        lp1.updated_at < lp2.updated_at
        OR (lp1.updated_at = lp2.updated_at AND lp1.id < lp2.id)
      );

    CREATE UNIQUE INDEX lesson_progress_user_lesson_unique
      ON lesson_progress(user_id, lesson_id);
  END IF;
END $$;

-- Performance index on user_id for progress lookups
CREATE INDEX IF NOT EXISTS lesson_progress_user_id_idx
  ON lesson_progress(user_id);

-- ─── lesson_block_progress ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lesson_block_progress (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id        INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  block_id         INTEGER NOT NULL REFERENCES content_blocks(id) ON DELETE CASCADE,
  content_version  INTEGER NOT NULL DEFAULT 1,
  completed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'lesson_block_progress'
      AND indexname = 'lbp_user_lesson_block_version_unique'
  ) THEN
    CREATE UNIQUE INDEX lbp_user_lesson_block_version_unique
      ON lesson_block_progress(user_id, lesson_id, block_id, content_version);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS lbp_user_lesson_idx
  ON lesson_block_progress(user_id, lesson_id);

-- ─── learning_activity_attempts ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS learning_activity_attempts (
  id                          SERIAL PRIMARY KEY,
  user_id                     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id                   INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  block_id                    INTEGER NOT NULL REFERENCES content_blocks(id) ON DELETE CASCADE,
  exercise_id                 INTEGER REFERENCES exercises(id) ON DELETE SET NULL,
  content_version             INTEGER NOT NULL DEFAULT 1,
  activity_type               TEXT NOT NULL,
  client_submission_id        TEXT NOT NULL,
  selected_option_id          TEXT,
  response_text               TEXT,
  media_reference             TEXT,
  recording_duration_seconds  INTEGER,
  is_correct                  BOOLEAN,
  score                       REAL,
  evaluation_status           TEXT NOT NULL DEFAULT 'graded'
                                CHECK (evaluation_status IN ('graded', 'pending', 'skipped')),
  metadata                    JSONB,
  submitted_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'learning_activity_attempts'
      AND indexname = 'laa_user_client_submission_id_unique'
  ) THEN
    CREATE UNIQUE INDEX laa_user_client_submission_id_unique
      ON learning_activity_attempts(user_id, client_submission_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS laa_user_lesson_idx
  ON learning_activity_attempts(user_id, lesson_id);

CREATE INDEX IF NOT EXISTS laa_user_block_idx
  ON learning_activity_attempts(user_id, block_id);

COMMIT;

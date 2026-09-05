-- =============================================================================
-- Migration 004: Level evaluation tests and student promotion
--
-- Spec section 10 ("Level Evaluation Tests") and section 2 (administrator
-- override of placement). Before this migration a student's level was written
-- once by the placement test and never again — there was no path from A1.1 to
-- A1.2. This adds the gate and the audit trail behind it.
--
-- Idempotent — safe to run multiple times on any database state.
-- =============================================================================

BEGIN;

-- ─── A quiz can now be a level's evaluation gate ─────────────────────────────

ALTER TABLE quizzes
  ADD COLUMN IF NOT EXISTS kind           TEXT NOT NULL DEFAULT 'practice',
  ADD COLUMN IF NOT EXISTS cooldown_hours INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'quizzes_kind_check'
  ) THEN
    ALTER TABLE quizzes
      ADD CONSTRAINT quizzes_kind_check
      CHECK (kind IN ('practice', 'level_evaluation'));
  END IF;
END $$;

-- An evaluation with no level cannot gate anything, and a negative cooldown is
-- meaningless. Both are author mistakes worth refusing at the database.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'quizzes_evaluation_needs_level_check'
  ) THEN
    ALTER TABLE quizzes
      ADD CONSTRAINT quizzes_evaluation_needs_level_check
      CHECK (kind <> 'level_evaluation' OR level_id IS NOT NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'quizzes_cooldown_hours_check'
  ) THEN
    ALTER TABLE quizzes
      ADD CONSTRAINT quizzes_cooldown_hours_check
      CHECK (cooldown_hours IS NULL OR cooldown_hours >= 0);
  END IF;
END $$;

-- A level may have only one evaluation gate — otherwise the promotion lookup
-- would pick one arbitrarily. That constraint is created by migration 009, not
-- here.
--
-- It originally lived in this file and counted drafts as live, which meant a
-- curriculum team could not prepare a replacement while one was published. 009
-- narrows it to published evaluations only. Creating the old index here as well
-- would fail on any database that has since drafted a second one, because every
-- migration in this directory is re-applied in order on each run.

CREATE INDEX IF NOT EXISTS quizzes_kind_idx ON quizzes (kind);

-- ─── How much of a level must be finished before its gate unlocks ────────────

ALTER TABLE levels
  ADD COLUMN IF NOT EXISTS evaluation_unlock_percent INTEGER NOT NULL DEFAULT 100;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'levels_evaluation_unlock_percent_check'
  ) THEN
    ALTER TABLE levels
      ADD CONSTRAINT levels_evaluation_unlock_percent_check
      CHECK (evaluation_unlock_percent BETWEEN 0 AND 100);
  END IF;
END $$;

-- ─── Audit trail of every level change ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS level_progressions (
  id                  SERIAL PRIMARY KEY,
  user_id             INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  curriculum_id       INTEGER     NOT NULL REFERENCES curricula(id),
  from_level_id       INTEGER     REFERENCES levels(id),
  to_level_id         INTEGER     NOT NULL REFERENCES levels(id),
  reason              TEXT        NOT NULL,
  quiz_attempt_id     INTEGER     REFERENCES quiz_attempts(id) ON DELETE SET NULL,
  decided_by_user_id  INTEGER     REFERENCES users(id),
  note                TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'level_progressions_reason_check'
  ) THEN
    ALTER TABLE level_progressions
      ADD CONSTRAINT level_progressions_reason_check
      CHECK (reason IN ('placement', 'evaluation', 'admin_override'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS level_progressions_user_idx
  ON level_progressions (user_id, created_at);

-- One promotion per passed attempt. This is what makes applyEvaluationOutcome
-- safe to call more than once: a double submit, a retried background job, or a
-- late AI verdict landing after a teacher already graded the same attempt all
-- collapse to a single promotion instead of walking the student up two levels.
CREATE UNIQUE INDEX IF NOT EXISTS level_progressions_one_per_attempt
  ON level_progressions (quiz_attempt_id)
  WHERE quiz_attempt_id IS NOT NULL;

-- ─── Backfill ────────────────────────────────────────────────────────────────
-- Students placed before this migration have a level but no history. Give each
-- one a 'placement' row so the timeline starts where they actually started,
-- rather than appearing to have materialised at their current level.

INSERT INTO level_progressions (user_id, curriculum_id, from_level_id, to_level_id, reason, created_at)
SELECT
  sp.user_id,
  sp.curriculum_id,
  NULL,
  sp.current_level_id,
  'placement',
  COALESCE(pr.completed_at, sp.created_at)
FROM student_profiles sp
LEFT JOIN LATERAL (
  SELECT completed_at
  FROM placement_results
  WHERE user_id = sp.user_id
  ORDER BY completed_at DESC
  LIMIT 1
) pr ON TRUE
WHERE sp.current_level_id IS NOT NULL
  AND sp.curriculum_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM level_progressions lp WHERE lp.user_id = sp.user_id
  );

COMMIT;

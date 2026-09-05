-- =============================================================================
-- Migration 009: Narrow the "one evaluation per level" rule to published ones
--
-- Migration 004 enforced at most one live level evaluation per level, counting
-- drafts and approved quizzes as live. That is stricter than the invariant it
-- was protecting: `getLevelEvaluation` only ever looks for a *published*
-- evaluation, so only published ones can collide.
--
-- The practical cost was real. A curriculum team could not draft next term's
-- A1.1 evaluation while this term's was published — the insert failed on a
-- constraint, and the API reported it as a 500 with no explanation.
--
-- Idempotent — safe to run multiple times on any database state.
-- =============================================================================

BEGIN;

DROP INDEX IF EXISTS quizzes_one_live_evaluation_per_level;

-- Exactly one PUBLISHED evaluation per level. Drafts, quizzes in review and
-- approved-but-unpublished ones are free to accumulate: a replacement has to be
-- prepared somewhere, and none of them is reachable by a student.
CREATE UNIQUE INDEX IF NOT EXISTS quizzes_one_published_evaluation_per_level
  ON quizzes (level_id)
  WHERE kind = 'level_evaluation'
    AND status = 'published'
    AND soft_deleted_at IS NULL;

COMMIT;

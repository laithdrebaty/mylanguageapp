-- =============================================================================
-- Migration 012: Multi-skill placement
--
-- Spec section 2 asks the placement test to assess reading, listening,
-- vocabulary, grammar, comprehension, writing, speaking and pronunciation, then
-- identify strengths, weaknesses and where the student should put effort.
--
-- What existed was ten untagged multiple-choice questions producing one
-- percentage, which was mapped to a level by position. That cannot say anything
-- about *which* skills are weak, because it never knew which skill any question
-- was testing.
--
-- The change is small and consequential: tag each question with the skill it
-- tests, and record the per-skill breakdown alongside the result. Everything
-- downstream — the analysis, the strengths, the advice — becomes possible only
-- because the evidence is now labelled.
--
-- Idempotent — safe to run multiple times on any database state.
-- =============================================================================

BEGIN;

-- ─── Questions know what they test ───────────────────────────────────────────

ALTER TABLE placement_questions
  ADD COLUMN IF NOT EXISTS skill      TEXT NOT NULL DEFAULT 'grammar',
  /**
   * Roughly which level this question sits at. A student who answers the hard
   * questions correctly and the easy ones too is not the same as one who
   * scrambles through — position in the list is not difficulty.
   */
  ADD COLUMN IF NOT EXISTS difficulty TEXT NOT NULL DEFAULT 'A1',
  /** Reading and listening questions share a passage; this is its text. */
  ADD COLUMN IF NOT EXISTS passage    TEXT,
  ADD COLUMN IF NOT EXISTS media_id   INTEGER REFERENCES media_assets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_active  BOOLEAN NOT NULL DEFAULT TRUE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'placement_questions_skill_check') THEN
    ALTER TABLE placement_questions
      ADD CONSTRAINT placement_questions_skill_check
      CHECK (skill IN ('reading', 'listening', 'vocabulary', 'grammar', 'comprehension', 'writing'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'placement_questions_difficulty_check') THEN
    ALTER TABLE placement_questions
      ADD CONSTRAINT placement_questions_difficulty_check
      CHECK (difficulty IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2'));
  END IF;
END $$;

-- `type` was constrained to mcq and fill_blank. A written answer is neither,
-- and section 2 asks for writing to be assessed.
DO $$
DECLARE
  con_name TEXT;
BEGIN
  SELECT conname INTO con_name
    FROM pg_constraint
   WHERE conrelid = 'placement_questions'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%fill_blank%'
     AND pg_get_constraintdef(oid) NOT LIKE '%writing%'
   LIMIT 1;

  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE placement_questions DROP CONSTRAINT %I', con_name);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'placement_questions_type_check') THEN
    ALTER TABLE placement_questions
      ADD CONSTRAINT placement_questions_type_check
      CHECK (type IN ('mcq', 'fill_blank', 'written'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS placement_questions_active_idx
  ON placement_questions ("order") WHERE is_active;

-- ─── Results carry the breakdown, not just a total ───────────────────────────

ALTER TABLE placement_results
  /** { grammar: 62, vocabulary: 80, ... } — one entry per skill tested. */
  ADD COLUMN IF NOT EXISTS skill_scores    JSONB,
  ADD COLUMN IF NOT EXISTS strengths       TEXT[],
  ADD COLUMN IF NOT EXISTS weaknesses      TEXT[],
  /** The AI's reading of the result, in Arabic. Null when AI was unavailable. */
  ADD COLUMN IF NOT EXISTS analysis_ar     TEXT,
  /** The student's written answer, and what it scored. */
  ADD COLUMN IF NOT EXISTS writing_sample  TEXT,
  ADD COLUMN IF NOT EXISTS writing_score   REAL,
  /**
   * The level arithmetic produced, before any AI adjustment. Kept so an
   * adjustment can always be traced and reversed — an assignment nobody can
   * explain is one nobody can defend to a student.
   */
  ADD COLUMN IF NOT EXISTS computed_level_code TEXT,
  /** Why the AI moved it, when it did. */
  ADD COLUMN IF NOT EXISTS adjustment_reason   TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'placement_results_writing_score_check') THEN
    ALTER TABLE placement_results
      ADD CONSTRAINT placement_results_writing_score_check
      CHECK (writing_score IS NULL OR writing_score BETWEEN 0 AND 100);
  END IF;
END $$;

-- ─── Tag the seeded questions ────────────────────────────────────────────────
-- The existing ten were written as a general mix and all defaulted to grammar.
-- Spreading them across skills makes the breakdown meaningful immediately
-- rather than reporting one skill and six empty ones. The seed script replaces
-- them with a properly authored set; this keeps an already-seeded database
-- sensible in the meantime.

UPDATE placement_questions
   SET skill = CASE ("order" % 4)
                 WHEN 0 THEN 'grammar'
                 WHEN 1 THEN 'vocabulary'
                 WHEN 2 THEN 'reading'
                 ELSE 'comprehension'
               END
 WHERE skill = 'grammar'
   AND NOT EXISTS (
     SELECT 1 FROM placement_questions WHERE skill <> 'grammar'
   );

COMMIT;

-- =============================================================================
-- Migration 008: Speech assessment
--
-- Somewhere to put what a spoken answer produced. Two scores rather than one,
-- because pronunciation and fluency are different things measured differently:
-- pronunciation from aligning the transcript against the passage the student
-- was given, fluency from the word timings. Both are computed in application
-- code, so these columns hold measurements, not model opinions.
--
-- The transcript is stored because it is the evidence. A student who disputes a
-- score is entitled to see which words we heard, and a teacher regrading needs
-- the same.
--
-- Idempotent — safe to run multiple times on any database state.
-- =============================================================================

BEGIN;

-- ─── Lesson activities ───────────────────────────────────────────────────────

ALTER TABLE learning_activity_attempts
  ADD COLUMN IF NOT EXISTS transcript          TEXT,
  ADD COLUMN IF NOT EXISTS pronunciation_score REAL,
  ADD COLUMN IF NOT EXISTS fluency_score       REAL,
  /** Speech rate, pauses, run length, and the aligned word list. */
  ADD COLUMN IF NOT EXISTS speech_metrics      JSONB;

-- ─── Quiz responses ──────────────────────────────────────────────────────────
-- `transcript` already exists here from the original quiz schema.

ALTER TABLE quiz_responses
  ADD COLUMN IF NOT EXISTS pronunciation_score REAL,
  ADD COLUMN IF NOT EXISTS fluency_score       REAL,
  ADD COLUMN IF NOT EXISTS speech_metrics      JSONB;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'laa_speech_scores_check') THEN
    ALTER TABLE learning_activity_attempts
      ADD CONSTRAINT laa_speech_scores_check
      CHECK (
        (pronunciation_score IS NULL OR pronunciation_score BETWEEN 0 AND 100) AND
        (fluency_score       IS NULL OR fluency_score       BETWEEN 0 AND 100)
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quiz_responses_speech_scores_check') THEN
    ALTER TABLE quiz_responses
      ADD CONSTRAINT quiz_responses_speech_scores_check
      CHECK (
        (pronunciation_score IS NULL OR pronunciation_score BETWEEN 0 AND 100) AND
        (fluency_score       IS NULL OR fluency_score       BETWEEN 0 AND 100)
      );
  END IF;
END $$;

-- ─── The passage a block asks the student to read ────────────────────────────
-- `content_blocks.content` already holds the reading text. A speaking block
-- that is open-ended (no set passage) has none, and the two cases are scored
-- differently: with a passage, pronunciation can be measured against it;
-- without one, only fluency can. Making that explicit stops the grader from
-- inferring it from whether `content` happens to be populated.

ALTER TABLE content_blocks
  ADD COLUMN IF NOT EXISTS expects_reference_reading BOOLEAN NOT NULL DEFAULT FALSE;

-- Existing pronunciation blocks with a passage are read-aloud exercises.
UPDATE content_blocks
   SET expects_reference_reading = TRUE
 WHERE type IN ('pronunciation_guide', 'pronunciation')
   AND content IS NOT NULL
   AND length(trim(content)) > 0
   AND expects_reference_reading = FALSE;

COMMIT;

-- =============================================================================
-- Migration 016: Monthly AI allowances, denominated the way plans are sold
--
-- WHY
-- ───
-- `ai_plan_policies.daily_limit` counts MODEL CALLS PER DAY. The plans are sold
-- as lessons and calls PER MONTH, and the cost of a conversation is driven by
-- its MINUTES, not by how many times the model was called.
--
-- With `conversation: 5` a student may start five sessions a day. At ten
-- minutes each that is 50 minutes daily — roughly $15 of conversation on a $2
-- subscription. The limit exists but does not bound the thing that costs money.
--
-- This adds monthly allowances alongside the daily counter. The daily limit is
-- kept as an anti-abuse burst control; the monthly columns are what make the
-- plan economics hold.
--
--   -1 = unlimited, 0 = denied, NULL = fall back to the daily limit only.
-- =============================================================================

ALTER TABLE ai_plan_policies
  ADD COLUMN IF NOT EXISTS monthly_limit integer;

-- Conversation is 92% of a lesson's AI cost and the only task whose spend is
-- driven by duration rather than request count. Minutes are what must be
-- capped; a request count cannot express "ten minutes per lesson".
ALTER TABLE ai_plan_policies
  ADD COLUMN IF NOT EXISTS monthly_minutes integer;

COMMENT ON COLUMN ai_plan_policies.monthly_limit IS
  'Requests per calendar month. -1 unlimited, 0 denied, NULL = daily limit only.';
COMMENT ON COLUMN ai_plan_policies.monthly_minutes IS
  'Audio/conversation minutes per calendar month. Only meaningful for duration-based tasks.';

-- ─── Seed the plans as sold ──────────────────────────────────────────────────
-- General $2 / Professional $4: 12 lessons, 8 peer calls per month.
-- General $5 / Professional $7: 24 lessons, 16 peer calls per month.
--
-- One lesson carries one read-aloud, one open-ended answer and one
-- conversation, so the per-task monthly allowance is the lesson count. The
-- headroom above it absorbs retries, which section 4A requires.

-- free: no AI at all.
UPDATE ai_plan_policies SET monthly_limit = 0, monthly_minutes = 0
 WHERE plan_code = 'free';

-- 12-lesson tiers. Transcription covers read-aloud plus spoken open answers
-- plus peer calls, so its allowance is deliberately larger.
UPDATE ai_plan_policies SET monthly_limit = 20
 WHERE plan_code IN ('general_english') AND task IN ('open_answer', 'feedback');
UPDATE ai_plan_policies SET monthly_limit = 60
 WHERE plan_code IN ('general_english') AND task = 'transcription';
UPDATE ai_plan_policies SET monthly_limit = 20, monthly_minutes = 120
 WHERE plan_code IN ('general_english') AND task = 'conversation';

UPDATE ai_plan_policies SET monthly_limit = 20
 WHERE plan_code IN ('professional_english') AND task IN ('open_answer', 'feedback');
UPDATE ai_plan_policies SET monthly_limit = 60
 WHERE plan_code IN ('professional_english') AND task = 'transcription';
UPDATE ai_plan_policies SET monthly_limit = 20, monthly_minutes = 120
 WHERE plan_code IN ('professional_english') AND task = 'conversation';

-- Analysis tasks run once per placement or per review, not per lesson.
UPDATE ai_plan_policies SET monthly_limit = 10
 WHERE plan_code <> 'free' AND task IN ('placement_analysis', 'weakness_analysis');

-- Raise the daily limits so the MONTHLY allowance is what binds.
--
-- The daily figure was 5 on general_english, which would stop a student on
-- their sixth lesson of the day even though the month still had allowance left.
-- Its job is to stop a runaway loop, not to pace study: a day of twelve lessons
-- is unusual but legitimate, and the monthly cap is what protects the margin.
UPDATE ai_plan_policies SET daily_limit = 12
 WHERE plan_code IN ('general_english', 'professional_english')
   AND task IN ('open_answer', 'feedback', 'conversation');
UPDATE ai_plan_policies SET daily_limit = 30
 WHERE plan_code IN ('general_english', 'professional_english')
   AND task = 'transcription';

-- Admin stays unlimited: staff walk the student flow to check content.
UPDATE ai_plan_policies SET monthly_limit = -1, monthly_minutes = -1
 WHERE plan_code = 'admin';

-- ─── The task column ─────────────────────────────────────────────────────────
-- `ai_usage_logs` is created by 001 with a free-text `feature` and nothing
-- else; `task` is what every quota and report actually groups by, and it was
-- never added by any migration — the index below referenced a column that only
-- existed on databases where it had been created by hand.
--
-- The consequence was silent and total: `recordUsage` INSERTs `task`, so on a
-- freshly migrated database EVERY usage write failed with "column task does not
-- exist". Nothing surfaced — usage logging is deliberately fire-and-forget so a
-- logging failure cannot break a student's lesson — so the usage panel read $0,
-- month-to-date spend read $0, and the monthly budget ceiling could never
-- trigger. The AI was running with no accounting at all.
ALTER TABLE ai_usage_logs
  ADD COLUMN IF NOT EXISTS task TEXT;

-- Backfill from the legacy label so old rows stay groupable.
UPDATE ai_usage_logs SET task = feature WHERE task IS NULL;

-- ─── Reporting indexes ───────────────────────────────────────────────────────
-- The admin usage panel groups by task and by user over a date range, and the
-- monthly quota check sums a single user's spend for the current month. Without
-- these both scan the whole table once a month's logs accumulate.
CREATE INDEX IF NOT EXISTS ai_usage_logs_created_idx
  ON ai_usage_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_logs_user_created_idx
  ON ai_usage_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_logs_task_created_idx
  ON ai_usage_logs (task, created_at DESC);

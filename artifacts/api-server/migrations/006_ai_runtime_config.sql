-- =============================================================================
-- Migration 006: Runtime AI configuration
--
-- Which provider, which model per task, and how much each plan may use are all
-- decisions that change more often than the code does — and the business split
-- is not settled yet. Putting them in env vars means a redeploy to change a
-- model id, and putting the per-plan limits in a JavaScript object means a code
-- change to price a new tier. Both live here instead, edited from an admin
-- panel at runtime.
--
-- API keys are stored encrypted (AES-256-GCM, key from AI_CONFIG_SECRET) and
-- are never returned by any endpoint — only a last-four hint for recognition.
--
-- Idempotent — safe to run multiple times on any database state.
-- =============================================================================

BEGIN;

-- ─── Global switch ───────────────────────────────────────────────────────────
-- One row, always id = 1. A single place to turn every AI call off without
-- deleting configuration — the thing you want at 2am when a provider starts
-- billing wrongly.

CREATE TABLE IF NOT EXISTS ai_settings (
  id                 INTEGER PRIMARY KEY DEFAULT 1,
  enabled            BOOLEAN     NOT NULL DEFAULT FALSE,
  /** Soft ceiling in USD. Spend past it is refused rather than billed. */
  monthly_budget_usd REAL,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_settings_singleton CHECK (id = 1)
);

INSERT INTO ai_settings (id, enabled) VALUES (1, FALSE)
ON CONFLICT (id) DO NOTHING;

-- ─── Providers ───────────────────────────────────────────────────────────────
-- Every provider worth using speaks the OpenAI chat-completions shape, so one
-- row describes NVIDIA NIM, DeepSeek, Groq or a local server equally.

CREATE TABLE IF NOT EXISTS ai_providers (
  id                 SERIAL PRIMARY KEY,
  label              TEXT        NOT NULL,
  /**
   * chat   — text in, text out (grading, conversation, feedback)
   * speech — audio in, transcript out
   *
   * Separate because they are separate purchases: a chat model cannot hear and
   * an ASR endpoint cannot reason. Exactly one of each may be active.
   */
  role               TEXT        NOT NULL DEFAULT 'chat',
  base_url           TEXT        NOT NULL,
  api_key_encrypted  TEXT,
  /** Last four characters, for telling two keys apart in the UI. */
  api_key_hint       TEXT,
  is_active          BOOLEAN     NOT NULL DEFAULT FALSE,
  created_by         INTEGER     REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_providers_role_check') THEN
    ALTER TABLE ai_providers
      ADD CONSTRAINT ai_providers_role_check CHECK (role IN ('chat', 'speech'));
  END IF;
END $$;

-- At most one active provider per role: "which provider is in use" must have a
-- single answer, or a request would pick one arbitrarily.
CREATE UNIQUE INDEX IF NOT EXISTS ai_providers_one_active_per_role
  ON ai_providers (role) WHERE is_active;

-- ─── Per-task model choice ───────────────────────────────────────────────────
-- Grading a one-line answer and running a ten-minute conversation do not want
-- the same model. Each task picks its own, so a cheap fast model can do the
-- high-volume work while something stronger handles placement.

CREATE TABLE IF NOT EXISTS ai_task_settings (
  id           SERIAL PRIMARY KEY,
  task         TEXT        NOT NULL UNIQUE,
  provider_id  INTEGER     REFERENCES ai_providers(id) ON DELETE SET NULL,
  model_id     TEXT,
  temperature  REAL        NOT NULL DEFAULT 0.2,
  max_tokens   INTEGER     NOT NULL DEFAULT 512,
  enabled      BOOLEAN     NOT NULL DEFAULT FALSE,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_task_settings_task_check') THEN
    ALTER TABLE ai_task_settings
      ADD CONSTRAINT ai_task_settings_task_check
      CHECK (task IN (
        'open_answer',
        'placement_analysis',
        'conversation',
        'feedback',
        'weakness_analysis',
        'transcription'
      ));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_task_settings_temperature_check') THEN
    ALTER TABLE ai_task_settings
      ADD CONSTRAINT ai_task_settings_temperature_check
      CHECK (temperature >= 0 AND temperature <= 2);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_task_settings_max_tokens_check') THEN
    ALTER TABLE ai_task_settings
      ADD CONSTRAINT ai_task_settings_max_tokens_check
      CHECK (max_tokens > 0 AND max_tokens <= 32768);
  END IF;
END $$;

-- Every task gets a row so the panel can list them without the UI having to
-- know the set. All start disabled: configuring a provider must not silently
-- switch on spending.
INSERT INTO ai_task_settings (task, temperature, max_tokens) VALUES
  ('open_answer',        0.1,  600),
  ('placement_analysis', 0.2,  900),
  ('conversation',       0.6,  700),
  ('feedback',           0.4,  400),
  ('weakness_analysis',  0.2,  700),
  ('transcription',      0.0, 1024)
ON CONFLICT (task) DO NOTHING;

-- ─── Per-plan, per-task limits ───────────────────────────────────────────────
-- Replaces the DAILY_LIMITS object in services/ai-quota.ts. The business split
-- is undecided, so pricing a new tier must be a row, not a deploy.

CREATE TABLE IF NOT EXISTS ai_plan_policies (
  id          SERIAL PRIMARY KEY,
  plan_code   TEXT        NOT NULL,
  task        TEXT        NOT NULL,
  /** Requests per rolling day. 0 = denied, -1 = unlimited. */
  daily_limit INTEGER     NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (plan_code, task)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_plan_policies_daily_limit_check') THEN
    ALTER TABLE ai_plan_policies
      ADD CONSTRAINT ai_plan_policies_daily_limit_check CHECK (daily_limit >= -1);
  END IF;
END $$;

-- Seeded to match the limits that were hardcoded before this migration, so
-- deploying it changes no behaviour: free gets nothing, general 5/day,
-- professional 20/day, spread across the tasks that existed in spirit.
INSERT INTO ai_plan_policies (plan_code, task, daily_limit)
SELECT p.plan_code, t.task, p.daily_limit
FROM (VALUES
  ('free',                 0),
  ('general_english',      5),
  ('professional_english', 20),
  ('admin',               -1)
) AS p(plan_code, daily_limit)
CROSS JOIN (VALUES
  ('open_answer'),
  ('placement_analysis'),
  ('conversation'),
  ('feedback'),
  ('weakness_analysis'),
  ('transcription')
) AS t(task)
ON CONFLICT (plan_code, task) DO NOTHING;

-- ─── Cost accounting ─────────────────────────────────────────────────────────
-- ai_usage_logs already records tokens and cost per call. Add the task column
-- so spend can be attributed to a task, not only to a user, and index it for
-- the month-to-date budget check.

ALTER TABLE ai_usage_logs
  ADD COLUMN IF NOT EXISTS task TEXT;

CREATE INDEX IF NOT EXISTS ai_usage_logs_created_at_idx
  ON ai_usage_logs (created_at);

COMMIT;

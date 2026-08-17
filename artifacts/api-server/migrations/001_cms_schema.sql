-- =============================================================================
-- Migration 001: CMS Schema
-- Idempotent — safe to run multiple times on any database state.
-- Apply with: psql $DATABASE_URL -f migrations/001_cms_schema.sql
-- =============================================================================

BEGIN;

-- ─── User roles (enum-as-check) ──────────────────────────────────────────────
-- The users table uses a text column for role; no enum to alter.
-- content_manager and content_reviewer are valid values alongside student/admin.
-- (No DDL change needed — text columns accept any value.)

-- ─── Lessons: new CMS columns ────────────────────────────────────────────────
ALTER TABLE lessons
  ADD COLUMN IF NOT EXISTS status            TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS content_version   INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS soft_deleted_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subtitle          TEXT,
  ADD COLUMN IF NOT EXISTS subtitle_ar       TEXT,
  ADD COLUMN IF NOT EXISTS tags              TEXT[],
  ADD COLUMN IF NOT EXISTS difficulty        TEXT DEFAULT 'intermediate',
  ADD COLUMN IF NOT EXISTS teacher_notes     TEXT,
  ADD COLUMN IF NOT EXISTS created_by        INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS objectives        TEXT[],
  ADD COLUMN IF NOT EXISTS objectives_ar     TEXT[];

-- Backfill: sync status from is_published for pre-CMS lessons
UPDATE lessons
  SET status = 'published'
  WHERE is_published = true AND (status IS NULL OR status = 'draft');

-- Performance indexes
CREATE INDEX IF NOT EXISTS lessons_status_idx ON lessons(status);
CREATE INDEX IF NOT EXISTS lessons_soft_deleted_idx ON lessons(soft_deleted_at) WHERE soft_deleted_at IS NULL;

-- ─── Content blocks: new CMS columns ─────────────────────────────────────────
ALTER TABLE content_blocks
  ADD COLUMN IF NOT EXISTS title             TEXT,
  ADD COLUMN IF NOT EXISTS title_ar          TEXT,
  ADD COLUMN IF NOT EXISTS instructions      TEXT,
  ADD COLUMN IF NOT EXISTS instructions_ar   TEXT,
  ADD COLUMN IF NOT EXISTS is_required       BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_active         BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS config            JSONB,
  ADD COLUMN IF NOT EXISTS estimated_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ;

-- ─── Exercises: new CMS columns ──────────────────────────────────────────────
ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS exercise_type     TEXT NOT NULL DEFAULT 'mcq',
  ADD COLUMN IF NOT EXISTS question          TEXT,
  ADD COLUMN IF NOT EXISTS question_ar       TEXT,
  ADD COLUMN IF NOT EXISTS correct_option_id TEXT,
  ADD COLUMN IF NOT EXISTS explanation       TEXT,
  ADD COLUMN IF NOT EXISTS explanation_ar    TEXT,
  ADD COLUMN IF NOT EXISTS prompt            TEXT,
  ADD COLUMN IF NOT EXISTS prompt_ar         TEXT,
  ADD COLUMN IF NOT EXISTS instructions_text TEXT,
  ADD COLUMN IF NOT EXISTS instructions_ar   TEXT,
  ADD COLUMN IF NOT EXISTS model_answer      TEXT,
  ADD COLUMN IF NOT EXISTS model_answer_ar   TEXT,
  ADD COLUMN IF NOT EXISTS expected_concepts TEXT,
  ADD COLUMN IF NOT EXISTS difficulty        TEXT,
  ADD COLUMN IF NOT EXISTS points            INTEGER DEFAULT 10,
  ADD COLUMN IF NOT EXISTS ordering          INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS audio_url         TEXT,
  ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ;

-- ─── Vocabulary: new CMS columns ─────────────────────────────────────────────
ALTER TABLE vocabulary
  ADD COLUMN IF NOT EXISTS part_of_speech       TEXT,
  ADD COLUMN IF NOT EXISTS definition           TEXT,
  ADD COLUMN IF NOT EXISTS difficulty           TEXT,
  ADD COLUMN IF NOT EXISTS tags                 TEXT[],
  ADD COLUMN IF NOT EXISTS deleted_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS example_sentence_ar  TEXT,
  ADD COLUMN IF NOT EXISTS pronunciation        TEXT,
  ADD COLUMN IF NOT EXISTS updated_at           TIMESTAMPTZ;

-- ─── New CMS tables ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS media_assets (
  id            SERIAL PRIMARY KEY,
  key           TEXT NOT NULL UNIQUE,
  original_name TEXT,
  mime_type     TEXT NOT NULL,
  size_bytes    INTEGER,
  language      TEXT,
  speaker       TEXT,
  duration_sec  REAL,
  transcript    TEXT,
  uploaded_by   INTEGER REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cms_audit_logs (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  action       TEXT NOT NULL,
  content_type TEXT NOT NULL,
  content_id   INTEGER,
  prev_status  TEXT,
  new_status   TEXT,
  meta         JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS cms_audit_logs_content_idx ON cms_audit_logs(content_type, content_id);
CREATE INDEX IF NOT EXISTS cms_audit_logs_user_idx    ON cms_audit_logs(user_id);
CREATE INDEX IF NOT EXISTS cms_audit_logs_created_idx ON cms_audit_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS lesson_reviews (
  id           SERIAL PRIMARY KEY,
  lesson_id    INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  reviewer_id  INTEGER NOT NULL REFERENCES users(id),
  decision     TEXT NOT NULL CHECK (decision IN ('approved','rejected')),
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS lesson_reviews_lesson_idx ON lesson_reviews(lesson_id);

CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature     TEXT NOT NULL,
  model_id    TEXT,
  provider    TEXT,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  cost_usd    REAL,
  succeeded   BOOLEAN NOT NULL DEFAULT true,
  request_id  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ai_usage_logs_user_id_idx ON ai_usage_logs(user_id, created_at);

COMMIT;

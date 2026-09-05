-- =============================================================================
-- Migration 005: Student media uploads
--
-- `media_assets` was a metadata registry for curriculum material uploaded out
-- of band. It now also holds student recordings, which need an owner (so one
-- student cannot play back another's audio), an upload lifecycle (so a key that
-- was presigned but never uploaded cannot be attached to an attempt), and a
-- link from the attempt back to the asset.
--
-- Idempotent — safe to run multiple times on any database state.
-- =============================================================================

BEGIN;

-- ─── media_assets grows an owner and a lifecycle ─────────────────────────────

ALTER TABLE media_assets
  ADD COLUMN IF NOT EXISTS owner_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS status        TEXT NOT NULL DEFAULT 'ready',
  ADD COLUMN IF NOT EXISTS purpose       TEXT NOT NULL DEFAULT 'curriculum',
  ADD COLUMN IF NOT EXISTS uploaded_at   TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'media_assets_status_check'
  ) THEN
    ALTER TABLE media_assets
      ADD CONSTRAINT media_assets_status_check
      CHECK (status IN ('pending', 'ready', 'failed'));
  END IF;
END $$;

-- Two objects must never share a key: the key is what a presigned URL signs, so
-- a duplicate would let one row's authorisation check stand in for another's.
CREATE UNIQUE INDEX IF NOT EXISTS media_assets_key_unique ON media_assets (key);

CREATE INDEX IF NOT EXISTS media_assets_owner_idx
  ON media_assets (owner_user_id, created_at);

-- Sweeping abandoned uploads (presigned, never confirmed) needs this.
CREATE INDEX IF NOT EXISTS media_assets_pending_idx
  ON media_assets (created_at)
  WHERE status = 'pending';

-- Existing rows are curriculum material uploaded by staff before this feature
-- existed. The column defaults already say so; this is here to be explicit that
-- nothing pre-existing is owned by a student.
UPDATE media_assets
   SET purpose = 'curriculum', status = 'ready'
 WHERE owner_user_id IS NULL
   AND (purpose IS NULL OR status IS NULL);

-- ─── Deleting a student must still be possible ───────────────────────────────
-- `created_by` predates this migration and was declared with no delete rule.
-- That was harmless while only staff created media rows; now that every student
-- recording sets it, the constraint would block deleting a student account
-- outright. `owner_user_id` cascades (the recording goes with them); the
-- authorship record simply becomes unknown.

DO $$
DECLARE
  fk_name TEXT;
BEGIN
  SELECT conname INTO fk_name
    FROM pg_constraint
   WHERE conrelid = 'media_assets'::regclass
     AND contype = 'f'
     AND conkey = ARRAY[(
       SELECT attnum FROM pg_attribute
        WHERE attrelid = 'media_assets'::regclass AND attname = 'created_by'
     )]::smallint[];

  IF fk_name IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = fk_name AND confdeltype = 'n'   -- 'n' = SET NULL
  ) THEN
    EXECUTE format('ALTER TABLE media_assets DROP CONSTRAINT %I', fk_name);
    fk_name := NULL;
  END IF;

  IF fk_name IS NULL THEN
    ALTER TABLE media_assets
      ADD CONSTRAINT media_assets_created_by_fk
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ─── Attempts point at an asset, not a free-text string ──────────────────────
-- `learning_activity_attempts.media_reference` and `quiz_responses.media_key`
-- are text columns holding whatever the client sent. Keep them for continuity,
-- but add a real foreign key so grading can resolve the audio reliably.

ALTER TABLE learning_activity_attempts
  ADD COLUMN IF NOT EXISTS media_asset_id INTEGER REFERENCES media_assets(id) ON DELETE SET NULL;

ALTER TABLE quiz_responses
  ADD COLUMN IF NOT EXISTS media_asset_id INTEGER REFERENCES media_assets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS laa_media_asset_idx
  ON learning_activity_attempts (media_asset_id)
  WHERE media_asset_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS quiz_responses_media_asset_idx
  ON quiz_responses (media_asset_id)
  WHERE media_asset_id IS NOT NULL;

-- ─── Reference audio on a content block ──────────────────────────────────────
-- `content_blocks.example_audio` and `audio_note` hold a URL or a note authored
-- by hand. A block that carries real uploaded audio should point at the asset.

ALTER TABLE content_blocks
  ADD COLUMN IF NOT EXISTS reference_media_id INTEGER REFERENCES media_assets(id) ON DELETE SET NULL;

COMMIT;

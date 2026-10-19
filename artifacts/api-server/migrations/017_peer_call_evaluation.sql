-- =============================================================================
-- Migration 017: Peer-call evaluation
--
-- WHY
-- ───
-- Voice practice is peer-to-peer: the audio never reaches the server, nothing
-- is recorded, and there is no file for anyone to listen to afterwards. That is
-- a deliberate privacy property of the feature, not an oversight — so
-- evaluating a call cannot be done by reaching for a recording that exists.
-- It has to be opted into, by BOTH speakers, before anything is kept.
--
-- Hence a separate table rather than more columns on `practice_sessions`:
--
--   * Consent is per PERSON, and a call has two. Two booleans on the session
--     row would work until the question "who agreed, and when" is asked by
--     someone deleting their data.
--   * The overwhelming majority of calls will never be evaluated. The cost
--     model makes this an explicit opt-in precisely so the ~$0.06 of ASR and
--     analysis stays an exception. A nullable transcript column on every
--     session row would be empty almost always.
--   * A session row is small and read on every poll — once per second, per
--     participant, for the length of a call. A transcript sitting in it would
--     be read thousands of times and used never.
--
-- WHAT IS NOT HERE
-- ────────────────
-- No automatic evaluation, no trigger, no default-on. A row appears here only
-- after a student asks for feedback, and audio is only accepted once the other
-- side has agreed too.
-- =============================================================================

-- ─── The AI task ─────────────────────────────────────────────────────────────
-- The allowed-task list lives in 006, which re-creates it on every migration
-- because `drizzle-kit push` drops CHECK constraints this schema does not
-- declare. `peer_call_analysis` is therefore added to the list THERE rather
-- than widened here: a second constraint under a different name would be ANDed
-- with 006's, and the narrow one would win.
--
-- Nothing to do in this file but rely on it. Kept as a comment so the next
-- person adding a task knows where the list is.

-- Off until an administrator points it at a provider: enabling a task with no
-- model would fail at the first call rather than refusing cleanly. `max_tokens`
-- is raised from the 512 default because one reply carries feedback for two
-- speakers in two languages plus a shared summary, and a truncated JSON object
-- is a parse failure rather than partial feedback.
INSERT INTO ai_task_settings (task, temperature, max_tokens, enabled)
VALUES ('peer_call_analysis', 0.2, 1600, false)
ON CONFLICT (task) DO NOTHING;

-- Its own task, not reusing `feedback`: a different model choice, a different
-- per-plan allowance, and it must be possible to switch peer-call analysis off
-- without taking pronunciation feedback down with it.
INSERT INTO ai_plan_policies (plan_code, task, daily_limit, monthly_limit, monthly_minutes)
VALUES
  -- Denied on free: this is the single most expensive unit in the product.
  ('free',                 'peer_call_analysis', 0,  0,  0),
  -- Minutes, not calls, are what cost money here — a 20-minute call is ~8x a
  -- 2-minute one for the same single request. 60 minutes a month is three
  -- full-length calls, which matches the "40% opt-in" assumption in the model.
  ('general_english',      'peer_call_analysis', 2,  6,  60),
  ('professional_english', 'peer_call_analysis', 3,  10, 120),
  ('admin',                'peer_call_analysis', -1, -1, -1)
ON CONFLICT DO NOTHING;

-- ─── Evaluations ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS practice_call_evaluations (
  id serial PRIMARY KEY,

  session_id integer NOT NULL
    REFERENCES practice_sessions (id) ON DELETE CASCADE,

  -- Who asked for the feedback. The other participant still has to agree.
  requested_by integer NOT NULL
    REFERENCES users (id) ON DELETE CASCADE,

  -- requested  — one side asked, the other has not answered
  -- consented  — both agreed; audio may be uploaded
  -- declined   — the other side said no. Terminal: no audio is ever accepted,
  --              and asking again means a new row, so a refusal is not erased
  --              by a second request.
  -- uploaded   — audio stored, waiting to be processed
  -- analyzing  — in flight
  -- completed  — feedback available
  -- failed     — gave up; `error` says why. The recording is deleted anyway.
  -- expired    — nobody answered the request in time
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','consented','declined','uploaded','analyzing','completed','failed','expired')),

  -- Consent, recorded per person with a timestamp, because "both agreed" is a
  -- claim that has to be defensible later. Null = not answered yet.
  requester_consented_at timestamptz,
  partner_consented_at   timestamptz,

  -- The uploaded recording. Set to NULL once analysis finishes: the transcript
  -- is what the feedback is built from, and keeping the audio afterwards would
  -- quietly turn an opt-in evaluation into a recording archive.
  media_asset_id integer REFERENCES media_assets (id) ON DELETE SET NULL,

  -- Diarized turns: [{ speaker, text, start, end }]. Speaker labels are the
  -- provider's own ("A"/"B"); which label is which student is a guess stored
  -- below rather than a fact asserted here.
  transcript jsonb,
  -- Which provider label was taken to be the requester, and how confident that
  -- was. Shown to students as an attribution that may be wrong, never as truth.
  requester_speaker_label text,
  speaker_mapping_confidence real,

  -- Per-student feedback. Each participant may only ever read their own.
  requester_feedback_ar text,
  requester_feedback    text,
  partner_feedback_ar   text,
  partner_feedback      text,

  -- Shared, non-attributed observations about the conversation itself.
  summary_ar text,
  summary    text,

  duration_seconds integer,
  error text,

  requested_at  timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz
);

-- One live evaluation per call. A declined or failed attempt does not block a
-- fresh request, so the predicate covers only the states still in play.
CREATE UNIQUE INDEX IF NOT EXISTS practice_call_evaluations_one_live
  ON practice_call_evaluations (session_id)
  WHERE status IN ('requested','consented','uploaded','analyzing');

CREATE INDEX IF NOT EXISTS practice_call_evaluations_session_idx
  ON practice_call_evaluations (session_id);

CREATE INDEX IF NOT EXISTS practice_call_evaluations_requested_by_idx
  ON practice_call_evaluations (requested_by, requested_at DESC);

-- The work queue: what still needs processing, oldest first.
CREATE INDEX IF NOT EXISTS practice_call_evaluations_pending_idx
  ON practice_call_evaluations (status, requested_at)
  WHERE status IN ('requested','consented','uploaded','analyzing');

COMMENT ON TABLE practice_call_evaluations IS
  'Opt-in evaluation of a peer practice call. A row exists only because a student asked; audio is accepted only after both participants consented, and is deleted once the transcript is produced.';

COMMENT ON COLUMN practice_call_evaluations.media_asset_id IS
  'The uploaded call recording. Cleared after analysis — the transcript is kept, the audio is not.';

COMMENT ON COLUMN practice_call_evaluations.requester_speaker_label IS
  'Which diarization label ("A"/"B") was taken to be the requester. A guess, surfaced as such.';

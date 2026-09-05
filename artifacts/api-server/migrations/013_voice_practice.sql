-- =============================================================================
-- Migration 013: Student-to-student voice practice
--
-- Spec section 11: separate from the AI tutor, students practise English with
-- other learners over voice. Match on level, goals, interests, professional
-- field and availability; the minimum feature set is matching, a voice call,
-- ending the call, blocking and reporting.
--
-- WHY THE SAFETY TABLES ARE NOT OPTIONAL
-- ───────────────────────────────────────
-- Every other feature in this product is a student alone with material. This
-- one puts two strangers on a live microphone together. `practice_blocks` and
-- `practice_reports` are in the same migration as matching because shipping
-- matching without them is not a smaller version of this feature, it is an
-- irresponsible one.
--
-- WHY SIGNALLING LIVES IN POSTGRES
-- ─────────────────────────────────
-- WebRTC needs the two browsers to swap an offer, an answer and a handful of
-- ICE candidates before audio can flow. There is no WebSocket in this codebase
-- and adding one buys a second auth path and a sticky-session problem; so the
-- browsers poll `practice_signals` over ordinary HTTP instead. It is roughly
-- twenty small rows per call, which Postgres does not notice, and it means a
-- Redis outage cannot lose an offer the other side is still waiting for.
--
-- The audio itself never touches this table, or the server at all — it is
-- peer-to-peer, and it is not recorded. See docs/features/voice-practice.md.
--
-- Idempotent — safe to run multiple times on any database state.
-- =============================================================================

BEGIN;

-- ─── Who wants to practise, and what they want to talk about ─────────────────

CREATE TABLE IF NOT EXISTS practice_profiles (
  id                 SERIAL PRIMARY KEY,
  user_id            INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  /**
   * Opting in is explicit and separate from being in the queue. `is_available`
   * means "I am willing to be matched with other learners at all"; a row in
   * practice_queue means "I am waiting for a partner right now". Conflating the
   * two would put a student into a live call because they once filled in a
   * form.
   */
  is_available       BOOLEAN     NOT NULL DEFAULT FALSE,

  /** Free-text tags. Matching lowercases and compares them; see practice-match.ts. */
  goals              TEXT[]      NOT NULL DEFAULT '{}',
  interests          TEXT[]      NOT NULL DEFAULT '{}',
  professional_field TEXT,

  /**
   * Availability as hours of the day in UTC (0–23), not a calendar. The
   * question this feature has to answer is "is this person likely to be around
   * now", and a set of hours answers it in one integer comparison. A richer
   * schedule can replace this later without touching the matching rules.
   */
  available_hours    INTEGER[]   NOT NULL DEFAULT '{}',

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS practice_profiles_user_id_unique
  ON practice_profiles (user_id);

-- ─── Waiting for a partner ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS practice_queue (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  /**
   * Refreshed by every poll. A student who closes the tab stops polling, and
   * their row stops being considered a few seconds later. This is why nothing
   * has to be deleted on the way out — and why nobody is ever offered a partner
   * who has already left.
   */
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS practice_queue_user_id_unique
  ON practice_queue (user_id);

CREATE INDEX IF NOT EXISTS practice_queue_last_seen_idx
  ON practice_queue (last_seen_at);

-- ─── One call ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS practice_sessions (
  id               SERIAL PRIMARY KEY,
  /** The one who was waiting first and whose browser makes the WebRTC offer. */
  requester_id     INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  partner_id       INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  /** waiting | active | ended | declined */
  status           TEXT        NOT NULL DEFAULT 'waiting',

  /** The score the matcher gave this pair, kept so a bad match can be explained. */
  match_score      INTEGER,

  matched_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  /** Set when the partner accepts, not when the pair is proposed. */
  started_at       TIMESTAMPTZ,
  ended_at         TIMESTAMPTZ,
  duration_seconds INTEGER,

  /** ended_by_user | blocked | timeout | not_answered | connection_failed | declined */
  end_reason       TEXT,
  ended_by         INTEGER     REFERENCES users(id) ON DELETE SET NULL,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'practice_sessions_status_check') THEN
    ALTER TABLE practice_sessions
      ADD CONSTRAINT practice_sessions_status_check
      CHECK (status IN ('waiting', 'active', 'ended', 'declined'));
  END IF;

  -- Nobody practises with themselves. Cheap to state here, impossible to get
  -- wrong later.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'practice_sessions_distinct_check') THEN
    ALTER TABLE practice_sessions
      ADD CONSTRAINT practice_sessions_distinct_check
      CHECK (requester_id <> partner_id);
  END IF;
END $$;

-- One live call per person, on each side of the pair.
--
-- These two indexes do not by themselves stop someone being the requester of
-- one call and the partner of another — that is checked in the service, which
-- looks at both columns. What they do stop is the race that matters: two
-- matchers picking the same waiting student a millisecond apart. The second
-- insert fails on the constraint rather than putting one student into two calls.
CREATE UNIQUE INDEX IF NOT EXISTS practice_sessions_one_live_per_requester
  ON practice_sessions (requester_id)
  WHERE status IN ('waiting', 'active');

CREATE UNIQUE INDEX IF NOT EXISTS practice_sessions_one_live_per_partner
  ON practice_sessions (partner_id)
  WHERE status IN ('waiting', 'active');

CREATE INDEX IF NOT EXISTS practice_sessions_requester_idx
  ON practice_sessions (requester_id, matched_at);

CREATE INDEX IF NOT EXISTS practice_sessions_partner_idx
  ON practice_sessions (partner_id, matched_at);

-- ─── Blocking ────────────────────────────────────────────────────────────────

/**
 * Append-only. A block is permanent unless the student reverses it, and it
 * works in both directions: the matching query excludes a pair when a row
 * exists either way round, so one row is enough. Inserting a second, mirrored
 * row would tell the blocked student something about the block, which is not
 * information they are owed.
 */
CREATE TABLE IF NOT EXISTS practice_blocks (
  id         SERIAL PRIMARY KEY,
  blocker_id INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  /** Optional: the call it happened in, for an administrator reading a report. */
  session_id INTEGER     REFERENCES practice_sessions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'practice_blocks_distinct_check') THEN
    ALTER TABLE practice_blocks
      ADD CONSTRAINT practice_blocks_distinct_check
      CHECK (blocker_id <> blocked_id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS practice_blocks_pair_unique
  ON practice_blocks (blocker_id, blocked_id);

-- The matching query asks "is this pair blocked, either way round", so both
-- directions need an index.
CREATE INDEX IF NOT EXISTS practice_blocks_blocked_idx
  ON practice_blocks (blocked_id);

-- ─── Reporting ───────────────────────────────────────────────────────────────

/**
 * Append-only, for a person to review. Nothing here is acted on automatically:
 * an account is not suspended because two people reported it, because two
 * people can be wrong and a suspended student cannot appeal to a script.
 */
CREATE TABLE IF NOT EXISTS practice_reports (
  id          SERIAL PRIMARY KEY,
  reporter_id INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_id INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id  INTEGER     REFERENCES practice_sessions(id) ON DELETE SET NULL,

  /** harassment | inappropriate | spam | language | other */
  reason      TEXT        NOT NULL,
  detail      TEXT,

  /** open | reviewed | actioned */
  status      TEXT        NOT NULL DEFAULT 'open',
  reviewed_by INTEGER     REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'practice_reports_status_check') THEN
    ALTER TABLE practice_reports
      ADD CONSTRAINT practice_reports_status_check
      CHECK (status IN ('open', 'reviewed', 'actioned'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'practice_reports_reason_check') THEN
    ALTER TABLE practice_reports
      ADD CONSTRAINT practice_reports_reason_check
      CHECK (reason IN ('harassment', 'inappropriate', 'spam', 'language', 'other'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'practice_reports_distinct_check') THEN
    ALTER TABLE practice_reports
      ADD CONSTRAINT practice_reports_distinct_check
      CHECK (reporter_id <> reported_id);
  END IF;
END $$;

-- The administrator queue reads open reports oldest first.
CREATE INDEX IF NOT EXISTS practice_reports_status_idx
  ON practice_reports (status, created_at);

CREATE INDEX IF NOT EXISTS practice_reports_reported_idx
  ON practice_reports (reported_id, created_at);

-- ─── The signalling mailbox ──────────────────────────────────────────────────

/**
 * One row per WebRTC signalling message, read by the recipient's poll.
 *
 * `id` is the cursor: a client asks for everything after the highest id it has
 * seen, which is why nothing needs deleting to stay correct and why a client
 * that misses a poll catches up on the next one. Rows are dead weight once the
 * call ends; they are small, and they are cleared with the call in
 * practice.ts rather than by a background job.
 */
CREATE TABLE IF NOT EXISTS practice_signals (
  id           SERIAL PRIMARY KEY,
  session_id   INTEGER     NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
  from_user_id INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id   INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  /** offer | answer | ice | bye */
  kind         TEXT        NOT NULL,
  payload      JSONB       NOT NULL,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'practice_signals_kind_check') THEN
    ALTER TABLE practice_signals
      ADD CONSTRAINT practice_signals_kind_check
      CHECK (kind IN ('offer', 'answer', 'ice', 'bye'));
  END IF;
END $$;

-- The only query this table serves: "anything for me in this call after id N".
CREATE INDEX IF NOT EXISTS practice_signals_inbox_idx
  ON practice_signals (session_id, to_user_id, id);

COMMIT;

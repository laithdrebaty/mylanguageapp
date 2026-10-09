-- =============================================================================
-- Migration 014: Referral source on signup
--
-- "How did you hear about the app?" is asked at registration and reported on in
-- the admin dashboard, so acquisition can be attributed to a channel.
--
-- Nullable rather than NOT NULL: every account that already exists predates the
-- question and has no honest answer. The requirement is enforced in the signup
-- form, which is the only place the answer can actually be collected.
-- =============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_source text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_detail text;

-- The admin report groups by this column over the whole table.
CREATE INDEX IF NOT EXISTS users_referral_source_idx ON users (referral_source);

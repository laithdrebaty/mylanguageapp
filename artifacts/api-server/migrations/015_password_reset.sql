-- =============================================================================
-- Migration 015: Password reset tokens
--
-- Without this a forgotten password is permanent account loss: registration is
-- the only way in, and nothing promotes or recovers an account.
--
-- The token itself is never stored. Only a SHA-256 hash is, so a leaked
-- database does not hand out working reset links — the same reasoning that
-- keeps passwords hashed.
-- =============================================================================

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          serial PRIMARY KEY,
  user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- SHA-256 of the token that was emailed. Unique so a hash can be looked up
  -- directly rather than scanned for.
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  -- Set the moment the token is spent. A reset link works exactly once.
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Requesting a reset invalidates the user's outstanding tokens, and the
-- cleanup sweep deletes by expiry; both query these columns.
CREATE INDEX IF NOT EXISTS password_reset_user_idx ON password_reset_tokens (user_id);
CREATE INDEX IF NOT EXISTS password_reset_expiry_idx ON password_reset_tokens (expires_at);

-- =============================================================================
-- Migration 018: Exact speaker attribution for peer-call evaluation
--
-- WHY
-- ───
-- Diarization can tell two voices apart. It cannot tell you WHICH VOICE IS
-- WHICH PERSON — that is not information in the audio.
--
-- The first version guessed, from "whoever placed the call probably speaks
-- first". That is barely better than a coin toss, so every student was shown a
-- warning that their feedback might actually be about the other person. A
-- learner cannot act on feedback that might not be theirs.
--
-- The browser already knows the answer for free: it knows which audio track is
-- its own microphone. The client now records the two sides into separate stereo
-- channels (own mic left, peer right) and the transcriber labels turns by
-- channel, so attribution becomes a fact rather than an inference.
--
-- This column records whether a given recording was made that way. It matters
-- because the mono fallback still exists — older browsers, or a failure to
-- build the stereo graph — and in that case the old guess is all there is, and
-- the uncertainty warning must still be shown. Without this flag the server
-- could not tell a certain attribution from a guessed one.
-- =============================================================================

ALTER TABLE practice_call_evaluations
  ADD COLUMN IF NOT EXISTS channel_separated boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN practice_call_evaluations.channel_separated IS
  'True when the uploaded recording has the uploader on the left channel and the peer on the right, making speaker attribution exact rather than guessed.';

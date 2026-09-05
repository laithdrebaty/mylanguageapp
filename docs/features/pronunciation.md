# Feature: Pronunciation and fluency assessment

Spec section 4A — the student reads a prepared passage aloud and a score of 75% or better passes. The recordings that step 1 started storing now produce a mark.

## What it does

A student records themselves reading a passage. They get two scores, the words they got wrong, and a sentence of Arabic advice.

## How it works

Four steps, and only the last one involves a language model:

1. **Transcribe**, asking for word-level timestamps.
2. **Align** the transcript against the passage → pronunciation score.
3. **Compute** fluency from the timings → fluency score.
4. **Write** one sentence of Arabic advice from those numbers.

**The scores are measurements, not opinions.** A model asked "score this pronunciation" gives a different number each time, cannot say which word was wrong, and cannot be defended to a student who appeals — and this number gates progression. But the passage is *ours*, so the transcript can be aligned against it with Levenshtein over word tokens and the errors counted. Same recording, same score, every time, with the specific words named.

**Pronunciation** is one minus the word error rate. Hesitation sounds are stripped before aligning — "um" between two correct words is nerves, and counting it as an error would mean a nervous student scores worse than a careless one. Over-reading is capped: read the passage correctly and then keep talking and you lose a little, not everything, because ASR itself routinely hallucinates a trailing word or two.

**Fluency** comes from the standard L2 fluency measures, all arithmetic over the timings: speech rate, articulation rate, phonation ratio, mean length of run (the strongest single predictor in the literature), pause count and length, and fillers per hundred words. Scored against the student's *level* — holding an A1 learner to a C1 speech rate would mark every beginner disfluent. Speaking faster than the target is not penalised, because telling confident delivery from rushing needs prosody this pipeline does not have.

**The two combine 70/30** for a read-aloud task: the task was to say these words. Open speaking has no passage, so it is fluency alone.

**The model only writes the sentence.** It is given the measurements and told explicitly not to invent a score, not to contradict the numbers, and not to ask for audio it cannot hear. It is also told to recommend material the student already has — re-read the passage with the recording, practise these words — and not to suggest more conversation practice (spec sections 8 and 9). If the feedback task is off or fails, the student still gets their marks; they just do not get the sentence.

**Where it runs.** In the background, for both lessons and quizzes: this downloads audio and waits on a recogniser, which is seconds. The lesson block polls for the verdict with backoff and shows it when it lands, so a student who records does not simply never find out.

## What this does not measure

**It is not phoneme-level assessment.** A word mispronounced badly enough that the recogniser hears a different word is caught; a subtle vowel error the recogniser resolves correctly is not. For a read-aloud exercise this is the right signal — did they say the words on the page — but it is not what a dedicated pronunciation-assessment API (Azure Speech, SpeechAce) measures. If certified phoneme scoring is ever needed for evaluation tests, it belongs in a third provider role beside `chat` and `speech`.

## Where the code lives

- `artifacts/api-server/src/services/scoring/alignment.ts` — normalisation, Levenshtein alignment, pronunciation score
- `artifacts/api-server/src/services/scoring/fluency.ts` — the metrics, level expectations, fluency score
- `artifacts/api-server/src/services/ai-providers/openai-audio.ts` — the transcription client
- `artifacts/api-server/src/services/graders/pronunciation.ts` — orchestration and the feedback call
- `artifacts/ascension/src/lib/speech-api.ts` + the verdict card in `pages/lesson.tsx`
- `artifacts/api-server/migrations/008_speech_assessment.sql`
- Tests: `alignment.test.ts` (24), `fluency.test.ts` (25), `pronunciation.test.ts` (5)

## Setting it up

The `speech` provider role expects an **OpenAI-compatible `/audio/transcriptions`** endpoint — Groq's Whisper is the cheap one (roughly $0.04 per hour of audio). Add it at `/admin/ai` as a provider with role `speech`, point the `transcription` task at it, and enable. The `feedback` task uses your normal chat provider.

**NVIDIA Riva ASR does not speak this shape.** If that is the endpoint you want, it needs its own client; the configuration slot is ready for it.

## Gaps to be aware of

1. **Transcription cost is recorded as zero tokens.** ASR is billed per minute of audio, not per token, and there is no per-minute price field — so speech usage shows in the log but contributes nothing to the monthly budget. Add a `price_per_audio_minute` to `ai_providers` when this matters.
2. **The reference-reading flag has a CMS control for quizzes only.** The quiz editor has the switch and the passage field; the lesson block editor does not, so lesson pronunciation blocks still need the API. Migration 008 backfilled existing pronunciation blocks that have text.
3. **The quiz runner does not poll.** The lesson block shows its verdict; a quiz shows the score changing only on reload. The attempt endpoint already returns everything needed.
4. **Level expectations are unvalidated.** The speech-rate and run-length targets per CEFR band are drawn from published norms but have not been checked against real students on this curriculum. They are one table in `fluency.ts` precisely so they can be tuned once there is data.
5. **A teacher can mark an unassessed recording but not override an assessed one.** `/cms/grading` handles anything left pending, with playback and the transcript; a score the AI already recorded cannot be changed.
6. **Contraction handling is a fixed list.** `EQUIVALENTS` covers the common cases; an unusual one the recogniser expands differently from the passage will read as an error.

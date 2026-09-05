# Feature: Open-answer grading

Spec section 4C — the AI reads a written answer and judges relevance, grammar, vocabulary, clarity and level-appropriateness, then gives concise, useful feedback. The first place in this codebase where a model actually decides something a student sees.

## What it does

A student writes an answer, in a lesson or in a quiz, and gets a mark and two sentences of Arabic feedback naming the single most useful thing to fix.

## How it works

**The model judges; the code marks.** The model returns five sub-scores from 0–100. The overall mark is computed in `computeOverallScore` — relevance 35%, grammar 20%, vocabulary/clarity/level 15% each — not asked of the model. Relevance dominates because an eloquent answer to a different question is still the wrong answer. Keeping the weighting in code means the same rubric produces the same mark whichever model is configured, and changing it is a reviewable diff rather than a prompt edit nobody notices.

The sub-scores are stored, not just the total. "Weak grammar across six lessons" is a finding the weakness engine can act on; "scored 62" is not.

**A failure to grade is never a bad mark.** Every way this can go wrong — AI switched off, no provider, over the daily quota, Redis down, provider unreachable, model returns something malformed — leaves the answer `pending` for a teacher. Being unable to reach a model must not cost a student marks. The only zero the code awards by itself is for an empty answer, which needs no model.

**The student's answer is data, not instructions.** A learner writing in a second language produces text that can look like a command, and some will try it deliberately. The answer is fenced between `<<<ANSWER>>>` and `<<<END>>>`, those markers are stripped from the answer itself so it cannot close its own fence, and the system prompt says plainly that nothing inside is an instruction.

**Where the latency lands decides where the work runs:**

| Path | How | Why |
|---|---|---|
| Lesson open-ended block | Inline, awaited | Feedback *is* the activity. A student who has moved on will not come back for it. One call, and failure is safe. |
| Quiz / evaluation submit | Background job | An exam with three written answers is three calls. A submit must not hang; the attempt already reports what is outstanding. |

The background job re-finalises the attempt when verdicts land — recomputing the score from stored responses rather than adjusting a running total, so it converges however many times it runs — and then applies promotion. That is why `applyEvaluationOutcome` was built to be safe to call repeatedly: a level evaluation containing a written answer is promoted *after* grading completes, not at submit.

**Cost is real now.** `ai_providers` carries input and output prices per million tokens, entered in the panel. A call records `prompt_tokens`, `completion_tokens` and the computed `cost_usd`, so the monthly ceiling in `ai_settings` can actually trigger. A provider with no prices records a null cost rather than a guess — a fabricated cost is worse than none, because the budget acts on it. The panel marks such providers "no prices".

## Where the code lives

- `artifacts/api-server/src/services/graders/open-answer.ts` — prompt, call, validation, scoring
- `artifacts/api-server/src/services/grading-runner.ts` — which answers need grading, recording verdicts, re-finalising
- `artifacts/api-server/src/services/jobs.ts` + `job-handlers.ts` — the background queue, which now actually dispatches
- Wired at `routes/lessons.ts` (inline) and `routes/quizzes.ts` (enqueue)
- `artifacts/api-server/migrations/007_open_answer_grading.sql`
- Tests: `open-answer.test.ts` (16 — scoring weights, clamping, prompt-injection neutralisation)

## Gaps to be aware of

1. **This grader handles text only** — `writing` and `image_describe` in quizzes, `open_ended` in lessons. Spoken answers are scored by a separate pipeline; see [pronunciation.md](pronunciation.md).
2. **Jobs are still in-process and unqueued**, so one is lost if the API restarts between submit and run — but that is no longer permanent: a sweeper finds stranded work and retries it, and what it gives up on goes to a marking queue. See [grading-recovery.md](grading-recovery.md). `JOB_QUEUE=bullmq` remains the intended path for durable queueing.
3. ~~No teacher marking screen.~~ **Resolved.** `/cms/grading` shows the answer, the recording and the transcript, and marking re-finalises the attempt — including releasing a held promotion.
4. **`image_describe` is graded blind.** The grader is text-only, so it judges the description against the teacher's key points without seeing the image. That is the intended design at this budget, but the rubric must be authored to suit it.
5. **No re-grade endpoint.** If a model was misconfigured for an hour, the answers it marked keep those marks; nothing re-runs them.
6. **Redis is now required for any AI feature.** The quota counter fails closed by design, so no Redis means no grading. It is in `docker-compose.yml` as of this change; a deployment without it will silently grade nothing.

# Feature: Level evaluation & promotion

Spec sections 10 ("Level Evaluation Tests") and 2 (administrator override of placement).

## What it does

A student finishes the lessons of a sub-level, sits that level's evaluation test, and passing it moves them to the next level — A1.1 lessons → A1.1 evaluation → A1.2. Failing sends them back to the lessons they did worst on, optionally after a cooldown.

Before this existed, `student_profiles.current_level_id` was written once by the placement test and never again. There was no way for a student to advance, at all.

## How it works

**An evaluation is a quiz.** `quizzes.kind` is either `practice` (the default, no effect on anyone's level) or `level_evaluation`, in which case the quiz must be attached to a level. Attempts, responses, grading and the student runner are all the ordinary quiz machinery — there is no second implementation to keep correct.

**The gate.** `GET /levels/:levelId/evaluation` reports the evaluation and whether the student may sit it. It is refused, with a code the UI branches on, when:

| Code | Meaning |
|---|---|
| `NO_EVALUATION` | No published evaluation authored for this level yet |
| `NOT_PLACED` | The student has not taken the placement test |
| `NOT_CURRENT_LEVEL` | The evaluation belongs to a level the student is not on |
| `LESSONS_INCOMPLETE` | Less of the level is finished than `levels.evaluation_unlock_percent` requires (default 100%) |
| `COOLDOWN` | A previous attempt failed and `quizzes.cooldown_hours` has not elapsed |
| `ATTEMPTS_EXHAUSTED` | `quizzes.max_attempts` used up |

The same check runs again server-side when the attempt is started, so the gate cannot be walked around by calling the quiz endpoint directly.

**Promotion.** On submit, if the attempt is a passed level evaluation on the student's current level, they move to the next level by `order` within their curriculum. Passing the last level reports `curriculumCompleted` instead of inventing a level to promote to.

Promotion is withheld while `passed` is null — which is what happens when any block is still waiting on an AI or teacher verdict. A student is never moved up on a partial score.

**Audit.** `student_profiles.current_level_id` is written by `services/progression.ts#setStudentLevel` and nowhere else, and every write appends a row to `level_progressions` in the same transaction (`placement` | `evaluation` | `admin_override`). Placement was refactored to go through it too, and existing students were backfilled by migration 004.

**Idempotency.** A partial unique index on `level_progressions.quiz_attempt_id` means one attempt can produce at most one promotion. A double submit, a retried job, or a late AI verdict landing on an already-graded attempt cannot walk a student up two levels.

## Where the code lives

- `artifacts/api-server/src/services/progression.ts` — all of the logic. `decideEligibility` and `rankRemediation` are pure and unit-tested; everything else is the IO around them.
- `artifacts/api-server/src/routes/progression.ts` — `GET /levels/:levelId/evaluation`, `GET /progression`
- `artifacts/api-server/src/routes/quizzes.ts` — the gate on attempt start, and the promotion hook on submit
- `artifacts/api-server/src/routes/admin.ts` — `POST /admin/students/:userId/level` (override, note required), `GET /admin/students/:userId/progression`
- `artifacts/api-server/src/services/progression.test.ts` — 27 tests over the eligibility and remediation rules
- `artifacts/ascension/src/pages/quiz.tsx` — the student quiz runner
- `artifacts/ascension/src/components/level-evaluation-card.tsx` — the gate on the level page
- `artifacts/api-server/migrations/004_level_evaluation.sql`

## No AI is involved

Eligibility, scoring, pass/fail, promotion and the remediation ranking are arithmetic over data the server already holds — spec section 6: if normal application logic can do the task accurately, do not use AI. When AI arrives, its job on an evaluation is to write feedback *about* the result and to grade open-ended blocks, never to decide whether the student advances.

Remediation likewise recommends only lessons that already exist in the student's level, weakest score first (spec section 9: AI may not create a new learning path).

## Gaps to be aware of

1. **Speaking blocks can now be answered but not graded.** Media upload landed (see [media-uploads.md](media-uploads.md)), so `speaking_prompt` records and uploads in the runner and the response is attached to the attempt. Nothing scores it yet, so the attempt sits in `grading` with `passed = null` and no promotion follows — evaluations meant to gate progression should still be authored from auto-gradable blocks (`mcq`, `multi_select`, `spelling`) until the speaking assessment pipeline exists.
2. **Written and spoken blocks are both graded now.** A `writing` block is graded by AI and a `speaking_prompt` block is transcribed and scored, after which the attempt is re-finalised — including promotion — when the verdicts land (see [open-answer-grading.md](open-answer-grading.md) and [pronunciation.md](pronunciation.md)). An evaluation left in `grading` because AI was unavailable is retried automatically and then surfaced at `/cms/grading` for a teacher to mark, which releases the held promotion — see [grading-recovery.md](grading-recovery.md).
3. **Quiz time limits are enforced only in the browser.** The runner counts down and auto-submits, but the server does not reject a late submission — the pre-existing gap noted in [quizzes.md](quizzes.md), now more consequential because it applies to an exam that decides promotion.
4. ~~No CMS screen for authoring an evaluation.~~ **Resolved.** `/cms/quizzes` covers kind, level, passing score, cooldown, attempts and the question timeline with answer keys; the levels page covers the unlock percentage. See [cms-authoring.md](cms-authoring.md).
5. **`quiz-api.ts` is hand-written.** The quiz endpoints are not in `openapi.yaml`, so the runner uses a typed fetch wrapper in the style of `cms-api.ts` instead of generated hooks. Adding those endpoints to the spec and deleting that file is worth doing when someone next touches the quiz API.

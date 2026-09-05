# Feature: Multi-skill placement

Spec section 2 — assess across skills, determine a starting level, identify strengths, weaknesses and where to put effort, and let an administrator review or override the result.

Replaces the original placement test, which is described in [placement-test.md](placement-test.md).

## What changed

The old test was ten untagged multiple-choice questions producing one percentage, mapped to a level by position in the list. It could not say anything about *which* skills were weak, because it never knew which skill any question was testing.

Now every question carries two labels — the skill it tests and roughly the level it was written for — and both do real work:

- **The skill tag** is what makes a per-skill breakdown possible at all. Everything downstream (strengths, weaknesses, the analysis, the administrator's review) exists only because the evidence is labelled.
- **The difficulty** is what separates a strong beginner from a weak intermediate. Both score about half on an untagged test; only *which* questions they got right tells them apart.

## How the level is decided

**Arithmetic, with the AI given a bounded say.**

The spec says the AI determines the level. Taken literally that means a model's unaudited guess decides which lessons a student can reach — a number that changes between runs, cannot be explained to the student, and cannot be defended when they ask why they were placed lower than a friend.

So the level is computed from the answers, weighted by difficulty, and the model may move it **by at most one sub-level** with a stated reason that is recorded. `applyLevelAdjustment` enforces that regardless of what comes back. In testing, a model asked to review an A2.2 result suggested C2.2; the bound refused it and A2.2 stood.

Both the computed and the assigned level are stored, so an adjustment is always visible rather than silently baked in.

**The top of the scale is deliberately unreachable.** A fifteen-question test is not evidence that someone belongs in C2, and placing them there strands them in material they cannot follow with no way back but an administrator. Under-placing is recoverable — they pass the level evaluation quickly and move up. Over-placing is not.

**A written question is graded by the same grader lessons and quizzes use**, inline, because placement happens once and the student is waiting on a result they cannot proceed without. It is never fatal: if AI is unavailable the writing simply goes unscored and the rest of the test stands.

## Administrator review

`/admin/students` now expands each student into a review panel showing the per-skill breakdown, the computed and assigned levels with any adjustment reason, the AI's analysis, the written answer, and the full level history. An administrator asked to confirm a level cannot judge "58%" but can judge "reading 80, grammar 35".

Overriding requires a note. An unexplained level change is indistinguishable from a mistake six months later, and this is the one control that can move a student without them having earned it.

## Where the code lives

- `artifacts/api-server/src/services/scoring/placement.ts` — difficulty weighting, level bands, strengths and weaknesses, the adjustment bound
- `artifacts/api-server/src/services/placement-analysis.ts` — the AI reading of the result
- `artifacts/api-server/src/routes/placement.ts` — the test and its submission
- `artifacts/api-server/src/routes/admin.ts` — `GET /admin/students/:id/placement`, and the override that has existed since level evaluation was built
- `artifacts/ascension/src/components/placement-review.tsx`
- `artifacts/api-server/migrations/012_placement_v2.sql`
- Tests: `placement.test.ts` (23)

## What is not assessed yet

Section 2 lists eight skills. Five are covered: reading, vocabulary, grammar, comprehension and writing.

- **Listening** needs audio on placement questions. The column (`media_id`) and the skill tag both exist; no questions use them, because there is no authored audio and no CMS screen for placement questions.
- **Speaking and pronunciation** need the recorder in the placement flow. Every piece exists — upload, transcription, alignment, scoring — but a new student has no level yet, and the fluency thresholds are level-relative, so it would have to be scored against a default. It is a real gap rather than a hard problem.

## Gaps to be aware of

1. **No CMS screen for placement questions.** They come from the seed script; adding or editing one means SQL. This is the main thing stopping the curriculum team from covering the remaining skills themselves.
2. **Listening, speaking and pronunciation are untested**, as above.
3. **One fixed test for everyone.** There is no adaptive branching, so a beginner answers C1 questions and an advanced student answers A1 ones. Adaptive selection would place people more precisely from fewer questions.
4. **Placement cannot be retaken** — the 409 on a second attempt predates this work. An administrator can move the level, but there is no "sit it again".
5. **The written question is graded against a fixed passing score of 60**, not against the level the rest of the test suggests.
6. **The AI's adjustment is applied silently to the student.** It is recorded and visible to an administrator, but the student is not told their level was adjusted from the computed one.

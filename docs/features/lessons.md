# Feature: Lessons & Levels (the core learning flow)

## What it does
This is the heart of the app: the curriculum structure (levels → lessons → content blocks → exercises), showing students what's locked/available/done, serving lesson content, accepting their answers, grading them, and unlocking the next lesson or level.

## Where the code lives
- `artifacts/api-server/src/routes/lessons.ts` — list lessons, get one lesson's content, start a lesson, submit an answer for a block, complete a lesson, check progress
- `artifacts/api-server/src/routes/levels.ts` — list levels with per-level progress, get one level's lessons
- `artifacts/api-server/src/services/learning.ts` — the shared logic: what state a lesson is in (locked/available/in progress/completed), server-side scoring, level advancement
- `lib/db/src/schema/levels.ts` — `levels`, `lessons`, `content_blocks`, `exercises`, `exercise_options`, `vocabulary`
- `artifacts/ascension/src/pages/lesson.tsx`, `level.tsx`, `learn.tsx` — the student-facing screens

## How it works
1. A lesson is made of ordered "content blocks" (reading, vocabulary list, MCQ question, speaking prompt, etc.). Each block can be required or optional.
2. Multiple-choice answers are graded on the server by comparing the submitted option against the stored correct answer — the correct answer is never sent to the browser ahead of time, and a client can't just claim "I got it right."
3. Open-ended and speaking/pronunciation answers are saved and marked as submitted, but honestly labeled as not automatically graded (matches the plan — no AI scoring yet).
4. Every answer submission is tagged with a `clientSubmissionId`; resubmitting the same one just returns the original result instead of double-counting it — this protects against double-taps and flaky connections re-sending the same request.
5. Finishing a lesson requires every *required* block to be completed; the server checks this itself rather than trusting the app to enforce it. The lesson score is calculated from graded (MCQ) attempts, XP is awarded once, and the next lesson is unlocked only if the student passed.
6. When every lesson in the current level is done, the student is automatically moved to the next level.

## Quality check

**Solid — this is the best-built part of the app:**
- Scoring, grading, and unlock rules all live on the server. The frontend cannot forge a score, skip a locked lesson, or claim a required activity is done when it isn't.
- Resubmission is idempotent (via `clientSubmissionId`), which avoids duplicate attempts from double-clicks or network retries — a detail a lot of apps get wrong.
- Curriculum access is checked on every route (a student can't request a lesson from a curriculum they're not enrolled in).
- N+1 database query patterns (querying once per row in a loop) were already found and fixed here — the code batches queries with `inArray` instead of looping. This is exactly the kind of thing that causes a fast app to slow to a crawl once you have real traffic, and it's been handled.
- Lesson content is cached (5 minutes), so the same lesson doesn't hit the database on every single view.

**Issues found:**
1. **`GET /levels` reads every published lesson in the whole database, not just the current curriculum's.** It should filter by the curriculum's level IDs before fetching (the way `lessons.ts` already does it correctly), but instead it loads *all* lessons and then filters them in JavaScript. Today, with one curriculum and roughly 60 lessons, this is invisible. Once English + German (and more curricula) are both live, every visit to the levels page will scan the entire lessons table instead of just the relevant slice — this is the exact kind of full-table-scan bug already caught and fixed elsewhere in this codebase (see `docs/arch-foundation.md`), just not here yet.
2. **Small race condition on double-completing a lesson.** If a student's app sends the "complete lesson" request twice in quick succession (e.g. a flaky retry), both requests can read the lesson as "not yet passed" before either one saves, which could award XP twice or slightly miscount attempts. Low likelihood, and not a security hole (nobody can grant themselves a lesson they didn't do), but worth a follow-up since it involves XP/currency-like values.
3. **Level advancement re-fetches and re-scans every lesson in the level on every single lesson completion**, to check whether the whole level is now done. Fine at today's scale (a handful of lessons per level), but if levels grow large this recalculation on every lesson-complete could be more expensive than necessary — a cheap optimization for later, not urgent now.

## Suggested next steps
- Fix `GET /levels` to filter lessons by the resolved curriculum's level IDs (same pattern already used in `lessons.ts`) before adding German or more curricula.
- Consider wrapping the "complete lesson" read-then-write in a transaction to close the double-submit race.

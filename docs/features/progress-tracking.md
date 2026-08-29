# Feature: Progress Tracking & Dashboard

## What it does
Everything that answers "where is this student at?" — the dashboard (current level, XP, what's next, recent activity), a review screen showing recently completed lessons and weak spots to revisit, and the underlying tables that record every attempt a student makes.

## Where the code lives
- `artifacts/api-server/src/routes/dashboard.ts` — the main dashboard endpoint
- `artifacts/api-server/src/routes/review.ts` — recently completed lessons, and lessons the student scored low on
- `artifacts/api-server/src/routes/exercises.ts` — an older, separate way of submitting an MCQ answer (see below)
- `lib/db/src/schema/progress.ts` — `lesson_progress`, `lesson_block_progress`, `learning_activity_attempts`, and the legacy `exercise_attempts`

## How it works
1. The dashboard pulls the student's profile, current level, current curriculum, and active subscription in parallel, and returns a safe "no placement yet" version if they haven't taken the placement test.
2. "Recent activity" and "weak areas" batch-fetch lessons and levels in one query instead of looping (this was a known bug elsewhere in the app — already fixed here).
3. Every meaningful action (starting a lesson, submitting an answer, completing a lesson) writes to one of the progress tables, so a student's history survives across sessions and devices.

## Quality check

**Solid:**
- The "no placement completed yet" case is handled explicitly and safely, rather than crashing or returning broken data — a lot of dashboards forget this state.
- The dashboard's queries run in parallel where they can, and the "recent activity"/"weak areas" endpoints batch their lookups instead of querying per-row — good for performance at 10k users.
- Progress data (scores, XP, completions) is exactly the kind of thing that's never cached (per `docs/redis-arch.md`) — correct call, since caching this would show stale numbers.

**Issues found:**
1. **The streak feature doesn't actually work.** `streakDays` is set to 0 when someone registers and is only ever *read* afterward — nothing anywhere increases it, checks daily logins, or resets it after a missed day. Right now every student will see "0-day streak" forever, even if they use the app every day. If this is meant to be a real feature (streaks are a big motivator in language apps), it needs actual daily-activity logic; if it's not needed yet, it's worth hiding the streak number in the UI rather than showing a number that's always wrong.
2. **"Weak areas" uses a hardcoded 75% cutoff instead of each lesson's own passing score.** A lesson can have its own `passingScore` (some might be 60%, some 90%), but `review/weak-areas` always compares to a fixed 75. A student could pass a lesson with a lower threshold and still see it listed as a "weak area," which is confusing and just plain wrong for that lesson.
3. **There's a second, older way to submit an MCQ answer** (`POST /exercises/:id/submit`) that still exists, is still correctly access-checked and server-graded, but doesn't feed into lesson progress, scoring, or XP at all — it only logs the attempt to a separate table nobody else reads. It isn't called from the app today (confirmed — no page uses it), so it's not causing problems now, but it's a trap for later: if someone wires it up thinking it behaves like the main submit endpoint, lessons won't complete correctly. Worth deleting it, or clearly marking it as unused/deprecated so nobody reaches for it by mistake.

## Suggested next steps
- Decide if streaks are a launch feature; if yes, add the logic (e.g. a daily check on login/activity), if no, don't show a permanently-zero streak to users.
- Fix `review/weak-areas` to compare each lesson's score against its own `passingScore`.
- Remove or clearly deprecate the unused `/exercises/:id/submit` endpoint.

# Feature: Placement Test

## What it does
A short multiple-choice test new students take right after signing up. Based on how many questions they get right, the system assigns them a starting level in the curriculum (e.g. somewhere in A1–C2), so they don't have to start from zero if they already know some English.

## Where the code lives
- `artifacts/api-server/src/routes/placement.ts` — `GET /placement-test` (fetch questions), `POST /placement-test/submit` (grade + assign level)
- `lib/db/src/schema/placement.ts` — `placement_questions`, `placement_options`, `placement_results` tables
- `artifacts/ascension/src/pages/placement.tsx` — the test-taking screen

## How it works
1. The app loads questions and their answer choices from the database — the correct answers are never sent to the browser, only the question text and options.
2. When the student submits, the server checks every answer is for a real question in this test, checks for duplicate answers, and checks the chosen option actually belongs to that question — so a tampered request can't sneak in a fake answer.
3. Scoring happens entirely on the server: it counts correct answers, turns that into a percentage, and picks a starting level from the curriculum's level list (capped so nobody starts at the very top level from a 10-question test).
4. The result and the level assignment are saved together in one database transaction, so you never end up with a saved score but no assigned level (or vice versa).
5. Once completed, `placementCompleted` is set on the student's profile and the test cannot be taken again through the API.

## Quality check

**Solid:**
- All scoring logic is server-side — a student can't fake a higher score by editing the request. This is the most important thing for a placement test to get right, and it's done correctly.
- Answers are checked against the real question/option data before scoring, rejecting nonsense or forged submissions with clear error messages.
- Saving the result and updating the student's level happens in a single transaction, so there's no way to end up in a half-saved state.
- Works for any curriculum/level system, not just hard-coded CEFR levels — matches the multi-language plan.

**Issues found:**
1. **No way to retake the test.** Once `placementCompleted` is true, there's no endpoint to reset it — if a student wants a do-over, or picks the wrong answers by mistake, only someone editing the database directly can fix it. Worth adding an admin action for this before launch, since support will get this request.
2. **Small race condition.** If a student double-taps "submit" and two requests land at almost the same instant, both can pass the "already completed" check before either one saves — resulting in two placement results being recorded instead of one being blocked. Low chance of happening, but easy to guard against with a unique constraint or a re-check inside the transaction.
3. **Loads every placement option from the database on every request**, rather than only the ones for this test's questions. Not a problem while the question bank is small (which it is today), but it's a pattern to avoid repeating as things grow — the same mistake was already found and fixed for exercises (see `docs/arch-foundation.md`).

## Suggested next steps
- Add an admin/support way to reset a student's placement so they can retake it.
- Re-check `placementCompleted` inside the transaction (not just before it) to fully close the double-submit race.

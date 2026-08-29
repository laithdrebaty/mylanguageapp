# Feature: Quizzes

## What it does
A separate, retakeable assessment on top of the lesson system — a quiz is a timed or untimed set of questions with a limited number of attempts, built the same way lessons are (out of content blocks), but tracked independently so it can be attempted multiple times and scored per attempt.

## Where the code lives
- `artifacts/api-server/src/routes/quizzes.ts` — list quizzes, start an attempt, save an answer, submit for grading, view a graded attempt
- `artifacts/api-server/src/services/quiz-grading.ts` — hides answer keys from the student, grades each block type, decides which blocks need a human/AI verdict later
- `lib/db/src/schema/quizzes.ts` — `quizzes`, `quiz_attempts`, `quiz_responses`
- CMS side (`routes/cms/quizzes.ts`) is where quizzes get authored — covered separately if you want it reviewed later

## How it works
1. A student starts an attempt; if they already have one "in progress," that's resumed instead of counting as a new attempt (so a page refresh doesn't burn one of their tries).
2. Each answer is saved as they go (`PUT .../responses/:blockId`), and answering the same question again just overwrites the earlier answer.
3. On submit, the server grades every objectively-checkable block itself and ignores anything the client might have sent as a score. Blocks that need a human or future AI judgment (open-ended writing, speaking) are left "pending" and excluded from the score so far, so the percentage shown reflects only what could actually be graded.
4. Once every block has a verdict, the attempt is marked graded and pass/fail is decided using the quiz's passing score.
5. A student can only ever see or touch their own attempts — every query checks the attempt belongs to the logged-in user.

## Quality check

**Solid:**
- Grading is fully server-side and the answer key is stripped out of anything sent to the browser before an attempt is submitted — a student cannot see or fake correct answers.
- Every attempt/response lookup filters by the logged-in user's ID, so one student can't view or tamper with another student's quiz attempt by guessing an ID.
- Submitting is wrapped in a single database transaction, so a quiz can't end up half-graded if something fails partway through.
- Resuming an in-progress attempt instead of creating a new one is a thoughtful touch — it stops a page refresh from silently costing a student one of their limited attempts.

**Issues found:**
1. **Time limits aren't enforced.** A quiz can be marked with a time limit (`timeLimitSec`), and it's shown to the student, but nothing on the server checks how long they actually took before accepting their submission. Today this is purely a countdown on the screen — a student could pause it, take as long as they want, and still submit normally. If timed quizzes matter for your product (e.g. exam-style assessments), this needs a server-side check comparing `startedAt` to the time limit at submit time.
2. **Small race on "max attempts."** The check for "have they used all their attempts" reads the count, then inserts a new attempt as a separate step — if two "start quiz" requests from the same student land at the exact same moment, both could pass the check and the student could end up with one extra attempt than allowed. Low likelihood, low impact, but easy to close by making the check-and-insert atomic (e.g. a unique constraint or a single query).
3. **No cleanup for abandoned attempts.** If a student starts a quiz and never finishes it, that attempt just sits as "in progress" forever — not a bug exactly (it correctly resumes rather than blocking them), but there's no visibility into how many abandoned attempts exist, which could be useful for a future admin report.

## Suggested next steps
- Decide whether timed quizzes need real enforcement before launch; if yes, check elapsed time against `timeLimitSec` in the `/submit` route.
- If you plan to rely on `maxAttempts` for anything strict (like a paid feature), tighten the attempt-count check to avoid the race described above.

# Student Learning Engine

## What & Why
Complete the core student learning loop for Ascension: registration and placement should lead to a data-driven curriculum assignment, a real dashboard, dynamically rendered CMS lessons, server-verified activities, saved progress, and enforced lesson unlocking. The implementation must deliver owner-authored CMS content without generating or inventing educational material.

## Done looks like
- A newly registered student can complete the placement test and receive a stored score and curriculum-specific starting level.
- The dashboard uses live backend data to show curriculum, level, progress, current/next lesson, completed and available work, locked work, and recent activity, including a safe no-placement state.
- The lesson player renders configured published blocks in order for reading, vocabulary, MCQ, speaking, pronunciation, and open-ended activities.
- Reading translations, configured vocabulary, and available prerecorded audio are displayed with mobile-friendly playback controls.
- MCQ answers are submitted to the backend, graded from stored answer data, and returned with configured explanations; frontend-provided scores cannot determine results.
- Open-ended responses are saved and completion is tracked without pretending to provide AI evaluation.
- Speaking and pronunciation activities provide microphone recording and submission boundaries, with explicit “not AI-scored” behavior.
- Required blocks gate completion according to the lesson’s CMS configuration; optional blocks do not block completion.
- The server tracks attempts, activity responses, scores, completion timestamps, and progress history, and revisits do not erase the original completion record.
- Lesson states are exposed as locked, available, in progress, or completed, and the server prevents bypassing level, score, completion, unpublished-content, and progression rules.
- Completing a lesson updates progress and unlocks the next eligible lesson without assuming every future curriculum is Arabic, English, CEFR, A1–C2, or strictly linear.
- The complete student journey works through real HTTP requests and browser interactions, and existing CMS behavior remains intact.

## Out of scope
- Creating, expanding, or AI-generating lessons, vocabulary, reading passages, questions, translations, or curriculum.
- Sophisticated AI scoring for speaking, pronunciation, or open-ended responses.
- Automatic lesson-audio generation or storing large media files in PostgreSQL or Redis.
- Replacing the existing authentication system or adding a native mobile application.
- Unrelated CMS features, subscriptions, deployment configuration, or broad visual redesign.

## Steps
1. **Model learning attempts and activity responses** -- Extend the learning data model so MCQ, open-ended, speaking, and pronunciation submissions can be stored with student ownership, attempt history, response data, deterministic result fields, and future evaluator metadata without overwriting prior lesson completions. Add the required idempotency, ownership, and query indexes through an idempotent migration.
2. **Harden placement and progression services** -- Keep placement assignment based on the selected curriculum’s ordered levels and persist the result; validate submitted question/option pairs server-side, handle incomplete answers consistently, and expose curriculum/level metadata without hard-coded language or framework assumptions.
3. **Build server-authoritative activity APIs** -- Add authenticated endpoints for starting lessons, submitting MCQs, saving open-ended responses, submitting recorded speaking/pronunciation attempts, and completing lessons. Derive scores and required-block completion from database content and activity records; reject forged scores, cross-lesson exercises, locked lessons, unpublished content, and incomplete required work.
4. **Unify lesson availability and progress responses** -- Update lesson, level, and dashboard queries to return live curriculum context, available/locked/in-progress/completed states, progress summaries, recent activity, and next eligible lessons while preserving completed history and avoiding full-curriculum loads for one lesson.
5. **Update the API contract and client generation** -- Document the new request/response shapes in the OpenAPI specification and regenerate the shared TypeScript clients and schemas so frontend calls remain typed and usable by a future Android/iOS client.
6. **Complete the student dashboard and placement flow** -- Connect the existing screens to the expanded live responses, render no-placement and empty-content states safely, show curriculum and lesson availability clearly, and ensure placement completion routes into the assigned curriculum without hard-coded level names.
7. **Replace the demo lesson player** -- Render every supported CMS block from its configured data, add translations and vocabulary presentation, use configured audio references through native mobile-friendly controls, submit activity responses to the server, show deterministic feedback, support open-ended and recording submissions, and visibly distinguish unsupported AI evaluation from completed submission.
8. **Implement required/optional completion UX** -- Track block completion in the player, prevent finishing when required activities are incomplete, allow optional activities to be skipped, show server-returned results, and provide review/retry behavior that does not destroy the original completion record.
9. **Verify the full student journey end to end** -- Against the running API and browser app, test registration/login, placement, dashboard, each configured activity type, server-side grading, required/optional rules, lesson completion, unlocking, revisit behavior, logout/login persistence, locked and unpublished access, score tampering, and regression of CMS flows. Run typechecks/builds and inspect workflow/browser logs before delivery.

## Relevant files
- `lib/db/src/schema/progress.ts`
- `lib/db/src/schema/levels.ts`
- `lib/db/src/schema/placement.ts`
- `lib/db/src/schema/languages.ts`
- `lib/db/src/schema/index.ts`
- `artifacts/api-server/src/routes/auth.ts`
- `artifacts/api-server/src/routes/placement.ts`
- `artifacts/api-server/src/routes/dashboard.ts`
- `artifacts/api-server/src/routes/levels.ts`
- `artifacts/api-server/src/routes/lessons.ts`
- `artifacts/api-server/src/routes/exercises.ts`
- `artifacts/api-server/src/routes/index.ts`
- `artifacts/ascension/src/pages/dashboard.tsx`
- `artifacts/ascension/src/pages/placement.tsx`
- `artifacts/ascension/src/pages/learn.tsx`
- `artifacts/ascension/src/pages/level.tsx`
- `artifacts/ascension/src/pages/lesson.tsx`
- `artifacts/ascension/src/App.tsx`
- `lib/api-spec/openapi.yaml`
- `lib/api-spec/package.json`
- `lib/api-client-react/src/generated/api.ts`
- `lib/api-client-react/src/generated/api.schemas.ts`
# Feature: Authoring quizzes, evaluations and media

The CMS screens a curriculum team needs to use everything built in the previous steps without touching the API by hand.

## Why this existed as a gap

Level evaluations, AI grading rubrics, read-aloud passages and reference audio were all *implemented* and all *unreachable*: the endpoints existed, but nothing in the CMS called them. A curriculum manager could not create the test that promotes a student, could not tell the AI what a good written answer must cover, and could not upload an audio file — only register the key of one somebody had put in the bucket another way.

## What was added

**A quiz editor** at `/cms/quizzes`, listing practice quizzes and level evaluations together — a level evaluation *is* a quiz with a `kind` that gates promotion, and separating them would suggest two things to learn instead of one. The editor covers:

- **Kind and level.** Making a quiz an evaluation and choosing which level it gates. The level select is marked required and blocks saving without it, matching the database constraint rather than letting the author discover it as an error.
- **Passing score, time limit, max attempts, retry cooldown.** The cooldown field is disabled for practice quizzes, where it means nothing.
- **The block timeline**, with reorder and delete, and a palette grouped by *what marks each type* — automatically, by AI, or not at all. That is the thing an author actually needs to know, and it is not obvious from the type names.
- **Answer keys**, which live only here. The server strips `config` from every student-facing payload; this screen is the only place they are ever visible.
- **AI rubrics** for written blocks: the key points a good answer must cover, fed to the grader. Without them the AI judges relevance to the question alone.
- **Read-aloud passages** for speaking blocks, behind a switch that sets `expects_reference_reading`. The copy says plainly what the switch decides: with a passage, pronunciation can be scored against it; without one, only fluency can be measured.

**A warning before publishing an evaluation** that contains AI-marked questions. Promotion is withheld until every block has a verdict, so if AI is unavailable a student who passed will *wait* rather than advance. Saying that at authoring time is cheaper than diagnosing a stuck student later.

**Real file upload** on the media page, using the same three-step handshake the student recorder uses, plus playback so staff can check what they uploaded. Registering a bare key is still there for files placed in the bucket some other way.

**The evaluation gate percentage** on the levels page — how much of a level a student must finish before its evaluation unlocks.

## Two bugs this surfaced

**The one-evaluation-per-level index was too strict.** It counted drafts as live, so a team could not prepare next term's evaluation while this term's was published. Only *published* evaluations can collide — that is all `getLevelEvaluation` looks for — so migration 009 narrows it. Migration 004 no longer creates the old index: every migration here is re-applied in order on each run, so leaving it would have recreated the strict version before 009 could drop it, and failed on any database that had since drafted a replacement.

**A constraint violation surfaced as a 500 with raw SQL in it.** Now a 409 saying which level already has an evaluation and what to do about it. Drizzle wraps the driver error, so the Postgres SQLSTATE is on the *cause*, not on what was thrown — checking only the top level silently never matches, which is why the first version of this handler did nothing.

## Where the code lives

- `artifacts/ascension/src/pages/cms/quizzes-list.tsx`, `quiz-editor.tsx`
- `artifacts/ascension/src/pages/cms/media.tsx` — upload and preview
- `artifacts/ascension/src/pages/cms/catalog.tsx` — the levels gate percentage
- `artifacts/ascension/src/lib/cms-api.ts` — quiz CRUD, the upload handshake
- `artifacts/api-server/src/routes/cms/quizzes.ts`, `content.ts` — `expectsReferenceReading` and `referenceMediaId` added to both block endpoints
- `artifacts/api-server/migrations/009_evaluation_uniqueness.sql`

## Gaps to be aware of

1. **An admin can still edit a published quiz through the API.** The editor disables it and explains why, but the endpoint allows it for admins by design — and doing so changes what students mid-attempt see, because `content_version` is recorded on an attempt but blocks are always served current. Pinning served content to the attempt's version is the real fix and is a larger change.
2. **No preview.** There is a lesson preview but no quiz preview; an author cannot see what a student will see.
3. **Reference audio still is not attachable to a block from the UI.** `referenceMediaId` is now settable through the API and the media library can upload files, but the block editor has no picker joining the two.
4. **No lesson-side speaking controls.** The read-aloud switch exists in the quiz editor; the lesson block editor does not have it yet, so lesson pronunciation blocks still need the API.
5. **Deleting a staff account is blocked** once they have written to `cms_audit_logs`, which is append-only with a `NOT NULL` author. Deactivating rather than deleting is probably the right policy, but there is no deactivate flag.
6. **No bulk anything.** A twelve-level curriculum needs twelve evaluations created one at a time.

# Content Management System (CMS)

## What & Why

Build a complete, role-gated CMS so authorized administrators and content creators can manage the entire Ascension educational curriculum from the browser — creating languages, curricula, levels, lessons, content blocks, vocabulary, MCQs, speaking activities, and media references — without touching code or the database directly.

The existing foundation (PostgreSQL schema, Redis caching, lesson routes, basic admin UI) must be preserved and extended. No rewrites, no data loss, no disruption to the student-facing app.

## Done looks like

- Admin and content_manager users can log in and reach a CMS dashboard showing counts of languages, curricula, levels, lessons by status, and recently modified content
- A lesson can be created, edited (all metadata + content blocks), duplicated, submitted for review, approved, published, unpublished, archived, and restored — entirely via the UI
- Content blocks within a lesson can be added, configured, reordered, and deleted: Reading, Vocabulary, MCQ, Speaking, Pronunciation, Listening, Explanation, Open-ended Question, Conversation Prompt, Review, Spelling
- Vocabulary items can be created, edited, and associated with a lesson or level from the UI
- Languages, curricula, and levels have dedicated management pages with create/edit/status-toggle
- Students only ever see PUBLISHED content; draft/in-review/archived lessons never appear in student APIs
- A content_reviewer can view lessons, approve or reject them, and add review notes; cannot publish or manage users
- Every significant content action (create, edit, publish, unpublish, archive, restore, delete) appears in an audit log with user, timestamp, and before/after status
- Lesson duplication creates a deep copy (blocks, exercises, vocabulary associations) in DRAFT status
- A "Preview as Student" mode renders the lesson exactly as students see it without affecting progress or consuming AI quota
- Content validation blocks publishing a lesson without title, curriculum, level, and at least one content block; blocks publishing an MCQ without a correct answer
- The admin lessons list supports server-side search, filter by status/level/curriculum, and pagination (works for 300+ lessons)
- The existing student app (dashboard, lesson player, placement, subscription) continues to work exactly as before

## Out of scope

- Actual file upload/storage for media (UI stubs the reference; object storage integration is a separate task)
- AI-assisted content generation
- Full speech-recognition evaluation pipeline
- BullMQ background job system
- Publishing/deployment configuration

## Steps

1. **DB migrations — roles, lesson status, versioning, soft-delete, audit log, media refs** — Add `content_manager` and `content_reviewer` to the `users.role` enum. Add `status` column (draft|in_review|approved|published|archived) to `lessons`, keeping `isPublished` consistent via a trigger or migration sync. Add `contentVersion` integer, `softDeletedAt` nullable timestamp, `teacherNotes`, `subtitle`, `tags` text[], `difficulty` to `lessons`. Extend `content_blocks` with `title`, `instructionsAr`, `isRequired` boolean, `estimatedMinutes`, `isActive` boolean, `config` jsonb. Add `partOfSpeech`, `difficulty`, `tags` text[], `definition`, `deletedAt` to `vocabulary`. Create `media_assets` table (id, key, mimeType, sizeBytes, durationSec, language, speaker, accent, transcript, createdBy FK users, createdAt). Create `cms_audit_logs` table (id, userId FK, action text, contentType text, contentId integer, prevStatus text, newStatus text, meta jsonb, createdAt). Create `lesson_reviews` table (id, lessonId FK, reviewerId FK users, decision text, notes text, createdAt). Apply all migrations via raw SQL (drizzle-kit push is non-interactive).

2. **RBAC — middleware and session types** — Update `users.role` type in session.d.ts to include `content_manager` and `content_reviewer`. Update `requireAdmin` and add `requireContentManager` and `requireReviewer` middleware helpers. Ensure all existing student-facing routes reject CMS roles appropriately. Update Drizzle schema files to reflect new enum values.

3. **CMS API — lesson lifecycle and content block CRUD** — Extend admin/CMS routes with: lesson create (full metadata), lesson update (metadata + status transitions), lesson duplicate (deep copy → DRAFT), lesson soft-delete, lesson publish/unpublish/archive/restore with validation, submit-for-review and approve/reject. Add CRUD endpoints for content blocks (create, update, delete, reorder by order array). Add CRUD endpoints for exercises and exercise options (MCQ, speaking, pronunciation, open-ended). Add bulk-reorder endpoint that accepts an ordered array of block IDs. All mutations write to `cms_audit_logs`. Lesson status transitions must be validated server-side (e.g. only APPROVED can be published; only admin or reviewer can approve).

4. **CMS API — vocabulary, languages, curricula, levels, media, dashboard, search** — Add admin CRUD for vocabulary items (create, update, soft-delete, search by lesson/level). Add admin CRUD for languages (create, update, toggle active). Add admin CRUD for curricula (create, update, toggle active). Add admin CRUD for levels (create, update, reorder, toggle active). Add media asset registration endpoint (stores metadata + key reference, no actual file upload). Add CMS dashboard stats endpoint returning counts per entity and per lesson status, and recently-modified lessons. Add paginated, filterable lesson list endpoint (status, curriculum, level, search term, creator, date range). Invalidate Redis caches on all mutations.

5. **CMS API — review, audit log, preview** — Add review endpoints: reviewer submits decision (approve/reject + notes), admin sees all pending reviews. Add audit log list endpoint (paginated, filterable by action/contentType/user/date). Add lesson preview endpoint that returns full lesson content regardless of status (admin/content_manager/reviewer only) and explicitly flags `isPreview: true`; never records progress.

6. **Frontend — CMS layout and role routing** — Extend `App.tsx` with routes for all new CMS pages gated by role (admin, content_manager, content_reviewer). Add a CMS sidebar navigation with sections: Dashboard, Languages, Curricula, Levels, Lessons, Vocabulary, Media, Reviews, Audit Log. Ensure the session `role` field drives what menu items appear. Add `content_manager` and `content_reviewer` to the ProtectedRoute role check.

7. **Frontend — Lesson list and lesson editor UI** — Replace or extend the existing admin lessons page with: paginated list with status badges, search box, filters (curriculum, level, status), and actions (edit, duplicate, archive, preview). Build a lesson editor page with two panels: metadata form (title, subtitle, description, objectives, level selector, curriculum, estimated duration, difficulty, tags, teacher notes, passing score, XP reward) and a content-block canvas (drag-to-reorder list of blocks, add-block button with type picker). Each block has an inline editor appropriate to its type: Reading (rich textarea, Arabic translation, estimated reading time), MCQ (question, option inputs, correct-answer radio, explanation), Vocabulary (word picker or inline create), Speaking (prompt, instructions, model answer, criteria), Pronunciation (word, phonetic, notes), Listening (media reference picker, transcript), Open-ended (question, expected concepts, model answer), Explanation (bilingual text). Provide Save Draft, Submit for Review, Publish, Unpublish, Archive, and Preview buttons that call the appropriate API endpoints with correct status transitions.

8. **Frontend — Language, curriculum, level, vocabulary, media management pages** — Build list + create/edit form pages for: Languages (code, name, native name, RTL toggle, active toggle), Curricula (language selectors, name, description, level framework, active toggle), Levels (curriculum selector, code, name, Arabic name, order, description, active toggle with drag-reorder). Build a vocabulary management page with search/filter, inline-edit, soft-delete, and create form. Build a media assets page showing registered references with metadata; provide a form to register a new reference by URL/key. All pages use server-side pagination.

9. **Frontend — Review flow, audit log, dashboard** — Build a review queue page showing IN_REVIEW lessons with approve/reject buttons and a notes field for reviewer role. Build an audit log page with filterable table (user, action, content type, date range). Update the CMS dashboard to use the new stats endpoint and link each stat card to the relevant filtered list.

10. **Content validation and preview** — On the frontend, disable the Publish button and show inline validation errors when required fields are missing. On the backend, enforce the same validation in the publish endpoint (return 422 with structured errors). Wire the Preview button to open the lesson in a read-only student-like view clearly labelled "Preview Mode — not recording progress".

11. **Cache invalidation and Redis integration** — Ensure all CMS content mutations invalidate the relevant Redis cache keys (`v1:lang:list`, `v1:curricula:list`, `v1:levels:c:{id}`, `v1:lesson:{id}:content`, `v1:vocab:*`) so students see updates within the configured TTL at worst, and immediately on targeted invalidation.

12. **Test all critical paths** — Verify: admin can create and publish a lesson with blocks; content_manager can create and submit for review but cannot publish; reviewer can approve but not publish; student cannot reach any CMS endpoint; existing lesson player still works; lesson duplication produces a correct deep copy in DRAFT; audit log records all mutations; soft-deleted lessons don't appear in student API; preview mode never writes progress; pagination works with large result sets.

## Relevant files

- `lib/db/src/schema/languages.ts`
- `lib/db/src/schema/users.ts`
- `lib/db/src/schema/levels.ts`
- `lib/db/src/schema/progress.ts`
- `lib/db/src/index.ts`
- `artifacts/api-server/src/middlewares/auth.ts`
- `artifacts/api-server/src/routes/admin.ts`
- `artifacts/api-server/src/routes/lessons.ts`
- `artifacts/api-server/src/routes/languages.ts`
- `artifacts/api-server/src/routes/vocabulary.ts`
- `artifacts/api-server/src/routes/subscriptions.ts`
- `artifacts/api-server/src/routes/index.ts`
- `artifacts/api-server/src/app.ts`
- `artifacts/api-server/src/services/cache.ts`
- `artifacts/api-server/src/types/session.d.ts`
- `artifacts/ascension/src/App.tsx`
- `artifacts/ascension/src/pages/admin/dashboard.tsx`
- `artifacts/ascension/src/pages/admin/lessons.tsx`
- `artifacts/ascension/src/pages/admin/students.tsx`
- `lib/api-spec/openapi.yaml`

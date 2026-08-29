---
name: pr-review-backend
description: Backend checklist for reviewing changes to artifacts/api-server, lib/db, or lib/api-spec in this repo (Express 5 + TypeScript + Drizzle/Postgres + Redis). Loaded by the pr-review skill when backend files changed; can also be used stand-alone for a backend-only review.
---

# PR Review — Backend (Express + Drizzle/Postgres + Redis)

Stack reminders before you start: Express 5, TypeScript, Drizzle ORM over PostgreSQL, sessions via `express-session` + `connect-pg-simple` (session lives in the database, not a token), Redis (`ioredis`) for caching/rate-limiting/AI quota with graceful degradation, Zod **v3** for request validation (never import the Orval-generated `@workspace/api-zod` package here — it's Zod v4 and incompatible, see `docs/zod-orval-compat.md`).

## 1. Access control — who is allowed to call this?

- Every route touching a logged-in user's data must go through `requireAuth` (or a more specific guard: `requireStudent`, `requireAdmin`, `requireContentManager`, `requireCMSAccess`, `requireReviewer` — see `middlewares/auth.ts`). A new route with no guard at all is a blocking finding unless it's genuinely meant to be public (like `GET /levels` or `GET /placement-test`, which intentionally work for anonymous or logged-in users).
- Every query that reads or writes "this user's own thing" (progress, attempts, quiz responses, profile) must filter by `req.session.userId` in the `WHERE` clause — not just check the user is logged in and then trust an ID from the request body/params. Look for queries where an ID comes from `req.params` or `req.body` and make sure ownership is actually checked before acting on it.
- If a route serves curriculum-specific content, check it verifies the requesting student is actually enrolled in that curriculum (the existing pattern is `getStudentCurriculumContext(userId)` plus comparing `curriculumId`) — don't let a student read or submit into a curriculum they're not enrolled in.

## 2. Never trust the client for anything gradable

This is the most important rule in the codebase, and it's been done right almost everywhere — keep it that way. A score, a "correct/incorrect" result, or a completion state must always be computed on the server from stored answer data, never accepted as a value the client sends. If a diff adds a field like `score`, `correct`, or `passed` to a request body and then uses it directly instead of recomputing it server-side, that's a blocking finding.

## 3. Input validation

- New or changed request bodies should be validated with a Zod schema (`safeParse`, 400 on failure) — either reuse a shared schema from `lib/validate.ts` or add one there following the same pattern, rather than hand-rolling `if (!field)` checks. (`auth.ts`'s register/login routes currently skip the schemas that already exist for them — don't repeat that in new code, and flag it if you notice it drifting further.)
- Check numeric IDs from `req.params` are actually parsed and checked with `isNaN` before use (the existing routes do this consistently — match the pattern).
- Check enum-like fields (role, language, status) are constrained to known values, not free text that could later violate a database enum constraint and surface as a raw 500 error.

## 4. Database performance — the two mistakes this codebase has already made once

Both of these were found and fixed elsewhere in the codebase (`docs/arch-foundation.md`), which means they're mistakes that are easy to reintroduce by copy-pasting older code or writing a new route without checking the established pattern:

- **N+1 queries**: fetching rows in a loop (once per item) instead of collecting the IDs and batch-fetching with `inArray(...)`. If you see a `for`/`.map()` loop with a `db.select()` or `await db...` inside it, that's a strong candidate for a flag.
- **Unfiltered full-table scans**: `db.select().from(someTable)` with no `where` clause, on a table whose size grows with content or users, and then filtering in JavaScript afterward. This should filter by the relevant IDs (curriculum, level, lesson) in the query itself. (`GET /levels` has this bug today — treat any new code with the same shape as a repeat of a known issue, not a new discovery you need to convince anyone of.)

## 5. Transactions and race conditions

- Any place that does more than one related write (e.g. save a result *and* update a profile/level, insert an attempt *and* update progress) should be wrapped in `db.transaction(...)` so it can't end up half-done.
- Watch for "read a flag, then decide, then write" sequences on the same row — e.g. "check if already completed" followed later by an `insert`/`update`. Two near-simultaneous requests can both pass the check before either writes, causing double XP, an extra attempt, or a duplicate record. Prefer a unique constraint, an atomic `sql\`column + ${value}\`` increment (already used for XP in `lessons.ts`), or re-checking the condition inside the transaction right before the write.

## 6. Caching (Redis)

- Reference/list data that rarely changes (languages, curricula, subscription plans, level metadata, lesson content) can be cached via `services/cache.ts`'s `cached(key, ttl, fn)` helper, using the versioned key scheme (`v1:...`) documented in `docs/redis-arch.md`.
- **Never cache anything user-specific and mutable**: progress, scores, XP, subscription status, auth/session data, AI usage. If a diff adds caching to any of these, that's a blocking finding — a cached stale score or subscription status is a real product bug, not a minor one.
- If a diff adds or edits published content through an admin/CMS route, check it invalidates the matching cache keys (see the invalidation points in `docs/redis-arch.md`) — otherwise students keep seeing the old version until the TTL expires.

## 7. AI features and quotas

- Any code path that calls into `services/ai.ts` must go through the quota check in `services/ai-quota.ts` (`checkAndIncrement`) **before** making the AI call, not after — otherwise a failed quota check doesn't actually stop the request that already happened.
- The quota system is designed to fail **closed** (deny the request) if Redis is down, because AI calls cost real money on a $2–4/month subscription. Don't "fix" a Redis-down error by making an AI code path fall back to allowing the request — that defeats the purpose. General caching and rate-limiting are allowed to fail open; AI quota is not.

## 8. Database migrations

- New tables or new nullable columns: `drizzle-kit push` is fine.
- Dropping or renaming a column, or dropping a constraint: must be raw SQL applied directly (see `docs/db-migration-non-interactive.md`) — `drizzle-kit push` blocks on an interactive TTY prompt for these and will hang or fail in CI/containers.
- Check every migration is idempotent or otherwise safe to run twice (the existing ones use `IF NOT EXISTS` / guarded statements) — a migration that fails on a second run will break the `migrate` step in `docker-compose.yml`, which the API service depends on to even start.

## 9. API contract

- A route whose request or response shape changed should have a matching update to `lib/api-spec/openapi.yaml`, with the client regenerated afterward. If the diff changes a route's behavior but not the spec, flag it — even if nothing is visibly broken today, the spec is now lying about what the API does.
- Remember the two Orval/Zod quirks documented in this repo before regenerating: use `type: number` (not `integer`) and omit `format: email` in the spec (`docs/openapi-codegen-rules.md`), and never let `api-server` import the generated `@workspace/api-zod` package (`docs/zod-orval-compat.md`).

## 10. Error handling

- Don't swallow errors silently (empty `catch` blocks) — let them propagate to the global error handler in `app.ts`, or log them explicitly if you catch them for a reason.
- Don't leak internal error details (stack traces, raw database error messages) in a response body — the global handler already strips this in production; a route that builds its own error response should do the same.

## 11. Tests

See the main `pr-review` skill for the repo-wide testing policy (there are currently no tests anywhere in this codebase, despite vitest being configured for the API server). For backend logic specifically, grading/scoring functions, access-control checks, and anything touching money or progress are the highest-value places to ask for a test first.

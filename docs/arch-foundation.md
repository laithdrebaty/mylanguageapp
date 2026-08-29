---
name: Production architecture foundation
description: What was done in the architecture hardening pass — patterns to keep consistent going forward.
---

## Key decisions made

### Security middleware order (app.ts)
`trust proxy` → `helmet` → `compression` → `pino-http` → `cors` → `json/urlencoded` → `session` → rate limiters → routes → global error handler.
`trust proxy = 1` is REQUIRED before rate-limit middleware — the app runs behind a reverse proxy and X-Forwarded-For must be trusted.

### Rate limiting
- 200 req/15min on all /api (general abuse protection)
- 10 req/15min on /api/auth/login and /api/auth/register, `skipSuccessfulRequests: true`
- Uses `standardHeaders: 'draft-7'`, `legacyHeaders: false`

### DB indexes added (via raw SQL — drizzle-kit not used)
lesson_progress(user_id, lesson_id) UNIQUE, lesson_progress(user_id), lesson_progress(user_id, completed_at),
lessons(level_id, order), student_profiles(user_id) UNIQUE, student_subscriptions(user_id, status),
exercise_options(exercise_id), content_blocks(lesson_id, order), exercises(lesson_id),
vocabulary(lesson_id), vocabulary(level_id), placement_results(user_id),
exercise_attempts(user_id), exercise_attempts(exercise_id).

### Critical bugs fixed
- exercise_options full-table-scan: `db.select().from(exerciseOptionsTable)` with NO WHERE clause → fixed with `inArray(exerciseOptionsTable.exerciseId, exerciseIds)`
- XP race condition: fetch-then-set replaced with `sql\`total_xp + ${xpEarned}\`` atomic SQL increment
- N+1 in dashboard: recentProgress loop now uses `inArray` batch fetch
- N+1 in review: both routes now batch-fetch lessons and levels

### Service abstraction stubs
- `services/ai.ts` — AIProvider interface + NotImplementedAIProvider; set AI_PROVIDER=openai to add real provider
- `services/cache.ts` — CacheProvider interface + InProcessCache; set CACHE_PROVIDER=redis for Redis
- `services/jobs.ts` — JobQueue interface + FireAndForgetQueue; set JOB_QUEUE=bullmq for real queue
- `lib/validate.ts` — Zod v3 validation helper + shared schemas (register, login, lessonComplete, etc.)

### DB pool config
Pool is now tuned via env vars: DB_POOL_MAX (default 10), DB_POOL_MIN (2), DB_IDLE_TIMEOUT (30000ms), DB_CONN_TIMEOUT (5000ms).
Pool error events are logged (previously silent).

### Backend language decision
Node.js/TypeScript kept — correct for this workload. Express 5 + async/await is non-blocking, ecosystem has all needed AI/WS/WebRTC libs.

**Why:** Go/Rust would be faster at CPU-bound work but Ascension's bottleneck is DB I/O and future AI API latency, not CPU. Node.js's ecosystem advantage (AI SDKs, WebRTC signaling, pino logging) outweighs raw throughput gains from a rewrite.

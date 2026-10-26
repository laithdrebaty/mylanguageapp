---
name: AI + peer calls — deployment checklist
description: Everything that must change before the AI integration and student-to-student voice calls work on a deployed app. Covers all the work in the staged branch, not just peer calls. Verified against the code, not assumed.
---

# Deployment checklist — AI integration and peer calls

Scope: **all the work on this branch** — the AI provider layer (Anthropic chat,
AssemblyAI speech), per-plan AI quotas and usage accounting, lesson grading,
the AI tutor conversation, and student-to-student voice calls with their opt-in
evaluation.

All of it works **on one machine in development**. None of it is proven on a
deployed app, and the reasons are configuration and infrastructure rather than
application code — with the exceptions called out as code changes below.

Each item says what breaks, how to confirm it is broken, and what fixes it.
Everything here was checked against the code; nothing is assumed.

Related: [voice-practice.md](./voice-practice.md) (how calls work),
[../DEPLOYMENT.md](../DEPLOYMENT.md), [../ai-cost-model.md](../ai-cost-model.md).

---

## Do this first: post-deploy AI setup

**A fresh deploy has AI switched off and no providers.** Migration 006 inserts
`ai_settings (id=1, enabled=FALSE)` and seeds task rows with **no provider and
no model**; no migration ever inserts an `ai_providers` row, because an API key
cannot live in version control. So on a new database every AI feature refuses
cleanly — grading stays pending, the tutor will not start, call evaluation is
denied — and nothing is broken, it is simply not configured.

Required steps, in the admin panel at `/admin/ai-settings`:

1. **Add the chat provider.** Anthropic, base URL `https://api.anthropic.com`,
   role `chat`, paste the API key. Set `input_price_per_mtok = 1` and
   `output_price_per_mtok = 5` for Haiku 4.5, or cost accounting stays null.
2. **Add the speech provider.** AssemblyAI, base URL
   `https://api.assemblyai.com`, role `speech`. Pricing is per minute and is not
   expressible yet — see #7.
3. **Point each task at a provider and model.** `conversation`, `feedback`,
   `open_answer` and `peer_call_analysis` → the chat provider with
   `claude-haiku-4-5`; `transcription` → AssemblyAI with `universal`.
   `placement_analysis` and `weakness_analysis` ship disabled on purpose.
4. **Enable the tasks** you want, then **flip `ai_settings.enabled` on.**
5. **Set the monthly budget** (`ai_settings.monthly_budget_usd`). Note #7: ASR
   spend is currently invisible to this ceiling, so it under-counts.

`AI_CONFIG_SECRET` encrypts the stored keys. `render.yaml` generates it once and
warns against changing it — **rotating it makes every stored provider key
undecryptable** and they must all be re-entered.

---

---

## Status summary

| # | Item | Severity | Calls | Evaluation |
|---|---|---|---|---|
| 1 | ~~22 env vars never reach the container~~ — **done** in compose and `.do/app.yaml` | ~~Blocker~~ | ✅ | ✅ |
| 2 | No TURN relay configured | **Blocker** | ✅ | ✅ |
| 3 | HTTPS required for microphone access | **Blocker** | ✅ | ✅ |
| 4 | `STORAGE_PUBLIC_ENDPOINT` missing in `render.yaml` | **Blocker** | — | ✅ |
| 5 | In-memory job queue loses analysis on restart | High | — | ✅ |
| 6 | Single-instance assumption (signalling + jobs) | High | ✅ | ✅ |
| 7 | ~~ASR cost not priced per minute~~ — **done**, enter the rate at setup | ~~High~~ | — | ✅ |
| 8 | ~~Call presence not tracked server-side~~ — **done** (migration 019) | ~~Medium~~ | ✅ | — |
| 9 | ~~`PRACTICE_MAX_CALL_MINUTES` default is 30~~ — **done**, now 15 | ~~Medium~~ | ✅ | ✅ |
| 10 | Rate limiting under a proxy | Medium | ✅ | ✅ |
| 11 | ~~Recording length cap rejects a full-length call~~ — **done** (960s for `practice_call`) | ~~Blocker~~ | — | ✅ |
| 12 | `lib/db` must be built before the API typechecks | Medium | ✅ | ✅ |
| 13 | ~~ASR poll timeout (3 min) short for a long call~~ — **done**, now 600000 | ~~High~~ | — | ✅ |
| 14 | New Anthropic adapter + outbound DNS/HTTPS unverified | High | — | ✅ |
| 15 | AI usage accounting silent when broken | High | — | ✅ |
| 16 | Migration idempotency depends on 006's task list | **Blocker** | ✅ | ✅ |
| 17 | Plan policies / subscriptions gate all AI | High | — | ✅ |
| 18 | Browser-facing limits (CORS, bundle size, APP_BASE_URL) | Medium | ✅ | ✅ |

"Calls" / "Evaluation" mark which half an item blocks. Items 14–18 are the
AI integration generally, so they affect lesson grading and the tutor too.

---

## 1. Twenty-two environment variables never reach the API — **blocker**

**What breaks.** The `api` service in `docker-compose.yml` passes an explicit
**allowlist** of environment variables, and `render.yaml` lists its own set.
Every variable outside those lists is silently ignored, however carefully it is
set in `.env`.

This is the single highest-leverage item: it is what makes #2 unfixable (setting
`PRACTICE_TURN_URLS` today does nothing at all), and it silently pins #9, #10
and #13 to their code defaults.

**Confirm it.**

```bash
podman exec <api> sh -c 'echo "[${PRACTICE_TURN_URLS-<UNSET>}]"'   # -> [<UNSET>]
grep -n "PRACTICE_" docker-compose.yml                             # -> no matches
```

**Fix.** Add all of these to the `api` service's `environment:` block in
`docker-compose.yml` and as `envVars` in `render.yaml`. Grouped by what they
control:

| Group | Variables | Why it matters on a deploy |
|---|---|---|
| **TURN / STUN** | `PRACTICE_STUN_URLS`, `PRACTICE_TURN_URLS`, `PRACTICE_TURN_USERNAME`, `PRACTICE_TURN_CREDENTIAL` | Without these a relay cannot be switched on at all (#2) |
| **Call bounds** | `PRACTICE_MAX_CALL_MINUTES`, `PRACTICE_DAILY_CALL_LIMIT`, `PRACTICE_RING_TIMEOUT_MS`, `PRACTICE_CONNECT_TIMEOUT_MS` | Call length is a cost lever (#9) and cannot be tuned |
| **Rate limits** | `RATE_LIMIT_API`, `RATE_LIMIT_PRACTICE_POLL`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_AUTH` | A call polls two endpoints per second; limits must be raisable without a rebuild (#10) |
| **AI timeouts** | `AI_REQUEST_TIMEOUT_MS`, `AI_MAX_ATTEMPTS`, `AI_ASR_TIMEOUT_MS`, `AI_ASR_POLL_TIMEOUT_MS` | 3-minute ASR wait is tight for a long call (#13); retry count bounds cost on provider flakiness |
| **Grading sweeper** | `GRADING_SWEEP_ENABLED`, `GRADING_SWEEP_INTERVAL_MS`, `GRADING_SWEEP_STALE_MS`, `GRADING_SWEEP_MAX_ATTEMPTS`, `GRADING_SWEEP_BATCH` | The sweeper is the only recovery path for lost jobs (#5). `GRADING_SWEEP_INTERVAL_MS` is already in `render.yaml`; the rest are not |
| **Media** | `MEDIA_DAILY_UPLOAD_LIMIT` | Shared counter for lesson recordings and call recordings (#11) |
| **Docs** | `API_DOCS_ENABLED` | Swagger UI is off in production unless set; leaving it unset is correct, but it should be explicit |

The code defaults happen to equal the `.env` values today, which is exactly why
this has stayed hidden: nothing misbehaves until someone needs to change one.

---

## 2. No TURN relay — **blocker for roughly 10–20% of calls**

**What breaks.** `PRACTICE_TURN_URLS` is empty everywhere, so the deployment is
STUN-only. Peer-to-peer audio cannot be established on symmetric NAT, most
mobile carrier networks (CGNAT), or restrictive corporate/school firewalls.
Those calls fail outright — not degraded, not slow.

This is deliberate and disclosed (`DEPLOYMENT.md` flags it), and the failure
path is honest: a 30-second deadline, then an Arabic message saying the
connection failed, that it is usually the network type rather than their
account, that no relay is in use, and to try Wi-Fi instead of mobile data. It
never hangs on "connecting…".

It will not show up in local testing: two browsers on one machine connect via
host candidates and never need a relay.

**Fix. Superseded: use Cloudflare Realtime TURN, not coturn.** This item
originally said to self-host because managed TURN "bills per gigabyte relayed,
which does not survive a $2/month plan". That was true of Twilio and Xirsys;
Cloudflare Realtime gives **1,000 GB/month free**, then $0.05/GB. At roughly
20-30 MB per relayed call leg that covers a great many calls, and only the
10-20% that cannot connect directly are relayed at all. Running a bandwidth-heavy
UDP service to save nothing is the worse trade — revisit coturn past the free
tier. Then:

```
PRACTICE_TURN_URLS=turn:turn.example.com:3478,turns:turn.example.com:5349
PRACTICE_TURN_USERNAME=<user>
PRACTICE_TURN_CREDENTIAL=<long random secret>
```

Include the **`turns:` (TLS, port 443)** variant. It is the one that gets
through firewalls blocking UDP, which is a large share of the population this
feature is for.

Requires #1 first. No application code changes: ICE config is already served
from `GET /practice/ice-servers` so credentials never sit in the JS bundle.

**Cost.** TURN relays actual audio, so it is the one piece of this feature with
a bandwidth bill. A relayed 20-minute call is roughly 20–30 MB each way.

---

## 3. HTTPS is required — **blocker**

**What breaks.** `getUserMedia` (microphone) and `MediaRecorder` only work in a
**secure context**: `https://` or `http://localhost`. On a deployed app served
over plain HTTP, calls fail at microphone access with a confusing error, and the
evaluation recording cannot be made at all.

**Fix.** Serve the frontend over HTTPS (Vercel and Render both do this by
default). Worth stating explicitly because the local workaround — reaching the
dev server by IP address — is *not* a secure context and silently breaks the
microphone, which cost real debugging time during development.

---

## 4. `STORAGE_PUBLIC_ENDPOINT` is missing from `render.yaml` — **blocker for evaluation**

**What breaks.** The call recording is uploaded **by the browser** to a
presigned S3 URL. `storage.ts` signs browser-facing URLs against
`STORAGE_PUBLIC_ENDPOINT` when it differs from the internal endpoint; without
it, the presigned PUT is signed for the address the *server* uses to reach
storage, which the browser cannot resolve. The upload fails and the evaluation
never leaves `consented`.

SigV4 signs the Host header, so the URL cannot be rewritten after signing —
this has to be right at signing time.

**Confirm it.**

```bash
grep -n "STORAGE_PUBLIC_ENDPOINT" render.yaml    # -> no matches
```

**Fix.** Add `STORAGE_PUBLIC_ENDPOINT` to `render.yaml` (and keep it in
`docker-compose.yml`, where it already is), set to the address the browser uses
for the bucket — the R2/Spaces public endpoint.

Also confirm bucket **CORS** allows `PUT` from the app origin. The browser
uploads directly, so a missing CORS rule fails the upload with no useful error.

---

## 5. In-memory job queue loses the analysis — high

**What breaks.** `JOB_QUEUE=memory` in both `docker-compose.yml` and
`render.yaml`, and `jobs.ts` only implements the memory backend (BullMQ is
stubbed as "coming"). An enqueued `analyse_peer_call` job lives in one process's
memory, so a deploy, restart, or crash between upload and analysis loses it.

The recording is already in object storage, so nothing is lost permanently — the
row sits at `uploaded`. The grading sweeper does pick these up
(`pendingAnalysisIds`), so it self-heals, but only on the sweeper's interval
(default 10 minutes) rather than immediately.

**Fix (either).**
- Accept the delay and rely on the sweeper. Lower `GRADING_SWEEP_INTERVAL_MS`
  for a faster recovery.
- Implement the BullMQ backend. Redis is already a hard dependency, so this is
  mostly wiring; it also fixes #6's job half.

---

## 6. Single-instance assumptions — high

**What breaks.** Two places assume one API process:

- **Signalling** is fine across instances: the mailbox is `practice_signals` in
  Postgres, deliberately chosen over Redis so a cache blip cannot lose an SDP
  offer. Polling means no sticky sessions are needed. **No change required.**
- **Jobs** are per-process with the memory queue (#5), so a job enqueued on
  instance A never runs if A restarts.
- **Sweepers** run on every instance. `closeAbandonedSessions` and
  `analyseEvaluation` both claim rows with conditional `UPDATE`s, so concurrent
  sweepers are safe — but every instance doing the work is wasteful.

**Fix.** Either run a single API instance (fine at launch volume), or implement
BullMQ (#5) so jobs are claimed once cluster-wide.

---

## 7. ASR cost is not priced per minute — high

**What breaks.** `computeCostUsd` is token-based, and the AssemblyAI provider
row has null `input_price_per_mtok` / `output_price_per_mtok`. So every
transcription logs `cost_usd = 0`.

For peer calls this is the dominant cost: **multichannel ASR is ~90% of an
evaluated call** ($0.10 of $0.111 for 20 minutes). The monthly budget ceiling in
`ai_settings` sums `ai_usage_logs.cost_usd`, so **peer-call spend is nearly
invisible to the budget guard.**

Durations are already captured in `media_assets.duration_sec` and returned by
the ASR adapter, so the data exists.

**Fix.** Price speech-role providers per minute: add a per-minute rate to
`ai_providers` (or special-case `role = 'speech'`) and compute from duration
instead of tokens.

Related, already fixed: `ai_usage_logs.task` was missing from every migration,
so **all** usage writes were failing silently and the budget ceiling could never
fire. Added in migration 016 — worth re-verifying after any database rebuild.

---

## 8. Call presence is not tracked server-side — medium

**What breaks.** `expireIfDue` enforces the maximum call length **only when
someone polls**. Its comment states the assumption plainly: both sides poll
every second during a call, so "when someone looks" and "promptly" are the same
thing. That assumption fails whenever polls stop — a crashed tab, a closed
laptop, or rate-limited requests.

A call then stays `active` indefinitely, and because of the one-live-per-person
partial unique index, **both students are locked out of every future call**.

Two mitigations are in place:
- The client releases the call on `pagehide` via `navigator.sendBeacon`.
- `closeAbandonedSessions` in the sweeper closes calls past
  `MAX_CALL_MINUTES + 2`.

So the remaining hole is a hard crash where the beacon never fires: the pair
waits for the sweeper (up to ~32 minutes).

**Fix.** Record `last_seen_at` on each call poll — `practice_queue` already has
this column, `practice_sessions` does not — and close calls whose participants
have both gone quiet for ~30 seconds. The data already flows; it just is not
stored.

---

## 9. `PRACTICE_MAX_CALL_MINUTES` contradicts the plan spec — medium

**What breaks.** The plans are sold as **20-minute** calls. The code default is
**30** (`.env` and `.env.example` both say 30). A 30-minute call costs
$0.161 of ASR + analysis against the $0.111 the plan economics assume — a 45%
overrun per evaluated call.

Because of #1 the variable is ignored anyway, so the deployment currently runs
on the hardcoded 30 regardless of what `.env` says.

**Fix.** Set `PRACTICE_MAX_CALL_MINUTES=15` (see the decision in #11) and pass
it through (#1). Note the real cost lever is
`ai_plan_policies.monthly_minutes` (60 for general, 120 for professional), which
already bounds monthly exposure to $0.33 / $0.67 — a per-call cap alone cannot
express that.

---

## 10. Rate limiting under a proxy — medium

**Already fixed in code; listed because the deployment shape is what makes it
matter.** The variables themselves are covered by #1.

A call polls **two** endpoints every second (`/practice/poll` and
`/practice/sessions/:id/signals`). Both are now exempt from the broad limiter
and share a per-user budget, and the broad limiter is keyed by **user rather
than IP**.

That keying is a deployment concern, not a local one: every request arrives
through a proxy (Vite in development, the platform's load balancer in
production), so an IP-keyed limiter collapses all signed-in users onto one
budget. In production a school or mobile carrier is a single address for
hundreds of students — the same collapse, at a much worse scale. `TRUST_PROXY`
is already set in both compose and `render.yaml`, which is what makes `req.ip`
meaningful behind the proxy.

`/healthz` is exempt as well: a liveness probe answering 429 is read as "the
server is down" by everything that calls it, including the platform's own health
checks.

**Fix.** Nothing further in code. Pass the four `RATE_LIMIT_*` variables (#1) so
limits can be raised without a rebuild, and confirm `TRUST_PROXY=1` survives
into the deployed environment.

---

## 11. The media length cap rejects a full-length call — **blocker for evaluation**

**What breaks.** Call recordings are uploaded through `beginUpload`, which
enforces the same limits as a lesson recording:

```
MAX_RECORDING_SECONDS = 600    # 10 minutes
MAX_RECORDING_BYTES   = 15 MB
```

Calls are capped at **20 minutes** (see #9), so a call longer than ten minutes
is refused at upload with `TOO_LONG` and **can never be evaluated**. The
evaluation sits at `consented` until the upload window expires.

Sizes, at the 96 kbps stereo the recorder now asks for:

| Call | Size | Under 15 MB? | Under 600 s? |
|---|---|---|---|
| 10 min | 6.9 MB | yes | yes (at the edge) |
| **20 min** | **13.7 MB** | yes | **no — rejected** |
| 30 min | 20.6 MB | **no** | no |

So at a 20-minute cap the byte limit is fine and **only the duration limit
blocks it**. This was invisible in development because every test call was under
a minute.

**Decision: 15 minutes.** Both 15 and 20 are technically valid — the byte limit
has headroom either way, and only the duration constant has to move. 15 was
chosen because it is materially cheaper per evaluated call and leaves more room
under every limit:

| Cap | Size | Cost per evaluated call | Calls within 60 min/mo |
|---|---|---|---|
| **15 min** | **10.3 MB** | **$0.086** | **4** |
| 20 min | 13.7 MB | $0.111 | 3 |

At the `general_english` allowance of 60 minutes a month, a 15-minute cap gives
a student **four** evaluated calls instead of three for the same spend — more
feedback per dollar, and more headroom before the 15 MB byte limit matters.

The one cost: the plans are described as 20-minute calls, so this is a product
decision as much as a technical one. If the 20-minute figure is load-bearing in
marketing, use 20 and accept the higher per-call cost — the only code difference
is the constant.

Set the media cap to **960 s** (15 minutes plus a minute of headroom for a
recording that slightly overruns the call) and
`PRACTICE_MAX_CALL_MINUTES=15`.

**Fix.** Raise the duration limit for this purpose specifically — a call
recording is legitimately twenty times longer than a read-aloud answer, so one
shared constant cannot serve both:

- Give `practice_call` its own cap (960 s at a 15-minute call, or 1260 s at 20)
  rather than raising `MAX_RECORDING_SECONDS` for every purpose, which would
  also let a student upload a 20-minute "read aloud".
- Keep the 15 MB byte cap: it is comfortable at 20 minutes and is the backstop
  if the bitrate is ever raised.
- If the call cap is ever moved to 30 minutes, the **byte** limit has to move
  too (20.6 MB), so the two belong together.

Also note a call recording consumes one of the student's
`MEDIA_DAILY_UPLOAD_LIMIT` (200/day) allowance — not a practical constraint, but
it is the same counter as lesson recordings.

---

## 12. `lib/db` must be built before the API typechecks — medium

**What breaks.** `artifacts/api-server/tsconfig.json` references
`../../lib/db` as a TypeScript **project reference**, so `@workspace/db`
resolves to `lib/db/dist` (declarations) and not to `src`. A stale `dist` makes
the API typecheck against out-of-date types: during development this hid nine
real errors — `peer_call_analysis` missing from the `AITask` union and
`practiceCallEvaluationsTable` not exported — while the source was correct all
along.

**Confirm it.**

```bash
pnpm --filter @workspace/db exec tsc --build      # refresh declarations
pnpm --filter @workspace/api-server exec tsc --noEmit
```

**Fix.** Nothing to change for deployment: the root `typecheck:libs` script
(`tsc --build`) covers CI, and the Docker build compiles from source rather than
declarations. Recorded because it is a trap for anyone verifying locally — in
particular, typechecking *inside the API container* reads whatever `dist` was
baked into the image, which can be days old.

---

## 13. The ASR poll timeout is tight for a full-length call — high

**What breaks.** The AssemblyAI adapter waits for a transcript with:

```
AI_ASR_TIMEOUT_MS      = 60000    # 1 min, per HTTP request
AI_ASR_POLL_TIMEOUT_MS = 180000   # 3 min, total wait for the transcript
```

Neither is passed through compose or `render.yaml`, so both run on these
defaults. Three minutes was sized for a 30-second read-aloud. A **20-minute
multichannel** job is a different shape of work — two channels transcribed
separately, and a queue that can sit before it starts — so it can exceed three
minutes and fail with a timeout.

The failure is handled rather than silent: the evaluation goes to `failed`, the
recording is deleted, and the analysis allowance is refunded. But the student
asked for feedback and gets none, which is the outcome worth avoiding.

**Fix.** Pass both through (same change as #1 and #10) and raise the poll
timeout for peer calls — 600000 ms (10 min) gives a 20-minute stereo job ample
room without leaving a stuck job waiting forever. The per-request timeout can
stay at 60 s: it bounds one poll, not the whole wait.

Worth confirming empirically on the first real long call: the adapter logs the
elapsed time, so one 20-minute evaluation tells you whether 3 minutes was ever
close.

---

## 14. The Anthropic provider is a new adapter — verify it on the deploy

**What to know.** `services/ai-providers/anthropic.ts` is new on this branch, as
is the router in `ai-providers/index.ts` that picks an adapter from the
provider's base URL. Anthropic is not OpenAI-shaped: a different auth header
(`x-api-key` plus `anthropic-version`), a different request body, and a
different usage block.

Two things follow for a deploy:

- **Outbound HTTPS to `api.anthropic.com` and `api.assemblyai.com` must work.**
  In development this needed DNS and IPv4-first workarounds
  (`docker-compose.override.yml` pins public resolvers and sets
  `NODE_OPTIONS=--dns-result-order=ipv4first`, because the container had only a
  link-local IPv6 route and every other call failed `EAI_AGAIN`). That override
  is **local-only and not committed** — a managed platform will not have the
  same problem, but it is the first thing to check if AI calls time out after
  deploying.
- **The adapter is selected by base URL.** An admin who types the wrong base URL
  gets the OpenAI adapter pointed at Anthropic, which fails on the first call
  rather than at save time.

**Confirm it.** After setup, submit one open-ended answer and check
`ai_usage_logs` has a row with non-null `prompt_tokens` and `cost_usd`.

---

## 15. AI usage accounting — verify after any database rebuild

**What breaks.** `recordUsage` inserts `task`, `prompt_tokens` and
`completion_tokens`. Those columns were missing from the migration set — 016
indexed `task` without ever creating it — so on a freshly migrated database
**every usage write failed silently**, usage logging is deliberately
fire-and-forget so a logging failure cannot break a student's lesson, and the
result was an admin panel reading **$0** with the monthly budget ceiling unable
to fire. The AI was running with no accounting at all.

Fixed on this branch (016 adds `task` and backfills from `feature`; 007 supplies
the token split). Listed because it is **silent when wrong**, so it is worth one
positive check rather than trust.

**Confirm it.**

```sql
select task, prompt_tokens, completion_tokens, cost_usd
  from ai_usage_logs order by id desc limit 5;
```

Rows with null `task`, or no rows at all after a known AI call, mean the writes
are failing again.

---

## 16. Migration idempotency depends on one list staying in step

**What breaks.** `drizzle-kit push` runs before the SQL migrations on every
deploy, and it **drops every CHECK constraint** on `ai_task_settings`, because
the Drizzle schema expresses the task list as a TypeScript enum rather than a
database constraint. Migration 006 therefore re-creates the constraint on every
migration — its `IF NOT EXISTS` guard is not a one-time thing.

That makes 006's task list load-bearing for every future task. If it lags behind
`AI_TASKS` in `lib/db/src/schema/ai.ts`, the **first redeploy** after a new task
is added fails with `check constraint … is violated by some row`, because a row
for the new task already exists and the re-created constraint forbids it.

This actually happened on this branch with `peer_call_analysis`: run 1 of the
migrations succeeded and run 2 failed. A deploy does run 2; a fresh install does
not — which is exactly the kind of failure that reaches production.

**Fix.** Already fixed: 006 now carries the full list including
`peer_call_analysis`, and 017 no longer redefines the constraint.

**Confirm it.** Run the migrations **three times** against a scratch database —
this was verified green before staging:

```bash
createdb migtest
DATABASE_URL=...migtest node scripts/migrate.mjs   # x3, all must say "Migrations complete."
```

Make this part of the release routine whenever a migration is added. Once-is-fine
is not a sufficient test for a migration set.

---

## 17. Plan policies and subscriptions must exist for AI to be allowed

**What breaks.** Quota is resolved per plan, and a user with **no active
subscription row falls back to `free`** — which is `0` for every AI task, so
every feature refuses with `AI_QUOTA_PLAN_INELIGIBLE`. This is correct behaviour
and it cost real debugging time in development, where a test student simply had
no subscription row and every AI feature looked broken.

`ai_plan_policies` is seeded by migrations 006/016/017 for `free`,
`general_english`, `professional_english` and `admin`.

Two deployment consequences:

- **Any new plan code needs policy rows**, or students on it get nothing. The
  `$5`/`$7` tiers in the plan spec do **not** exist as plan codes yet — only
  `general_english` ($2) and `professional_english` ($4) — so adding them means
  adding `ai_plan_policies` rows for every task at the same time.
- **A student with no subscription gets no AI.** Worth deciding deliberately
  whether a trial user should land on `free` (deny) or a trial plan.

**Confirm it.**

```sql
select plan_code, task, daily_limit, monthly_limit, monthly_minutes
  from ai_plan_policies order by plan_code, task;
```

---

## 18. Browser-facing limits that only bite in production

Collected because each is invisible locally and none is a code bug:

- **Secure context** (#3) — no microphone over plain HTTP.
- **Bucket CORS** (#4) — the browser PUTs the call recording directly to object
  storage. A missing `PUT` rule from the app origin fails the upload with no
  useful error in the response.
- **Frontend bundle is 909 kB** (255 kB gzipped) and Vite warns about it. Not a
  blocker, but first paint on a slow mobile connection is the experience most of
  these students will have. Code-splitting the CMS and admin routes would be the
  obvious win, since no student loads them.
- **`APP_BASE_URL`** must point at the deployed frontend: it is what
  password-reset links are built from. Already in compose and asked for by the
  Render blueprint — worth confirming it is not left as `localhost:5173`.

---

## Verification order

Ordered so each step's prerequisites are already done, and so the silent
failures are forced into the open early.

**Before deploying**

1. Run the migrations **three times** against a scratch database (#16). A single
   green run does not prove idempotency, and a deploy is always run ≥2.
2. `pnpm --filter @workspace/db exec tsc --build` then typecheck both packages
   (#12) — the API typechecks against `lib/db/dist`, not source.
3. Pass the 22 environment variables through compose and `render.yaml` (#1).
4. Add `STORAGE_PUBLIC_ENDPOINT` to `render.yaml` and set bucket CORS for `PUT`
   from the app origin (#4, #18).

**After deploying, before telling anyone to use it**

5. Complete the **post-deploy AI setup** at the top of this file: providers,
   keys, prices, per-task models, enable, budget.
6. Submit one open-ended answer and confirm `ai_usage_logs` has a row with
   non-null `task`, `prompt_tokens` and `cost_usd` (#14, #15). This single check
   catches a wrong base URL, a missing key, blocked outbound HTTPS, and broken
   usage accounting at once.
7. Take one full lesson, including the AI tutor conversation.

**Then calls**

8. Confirm a call connects between **two separate devices on different
   networks** — over HTTPS (#3). Two browsers on one machine never exercise
   TURN.
9. Stand up coturn, set the three TURN variables, confirm a call succeeds on
   **mobile data** (#2). This is the only test that proves the relay.
10. Raise the `practice_call` duration cap and run one evaluation on a call
    **longer than ten minutes** (#11) — the limit is invisible on short calls.
    Watch the ASR elapsed time against the 3-minute poll timeout (#13).
11. Watch `practice_call_evaluations.error` and `ai_usage_logs` for the first
    real evaluations. Re-derive the cost model from logged rows once ASR is
    priced per minute (#7).

## Code changes still outstanding

Everything else on the list is configuration. These need code:

| # | Change | Why |
|---|---|---|
| ~~7~~ | ~~Price speech providers per minute~~ | **Done.** `ai_providers.price_per_minute` (migration 020) and `computeAudioCostUsd`, charged per billed channel. Enter the rate at setup or it stays null |
| ~~11~~ | ~~Per-purpose media duration cap~~ | **Done.** `MAX_CALL_RECORDING_SECONDS = 960` for `practice_call` only |
| ~~13~~ | ~~Raise the ASR poll timeout~~ | **Done.** `AI_ASR_POLL_TIMEOUT_MS` now 600000 and passed through |
| ~~8~~ | ~~`last_seen_at` on `practice_sessions`~~ | **Done.** Migration 019 adds a timestamp per participant, swept every 15 s — lockout is ~45 s, not ~32 min |
| 5 | BullMQ job backend | **Still open, and correct to defer at one instance.** Required before running a second: jobs are per-process, so instance A's work is lost if A restarts, and every instance sweeps |

## What is already working

Verified end to end in development, so these are not on the list:

**AI integration**
- Anthropic (Haiku 4.5) for the tutor conversation, open-answer grading,
  pronunciation feedback and peer-call analysis; AssemblyAI for all speech.
- Voice out is the browser's own `speechSynthesis` — no paid TTS, no per-character
  bill, and the voice-selection ranking now prefers neural voices.
- Pronunciation and fluency **scores are arithmetic**, not model output, so they
  are reproducible and defensible on appeal; the model writes only the advice.
- `HISTORY_WINDOW = 12` caps conversation prompt growth, which is why per-turn
  cost stays flat instead of compounding.
- Per-plan daily and monthly quotas, with allowances **refunded** when a failure
  spent nothing.

**Peer calls**
- Matching, ringing, accept/decline, blocking, reporting, the moderator queue.
- Signalling over Postgres with HTTP polling — no WebSocket, no sticky sessions,
  and multi-instance safe as-is.
- Two-sided consent before any audio is accepted; a decline is permanent;
  non-participants cannot even learn a call exists.
- Stereo recording (own microphone left, peer right) giving **exact** speaker
  attribution, with an honest uncertainty warning on the mono fallback.
- Diarized multichannel ASR → per-speaker Arabic and English feedback, each
  student seeing only their own.
- The recording is deleted once the transcript exists, including on failure.

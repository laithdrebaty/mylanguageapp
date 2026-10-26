---
name: Deploy to DigitalOcean
description: Step-by-step deployment of the API, frontend, Postgres, Valkey and Spaces on DigitalOcean, with Cloudflare for TURN. Written to be followed once, in order, by someone who did not build the app.
---

# Deploying to DigitalOcean

The target: **one DO project** holding the API, Postgres, Valkey (Redis) and
Spaces, plus **Cloudflare** for the TURN relay and an email provider for
password resets.

Everything stateful lives in one region so database round trips never leave the
datacentre. The API makes several Postgres and Valkey calls per request, so this
is the difference between a fast page and a slow one.

Read [features/peer-calls-deployment-checklist.md](./features/peer-calls-deployment-checklist.md)
alongside this file. It is the authority on *why* each variable and cap matters;
this file is the order to do things in.

---

## The plan, and what it costs

| Piece | Spec | Monthly |
|---|---|---|
| API — App Platform, **1 instance** | Professional, 1 vCPU / 1 GB | $12.00 |
| Postgres 17 — Managed, **single node** | 1 vCPU / 1 GB / 10 GB | $15.15 |
| Valkey — Managed Caching | 1 vCPU / 1 GB | $15.00 |
| Spaces | 250 GB + 1 TB transfer, CDN included | $5.00 |
| Frontend — App Platform static site | — | $0–3 |
| TURN — Cloudflare Realtime | within 1,000 GB/mo free | $0.00 |
| Email — Brevo or Resend | free tier | $0.00 |
| **Total** | | **~$47–50** |

List prices, not a quote. Confirm at checkout, and confirm **PITR and backup
retention** on the Postgres tier — a single-node database makes backups the only
recovery path, so their retention is the thing that matters most here.

### Why one API instance, not two

`JOB_QUEUE=memory` today. Jobs run in-process (`jobs.ts`), so a second instance
would not share them, and the grading sweeper would run on **both** instances
duplicating work — checklist #6. One instance is the correct configuration until
the BullMQ backend exists.

Instance count on App Platform is a slider, so **adding the second instance
later needs no code change and no redeploy of the repo.** The order is: deploy at
1 → implement BullMQ (#5) → scale to 2. Doing it the other way round buys
duplicated work rather than redundancy.

The cost of one instance: a deploy is a short gap in service, and a crash is an
outage until the platform restarts the container. Acceptable at launch, and the
fix is $12 once BullMQ lands.

### Postgres without a standby

Single node is $15.15; adding a standby is $30.45. Without it, a database
failure is downtime until a human restores from backup.

That trade is only sound if **someone is reachable when it happens.** If this app
is handed over and nobody is watching it, revisit the standby — it is the
cheapest single purchase that prevents an unattended outage.

---

## Phase 0 — before touching DigitalOcean

These are repo changes. They are the reason a deploy works at all, and they are
cheaper to do now than to debug against a live app.

### 0.1 Pass the environment variables through

Checklist #1, and the highest-leverage item on the whole list. `render.yaml` and
`docker-compose.yml` both pass an **allowlist**; every variable outside it is
silently ignored. Today that silently pins TURN (#2), call length (#9), rate
limits (#10) and the ASR timeouts (#13) to their code defaults.

`.env.example` already documents 46 keys. The App Spec in phase 2 must carry the
ones that matter in production — the table in checklist #1 is the list.

### 0.2 Raise the recording cap for call recordings

Checklist #11, a **blocker for call evaluation**. `MAX_RECORDING_SECONDS = 600`
in `services/storage.ts` is applied to every purpose including `practice_call`,
so any call longer than ten minutes is refused at upload and can never be
evaluated.

Give `practice_call` its own cap (960 s for a 15-minute call) rather than raising
the global constant, which would also let a student upload a 20-minute "read
aloud". Set `PRACTICE_MAX_CALL_MINUTES=15` to match (#9).

### 0.3 Verify migration idempotency

Checklist #16. `drizzle-kit push` drops the CHECK constraints on
`ai_task_settings` on every deploy, so migration 006 re-creates them every time.
A deploy is always run ≥2, and run 2 is the one that fails if 006's task list
lags the schema.

```bash
createdb migtest
DATABASE_URL=...migtest node scripts/migrate.mjs   # three times, all green
```

This already failed once on this branch with `peer_call_analysis`. Make it part
of the release routine whenever a migration is added.

### 0.4 Typecheck from a fresh `lib/db` build

Checklist #12. The API typechecks against `lib/db/dist`, not source, so a stale
`dist` hides real errors.

```bash
pnpm --filter @workspace/db exec tsc --build
pnpm --filter @workspace/api-server exec tsc --noEmit
```

### 0.5 Implement the mailer

Not in the peer-calls checklist because it is auth scope, but it is a live
problem: `services/mailer.ts` is a stub that writes the message to the log and
reports `configured: false`, which is why the password-reset endpoint returns the
reset link **in the API response**. On a public URL that is a vulnerability.

Implement `MailProvider` against Brevo or Resend and return it from
`createMailer()`. Nothing above that file changes.

---

## Phase 1 — provision the infrastructure

Create everything in **one region** and keep it consistent. Frankfurt (`fra1`)
is the reasonable choice: it is close to Syrian learners and not far from the
US-hosted AI providers.

### 1.1 Postgres

DO → Databases → Create → **PostgreSQL 17**, region `fra1`, single node, 1 GB.

Take the connection string. DO offers a **private network** URI — use that one
once the app is in the same VPC; it keeps database traffic off the public
internet and is faster.

Note the **trusted sources** setting: lock the database to the App Platform app
rather than leaving it open.

### 1.2 Valkey (Redis)

DO → Databases → Create → **Valkey**, same region, 1 GB.

Valkey is the open-source Redis fork; it is protocol-compatible, so `ioredis` and
`REDIS_URL` work unchanged. Two things to get right:

- **TLS.** Managed Valkey needs `rediss://`, not `redis://`. Wrong scheme, no
  connection.
- **Eviction policy.** Development uses `allkeys-lru` (a cache). That is wrong
  once BullMQ stores jobs here, because LRU can evict queued jobs under memory
  pressure. Check what the managed default is and prefer a `noeviction`-style
  policy before BullMQ goes in.

Redis is **not optional**: `ai-quota.ts` uses `withRedisCritical`, so AI features
fail closed when it is unreachable. See [redis-arch.md](./redis-arch.md).

### 1.3 Spaces

DO → Spaces → Create, same region. Then:

- Create the bucket (e.g. `ascension-media`). Keep it **private** — every read
  goes through a presigned URL, so public listing buys nothing and exposes
  students' recordings.
- Generate a **Spaces access key** pair (Settings → API → Spaces Keys). This is
  a separate credential from a DO API token, and the secret is shown **once**.
- **Set CORS before testing an upload.** The browser PUTs the recording
  straight to Spaces, so without this the upload fails with no useful error in
  the response (checklist #4, #18).

CORS, on the bucket's Settings tab:

| Field | Value |
|---|---|
| Origin | the deployed frontend URL — the exact scheme and host, no trailing slash |
| Allowed methods | `GET`, `PUT` |
| Allowed headers | `*` (at minimum `content-type`) |
| Max age | `3600` |

`PUT` is the upload. `GET` is playback — a student listening back to their own
recording also fetches it from Spaces directly.

Spaces is S3-compatible, so the app needs an endpoint and a key pair and nothing
else. Use **virtual-host addressing**: `STORAGE_FORCE_PATH_STYLE=false`.

What to carry into phase 2: `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`,
`STORAGE_SECRET_ACCESS_KEY`. The endpoint and region are already filled in for
`fra1` in `.do/app.yaml`.

### 1.4 Cloudflare TURN

Cloudflare dashboard → Realtime → TURN. Create a key; it gives you a URL,
username and credential.

1,000 GB/mo is free, then $0.05/GB. A relayed call leg is roughly 20–30 MB, so
the free tier covers a lot. This supersedes the checklist's advice to self-host
coturn, which was written when managed TURN was assumed to be metered from the
first byte.

Include the **`turns:` (TLS, port 443)** form alongside `turn:` — that is the
variant that gets through firewalls blocking UDP, which is a large share of the
students this feature exists for. `PRACTICE_TURN_URLS` takes a comma-separated
list, so both go in one value:

```
PRACTICE_TURN_URLS=turn:<host>:3478,turns:<host>:5349
PRACTICE_TURN_USERNAME=<from Cloudflare>
PRACTICE_TURN_CREDENTIAL=<from Cloudflare>
```

Cloudflare's TURN credentials are **short-lived by default**. If the dashboard
offers a static long-lived username and credential, take those: the app reads
these three values from the environment at startup and serves them from
`GET /practice/ice-servers`, with no mechanism for minting a fresh pair per
call. Credentials that expire would make calls start failing silently some time
after deploy, which is the hardest kind of fault to connect back to its cause.

No application code changes: ICE config is already served from that endpoint
rather than bundled, so the credentials never reach the JS bundle.

### 1.5 Email provider

Brevo (300/day free) or Resend (3,000/mo free). Either works — `services/mailer.ts`
implements both.

1. Create an account and **verify the sending domain**. An unverified domain is
   the usual reason a provider accepts the key and then refuses every message.
2. Create an API key.
3. Decide the sending address.

Three variables for phase 2:

| Variable | Value |
|---|---|
| `MAIL_PROVIDER` | `brevo` or `resend` — lowercase, exactly |
| `MAIL_FROM` | `no-reply@yourdomain.com`, or `لُغتي <no-reply@yourdomain.com>` |
| `MAIL_API_KEY` | the provider's key |

Any other value for `MAIL_PROVIDER`, or a missing key or from-address, falls
back to the log provider and logs a warning saying which part is absent — the
server still starts. That is deliberate, but it means a typo here looks like
"password reset silently does nothing" rather than an error, so check the logs
after the first deploy.

### 1.6 AI provider accounts

Not environment variables — these keys are entered in the admin panel after
deploy (phase 4), because an API key cannot live in version control and the
panel encrypts them with `AI_CONFIG_SECRET`. Get them now so phase 4 is not
blocked on signing up for something.

| What | Where | Used for |
|---|---|---|
| **Anthropic** API key | console.anthropic.com | The tutor conversation, open-answer grading, pronunciation feedback, peer-call analysis |
| **AssemblyAI** API key | assemblyai.com | All speech — read-aloud, spoken answers, peer-call transcripts |

Also note the **rates**, because the panel asks for them and spend is invisible
without them:

- Claude Haiku 4.5 — **$1** per MTok input, **$5** per MTok output
- AssemblyAI Universal-2 — **$0.0025** per minute

Confirm both against the providers' current pricing pages rather than trusting
these; they are what the cost model assumes, not a quote.

### 1.7 Generate the two secrets

Both are needed in phase 2, and one of them can never be changed afterwards.

```
openssl rand -hex 64   # SESSION_SECRET
openssl rand -hex 32   # AI_CONFIG_SECRET
```

**Record `AI_CONFIG_SECRET` somewhere durable before you paste it.** It encrypts
every stored AI provider key; rotating or losing it makes all of them
undecryptable and they must be re-entered by hand. It is the one value in this
deployment with no recovery path.

---

## Phase 2 — deploy the API

DO → Apps → Create App → from the GitHub repo, branch of your choice.

- **Dockerfile**, build target `api`. The repo's `Dockerfile` already produces a
  production API image, so nothing needs rewriting.
- **Instance**: Professional 1 vCPU / 1 GB, **count 1**.
- **Health check**: `/api/healthz`. Already exempt from the rate limiter, which
  matters because a probe answering 429 reads as "server down" (#10).
- **HTTP port**: 8080.

### Environment variables

Everything below must be set on the app. `.env.example` documents all of them;
the groups in checklist #1 explain why each one is here rather than left to a
code default.

**Core**

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `8080` |
| `DATABASE_URL` | the private-network Postgres URI |
| `REDIS_URL` | the Valkey URI, **`rediss://`** |
| `SESSION_SECRET` | `openssl rand -hex 64` — secret |
| `AI_CONFIG_SECRET` | `openssl rand -hex 32` — secret, **never rotate** |
| `ALLOWED_ORIGIN` | the frontend URL |
| `APP_BASE_URL` | the frontend URL — password-reset links are built from it (#18) |
| `TRUST_PROXY` | `1` behind App Platform's load balancer |
| `LOG_LEVEL` | `info` |
| `JOB_QUEUE` | `memory` until BullMQ exists |
| `API_DOCS_ENABLED` | leave unset — Swagger stays off in production |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | the first administrator. **Change from the documented default**; 8+ chars with a letter and a number |

**`AI_CONFIG_SECRET` is the one value that can never change.** It encrypts the
provider API keys stored by the admin panel; rotating it makes every stored key
undecryptable and they must all be re-entered.

**Storage**

| Variable | Value |
|---|---|
| `STORAGE_ENDPOINT` | `https://fra1.digitaloceanspaces.com` |
| `STORAGE_PUBLIC_ENDPOINT` | same — the browser reaches Spaces directly (#4) |
| `STORAGE_REGION` | `fra1` |
| `STORAGE_BUCKET` | your bucket name |
| `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY` | Spaces key pair — secret |
| `STORAGE_FORCE_PATH_STYLE` | `false` |
| `MEDIA_DAILY_UPLOAD_LIMIT` | `200` |

`STORAGE_PUBLIC_ENDPOINT` matters because SigV4 signs the Host header: a
presigned URL cannot be rewritten after signing, so the browser-facing address
has to be right at signing time.

**Calls and TURN**

| Variable | Value |
|---|---|
| `PRACTICE_STUN_URLS` | leave default, or Google's STUN servers |
| `PRACTICE_TURN_URLS` | from Cloudflare, including the `turns:` form |
| `PRACTICE_TURN_USERNAME` / `PRACTICE_TURN_CREDENTIAL` | from Cloudflare — secret |
| `PRACTICE_MAX_CALL_MINUTES` | `15` (#9, #11) |
| `PRACTICE_DAILY_CALL_LIMIT` | `20` |
| `PRACTICE_RING_TIMEOUT_MS` | `45000` |
| `PRACTICE_CONNECT_TIMEOUT_MS` | default |

**Rate limits** — `RATE_LIMIT_API`, `RATE_LIMIT_AUTH`,
`RATE_LIMIT_PRACTICE_POLL`, `RATE_LIMIT_WINDOW_MS`. Pass them so they can be
raised without a rebuild. A call polls two endpoints every second.

**AI timeouts** — `AI_REQUEST_TIMEOUT_MS`, `AI_MAX_ATTEMPTS`,
`AI_ASR_TIMEOUT_MS`, and `AI_ASR_POLL_TIMEOUT_MS`. Raise the last one to
`600000` (10 min): the default 180000 was sized for a 30-second read-aloud and is
tight for a 15-minute multichannel job (#13).

**Grading sweeper** — `GRADING_SWEEP_ENABLED`, `GRADING_SWEEP_INTERVAL_MS`,
`GRADING_SWEEP_STALE_MS`, `GRADING_SWEEP_MAX_ATTEMPTS`, `GRADING_SWEEP_BATCH`.
The sweeper is the **only** recovery path for a job lost to a restart while
`JOB_QUEUE=memory` (#5), so do not set the interval high. The free-tier value of
3600000 in `render.yaml` existed only to let a scale-to-zero database sleep —
it is wrong here.

**Database pool** — `DB_POOL_MIN` / `DB_POOL_MAX`. The `render.yaml` values
(`min: 0`) were also a scale-to-zero workaround. Set `DB_POOL_MAX` deliberately
against the managed tier's connection limit, and remember it multiplies by
instance count when you scale to 2.

**Email** — whatever the provider implementation in 0.5 reads.

### Run the migrations

Not automatic, deliberately: a rollout must not be able to mutate the schema
silently.

```bash
DATABASE_URL=<the DO Postgres URI> pnpm run migrate
DATABASE_URL=<the DO Postgres URI> pnpm run seed
```

Both are idempotent. Re-run after any future schema change.

---

## Phase 3 — deploy the frontend

A static Vite bundle. Add it as a **static site component** in the same App
Platform app:

- Build: `pnpm --filter @workspace/ascension run build`
- Output: `artifacts/ascension/dist/public`

**Route `/api` to the API component.** The app calls relative `/api` paths, so
proxying keeps the browser on one origin: session cookies stay first-party and no
CORS or `sameSite: none` configuration is needed. `vercel.json` shows the same
rewrite shape.

HTTPS is automatic, and it is **required** — `getUserMedia` and `MediaRecorder`
only work in a secure context, so calls fail at microphone access over plain
HTTP (#3).

---

## Phase 4 — post-deploy AI setup

**A fresh deploy has AI switched off and no providers.** Nothing is broken; it is
simply not configured. Migration 006 inserts `ai_settings (enabled=FALSE)` and
seeds task rows with no provider, because an API key cannot live in version
control.

Follow the **post-deploy AI setup** section at the top of the peer-calls
checklist: add the Anthropic chat provider with its per-MTok prices, add
AssemblyAI for speech, point each task at a provider and model, enable the tasks,
flip `ai_settings.enabled` on, and set the monthly budget.

**Set `price_per_minute` on the AssemblyAI provider** (0.0025). Transcription is
sold per minute of audio, not per token, so the two per-MTok fields do not apply
to it — leaving the per-minute rate blank records a null cost on every
transcription, and the monthly budget ceiling sums costs, so it would not see
ASR spend at all. That matters more than it sounds: multichannel ASR is roughly
**90% of what an evaluated peer call costs**.

The checklist still lists this as an open item (#7) because it was written
before the field existed. The column and the cost path are in place; entering
the rate here is what switches them on.

Then the one check that catches four failures at once (#14, #15): submit one
open-ended answer and confirm `ai_usage_logs` has a row with non-null `task`,
`prompt_tokens` and `cost_usd`. A missing row means a wrong base URL, a missing
key, blocked outbound HTTPS, or broken usage accounting.

Also confirm `ai_plan_policies` has rows for every plan code in use (#17). A
student with **no subscription row falls back to `free`**, which is 0 for every
task — every AI feature then refuses with `AI_QUOTA_PLAN_INELIGIBLE`, which looks
like a bug and is not.

---

## Phase 5 — verify, in this order

The checklist's verification order, adapted. Each step's prerequisites are
already done, and the silent failures are forced out early.

1. **Take one full lesson**, including the AI tutor conversation.
2. **Connect a call between two separate devices on different networks**, over
   HTTPS. Two browsers on one machine use host candidates and never exercise
   TURN, so this is the only test that proves anything.
3. **Confirm a call succeeds on mobile data** — this is what proves the relay.
4. **Run one evaluation on a call longer than ten minutes** (#11). The duration
   cap is invisible on short calls. Watch the ASR elapsed time against the poll
   timeout (#13).
5. **Watch `practice_call_evaluations.error` and `ai_usage_logs`** for the first
   real evaluations.

---

## Phase 6 — make it survivable without you

If this app is handed over, these are not optional.

- **Alerts to an address someone reads.** DO can alert on CPU, memory and
  database connections. Without this, "no downtime" means "nobody notices the
  downtime."
- **One tested restore.** Managed backups are only real once somebody has
  restored from them. Do it before handover and write down the steps — with a
  single-node database this is the entire recovery plan.
- **Hand over the secrets inventory**, and flag `AI_CONFIG_SECRET` specifically:
  rotating it makes every stored AI provider key undecryptable.
- **Re-run the three-times migration test** on every release that adds a
  migration (#16).

---

## What to do as the app grows

In the order these actually bite:

| Signal | Lever |
|---|---|
| Deploys cause visible gaps; a crash is an outage | Implement BullMQ (#5), then **scale to 2 instances** — $12 |
| Postgres CPU climbing | Larger tier; add the standby while you are there |
| Grading falls behind | Separate job workers: same image, different start command, scaled independently. Cheap **because** BullMQ exists |
| Call setup latency rising | `practice_signals` polling is the pressure point. The hook declined a WebSocket deliberately — revisit then, not now |
| TURN past 1,000 GB/mo | $0.05/GB, or stand up coturn |
| Spaces past 250 GB | $0.02/GiB. Unlikely: recordings are deleted once transcribed |

**BullMQ is the one that unlocks the others.** It is what makes multiple
instances correct, and what makes separate job workers a deploy-config change
rather than a refactor.

Self-hosting on a cheaper VPS stays a reasonable destination later —
`docker-compose.yml` already defines the whole stack. The trigger should be "the
managed bill exceeds what the ops time is worth", not a user count.

---
name: Deployment notes
description: What has to be configured or changed before this branch runs anywhere but a developer machine.
---

# Deployment notes

Collected while fixing the lesson, media and quiz bugs on
`bugfix/1-fix-uploading-files-bug-and-general-lessons-misbehaviors`.
Nothing here is a code change — it is what a deployment has to get right, and
what will silently half-work if it does not.

---

## Must be set, or a feature is silently dead

### `STORAGE_PUBLIC_ENDPOINT` — the address the **browser** uses

The upload is presigned. SigV4 signs the `Host` header, so a URL rewritten
afterwards fails its own signature: the URL has to be *signed* for the address
the browser will actually call.

- **Unset / wrong** → the browser gets a URL it cannot resolve and every upload
  fails with a bare "Failed to fetch". Nothing in the API logs.
- **R2 / Spaces** → leave unset; the API and the browser use the same host.
- **MinIO or SeaweedFS behind a different hostname** → set it to the public one.

### HTTPS is required for recording, not optional

`navigator.mediaDevices.getUserMedia` does not exist on a non-secure origin.
Not "is blocked" — the API is absent, so there is no permission prompt to
accept. On plain HTTP at an IP address:

- Pronunciation blocks cannot record.
- Speaking blocks cannot record.
- The CMS media picker cannot record (it hides the button and says why).

So **the deployed frontend and API must both be HTTPS**, or two of the
product's headline features do not work at all. `localhost` is the only
exception, which is why this does not show up in local development.

### `SESSION_SECRET` and `AI_CONFIG_SECRET`

Both fall back to insecure development defaults in `docker-compose.yml`.
Generate real ones (`openssl rand -hex 64` and `-hex 32`). Without a real
`AI_CONFIG_SECRET` the admin panel refuses to store a provider API key at all,
rather than writing it in plaintext — which is correct, but looks like a bug.

### `REDIS_URL`

Required for any AI feature. The AI quota counter fails **closed** when Redis is
unavailable, so every AI call is refused without it. Caching and rate limiting
degrade to per-process.

---

## Storage

MinIO images now require authentication on both Docker Hub and quay.io — every
tag, not just `latest`. The compose file uses **SeaweedFS** instead, which
serves the same S3 API and needs no application code change.

For production use **Cloudflare R2** (no egress fees — every audio playback is a
download) or DigitalOcean Spaces. Required:

- `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`
- `STORAGE_ENDPOINT`, and `STORAGE_REGION=auto` for R2
- `STORAGE_FORCE_PATH_STYLE=false` for R2, `true` for MinIO/SeaweedFS
- **CORS on the bucket** allowing `PUT` from the web origin — the browser
  uploads directly, so without it every upload is blocked by the browser.

The AWS SDK checksum fix in `services/storage.ts`
(`requestChecksumCalculation: "WHEN_REQUIRED"`) matters here: R2 and MinIO
verify the CRC32 the same way SeaweedFS does, so this would have failed in
production too.

---

## Database

`artifacts/api-server/migrations/014_referral_source.sql` must run. It is
idempotent (`ADD COLUMN IF NOT EXISTS`), and the compose `migrate` service
applies it automatically.

Existing rows get `referral_source = NULL` and report as "unknown" in the admin
breakdown — expected, since those accounts predate the question.

---

## Still to do before this is a production deployment

Not blockers for this branch, but known and unfinished:

| Area | What is missing |
|---|---|
| Tests | None of these fixes has one. Quiz level gating and multi-question grading are the two worth covering first. |
| Payment | No activation path exists; every subscription is stranded at `pending_payment`. See `payment-methods-research.md`. |
| Paywall | `subscription_plans.lessonsAccess` is read by no route — every student has full access regardless of plan. |
| Email | No provider configured, so there is no password reset. A forgotten password is permanent account loss. |
| Session roles | `req.session.role` is copied at login and never rechecked on a 30-day cookie, so a demotion or ban takes up to a month to take effect. |
| TURN | `PRACTICE_TURN_URLS` is empty, so voice practice is STUN-only and roughly one call in five will not connect. |
| AI | No provider configured. Speaking and pronunciation submissions stay `pending` and fall to the human queue at `/cms/grading` — correct behaviour, but nothing alerts when that queue grows. |

---

## Developer-experience note

The API container has no source bind mount, so every backend change needs a full
`docker compose build --no-cache api` plus `up -d --force-recreate api` —
several minutes. The web container hot-reloads because its `src` is mounted.

Mounting the API source and running it under `tsx watch` would make backend
changes reload in seconds. Compose-only change; no application code.

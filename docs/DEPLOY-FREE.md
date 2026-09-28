# Free deployment

Everything on free tiers, no credit card: frontend on Vercel, API on Render,
PostgreSQL on Neon, Redis on Redis Cloud. Audio storage is optional and can be
added later (Backblaze B2). See [DEPLOYMENT.md](DEPLOYMENT.md) for why the API
cannot run on Vercel itself.

| Piece | Service | What "free" costs you |
| --- | --- | --- |
| Frontend | Vercel Hobby | Non-commercial use only — move to Netlify once you charge money |
| API | Render free | Sleeps after 15 min idle, 30–60 s to wake on the next request |
| PostgreSQL | Neon free | ~0.5 GB; suspends when idle, wakes on the next connection in ~1 s |
| Redis | Redis Cloud free | 30 MB, no command cap |
| Audio (optional) | Backblaze B2 | 10 GB |

Pick the **same region** everywhere (Frankfurt / AWS `eu-central-1` below).
Every API request makes several database and Redis round trips; crossing an
ocean on each one makes every page slow.

The repo stays **private** — Render and Vercel both deploy private GitHub repos
on their free plans.

## 1. Neon — PostgreSQL

1. Sign up at neon.tech → create a project: Postgres **17**, region **AWS Europe Central 1 (Frankfurt)**.
2. Copy the connection string (Dashboard → Connect). Keep the whole thing, including `?sslmode=require...`.

## 2. Redis Cloud

1. Sign up at redis.io/try-free → create a **free** database on AWS `eu-central-1`.
2. Build the URL from the database page: `redis://default:<password>@<public-endpoint>`
   (use `rediss://` instead if TLS is enabled on it).

Without Redis the app runs, but every AI feature is refused: the AI quota check
fails closed.

## 3. Create the schema

From the repo root:

```
pnpm run deploy:setup
```

Paste the Neon string at the first prompt; leave the second one empty for now.
It runs `migrate` and `seed` against Neon. Both are idempotent — re-run it after
any future schema change.

## 4. Render — API

1. Push the repo to GitHub.
2. Sign up at render.com with GitHub → **New → Blueprint** → pick the repo.
   Render reads [`render.yaml`](../render.yaml) and generates `SESSION_SECRET`
   and `AI_CONFIG_SECRET` itself.
3. Fill in the values it asks for:
   - `ADMIN_EMAIL` / `ADMIN_PASSWORD` — your first admin login. **Do not leave
     blank:** the fallback is `admin@example.com` / `admin@1234`
   - `DATABASE_URL` — Neon string from step 1
   - `REDIS_URL` — from step 2
   - `ALLOWED_ORIGIN` — leave as a placeholder for now; set after step 5
   - `STORAGE_*` — leave all blank (see [Audio storage](#audio-storage-later))
4. Deploy, then open `https://<name>.onrender.com/api/healthz` — it should return `{"status":"ok"}`.

## 5. Vercel — frontend

1. Run `pnpm run deploy:setup` again: empty first prompt, your Render URL at the
   second. It writes the Render host into `vercel.json`'s `/api` rewrite.
2. Commit and push.
3. Sign up at vercel.com with GitHub → **Add New → Project** → import the repo.
   Leave the root directory as the repo root and framework as "Other" —
   `vercel.json` supplies the build command and output folder.
4. Back in Render, set `ALLOWED_ORIGIN` to the Vercel URL (`https://<app>.vercel.app`).

## 6. Keep the API awake (optional)

Render wakes by itself on the next request; the app pings it on page load and
shows "Waking up the server…" if it is slow. To avoid the wait entirely, create
a free job at cron-job.org that requests

```
https://<name>.onrender.com/api/healthz
```

every **10 minutes**. That endpoint does not touch the database, so Neon still
sleeps. One service awake all month (~730 h) fits in Render's 750 free hours.

## What keeps this inside the free tiers

Set in `render.yaml`; change them there, not in the dashboard.

- `DB_POOL_MIN=0` — idle pool connections would stop Neon from ever suspending.
- `GRADING_SWEEP_INTERVAL_MS=3600000` — the grading sweeper queries hourly instead of every 10 minutes.
- `SESSION_PRUNE_INTERVAL_S=21600` — expired sessions are cleaned every 6 hours instead of every 15 minutes.

## Audio storage (later)

Voice recordings return 503 until storage is configured; everything else works.
When needed, Backblaze B2 (backblaze.com, 10 GB free, no card):

1. Create a **private** bucket and an application key limited to it.
2. In Render set `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID` (key ID),
   `STORAGE_SECRET_ACCESS_KEY` (application key),
   `STORAGE_ENDPOINT=https://s3.<region>.backblazeb2.com` and
   `STORAGE_REGION=<region>` — the region is in the bucket's S3 endpoint, e.g. `eu-central-003`.
3. The browser uploads straight to the bucket, so the bucket needs a CORS rule
   allowing `PUT` and `GET` from the Vercel origin. B2's web UI only offers
   download rules; this one has to be set through the S3 API (`PutBucketCors`).

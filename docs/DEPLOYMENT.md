# Deployment

The frontend and the API deploy separately. The frontend is a static Vite bundle
and goes anywhere; the API is a long-running Express server that expects
persistent PostgreSQL and Redis connections.

## Why the API does not belong on Vercel

Four things in the API assume a process that stays alive between requests:

- **`lib/db` opens a connection pool** (`min: 2, max: 10`) at module load. Each
  serverless instance would open its own, exhausting PostgreSQL connections
  under load. A serverless deployment needs a connection pooler in front
  (Neon/Supabase pooler, or PgBouncer).
- **Sessions live in PostgreSQL** via `connect-pg-simple`, adding a database
  round-trip to every request on top of the pool problem.
- **Redis is a long-lived `ioredis` client** used for caching, shared rate
  limits, and AI quota enforcement. Serverless would need an HTTP-based Redis
  (e.g. Upstash REST) instead.
- **Logging uses pino worker threads** (`esbuild-plugin-pino` bundles
  `pino-worker.mjs` and file transports). Worker threads are not usable in
  Vercel functions.

Rewriting around all four is possible, but it is a rewrite, not a config change.

Also check Vercel's plan terms before committing: the Hobby tier is
non-commercial, so a paid product needs Pro. At roughly $20/month that dwarfs
the ~$2/month the AI features are budgeted at.

## Recommended: frontend on Vercel, API on a container host

`Dockerfile` already builds a production API image (`target: api`), so any
container host runs it unmodified — Railway, Render, Fly.io, or DigitalOcean
App Platform.

### 1. Deploy the API

Point the host at this repo's `Dockerfile` with `--target api`. Required
environment variables:

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | Managed PostgreSQL 17 connection string |
| `SESSION_SECRET` | **Required in production.** `openssl rand -hex 64` |
| `NODE_ENV` | `production` |
| `PORT` | Usually injected by the host |
| `ALLOWED_ORIGIN` | Your Vercel URL, e.g. `https://lughati.vercel.app` |
| `TRUST_PROXY` | `1` behind the host's load balancer |
| `REDIS_URL` | Optional, but needed for shared rate limits and AI quota |
| `ADMIN_EMAIL` | The first administrator's address. Defaults to `admin@example.com` |
| `ADMIN_PASSWORD` | That administrator's password. **Change it from the default** |

Then create the schema and baseline data, once, against the production database:

```
DATABASE_URL=... pnpm run migrate
```

```
DATABASE_URL=... pnpm run seed
```

Neither runs automatically on deploy — that is deliberate, so a rollout cannot
silently mutate the production schema.

### The first administrator

The API creates one administrator on start, from `ADMIN_EMAIL` and
`ADMIN_PASSWORD`, and only if no administrator exists yet. Set both in this
deployment's environment before the first start.

**Change `ADMIN_PASSWORD` from the documented default.** `admin@example.com`
with the password written down in a public repository is one of the most
reliably scanned-for ways to lose an application. The password must pass the
same strength rules a student's does (8+ characters, a letter and a number); if
it does not, a warning is logged and no administrator is created.

If you would rather create the account by hand, set `ADMIN_EMAIL` to an address
nobody will register and promote your own account with SQL — once any
administrator exists, this never runs again.

### 2. Deploy the frontend

`vercel.json` in the repo root already sets the monorepo build:

```json
"buildCommand": "pnpm --filter @workspace/ascension run build",
"outputDirectory": "artifacts/ascension/dist/public"
```

**Edit the `/api/:path*` rewrite** to point at the API host from step 1:

```json
{ "source": "/api/:path*", "destination": "https://your-api-host/api/:path*" }
```

That proxy is the important part. The app calls relative `/api` paths, so
proxying keeps the browser on a single origin: session cookies stay first-party
and no CORS or `sameSite: none` configuration is needed. Calling the API host
directly from the browser would require both.

The second rewrite sends everything else to `index.html` for client-side
routing. Vercel checks the filesystem before applying rewrites, so real assets
are served normally.

### 3. Session cookies

`app.ts` sets `secure: true` and `sameSite: 'none'` when `NODE_ENV=production`.
With the proxy above the requests are same-origin, so `sameSite: 'lax'` would be
the stricter and more correct setting. Worth revisiting once the proxy is live.

## Media storage

Video and audio go to S3-compatible object storage (DigitalOcean Spaces,
Cloudflare R2, or S3), never to the API host's disk — the container filesystem
is ephemeral. Uploads should use presigned URLs so files go browser → bucket
directly, bypassing the API entirely. This also sidesteps request body size
limits on every platform involved.

Prefer a zero-egress provider for video. R2 charges nothing for egress; S3
charges roughly $0.09/GB, which at 100 users streaming video would cost more
per month than everything else combined.

### `STORAGE_PUBLIC_ENDPOINT` — the address the *browser* uses

Presigned uploads are signed with SigV4, which covers the `Host` header, so a
URL rewritten after signing fails its own signature. The URL has to be signed
for the address the browser will actually call.

- **R2 / Spaces** — leave unset; the API and the browser use the same host.
- **Self-hosted storage behind a different hostname** — set it to the public one.

Wrong or unset, every upload fails in the browser with a bare "Failed to fetch"
and nothing appears in the API logs.

Set **CORS on the bucket** to allow `PUT` from the web origin. The browser
uploads directly, so without it the browser blocks every upload.

### HTTPS is required for recording

`navigator.mediaDevices.getUserMedia` does not exist on a non-secure origin —
the API is absent, so there is no permission prompt to accept. Served over plain
HTTP at an IP address, pronunciation blocks, speaking blocks and the CMS media
recorder all cannot record. `localhost` is the only exception, which is why this
does not show up in local development.

So the deployed frontend and API must both be HTTPS, or two of the product's
headline features do not work at all.

## Alternative: everything on one host

If the split is not worth the operational overhead, deploy the whole thing to a
single container host and serve the built frontend as static files from Express.
That needs a small addition to `app.ts` (an `express.static` mount plus an
SPA fallback), and drops Vercel from the picture entirely.

## Known gaps before a production launch

Not deployment configuration, but things that are unfinished and will be noticed
in production:

| Area | What is missing |
|---|---|
| Payment | No activation path exists; every subscription is stranded at `pending_payment`. Neither ShamCash nor TRC-20 USDT offers webhooks, so confirmation has to be a manual admin step. |
| Paywall | `subscription_plans.lessonsAccess` is read by no route — every student has full access regardless of plan. |
| Email | No provider configured, so there is no password reset. A forgotten password is permanent account loss. |
| Session roles | `req.session.role` is copied at login and never rechecked on a 30-day cookie, so a demotion or ban takes up to a month to take effect. |
| TURN | `PRACTICE_TURN_URLS` is empty, so voice practice is STUN-only and roughly one call in five will not connect. |
| AI | No provider configured. Speaking and pronunciation submissions stay `pending` and fall to the human marking queue at `/cms/grading` — correct behaviour, but nothing alerts when that queue grows. |

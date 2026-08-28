# Running Ascension locally

## With Docker (recommended)

Everything — PostgreSQL, schema migrations, the API server, and the web app —
comes up with one command:

```
docker compose up
```

| Service | URL |
| --- | --- |
| Web app | http://localhost:5173 |
| API | http://localhost:8080 (health: `/api/healthz`) |
| PostgreSQL | `localhost:5433`, database/user/password all `ascension` |

The `migrate` service runs first: it waits for PostgreSQL, pushes the Drizzle
schema, then applies the SQL migrations in `artifacts/api-server/migrations`.
The API only starts once that has finished successfully. The migrations are
idempotent, so this is safe on every startup.

The frontend calls the API with relative `/api` paths so both can share a single
origin in production. In development, Vite proxies `/api` through to the API
server; `API_PROXY_TARGET` controls where.

Useful commands:

```
docker compose down
```

```
docker compose down -v && docker compose up --build
```

The second wipes the database volume and rebuilds from scratch.

**Set a real `SESSION_SECRET` before deploying anywhere.** Compose falls back to
an insecure development default. Generate one with `openssl rand -hex 64`.

## Without Docker

You need Node 24 (Node 22 also works), pnpm 10, and a PostgreSQL 17 server.

```
pnpm install
```

Copy `.env.example` to `.env` and set `DATABASE_URL` and `SESSION_SECRET`, then
create the schema:

```
DATABASE_URL=postgresql://user:pass@localhost:5432/ascension pnpm run migrate
```

Run the two servers in separate terminals:

```
pnpm --filter @workspace/api-server run dev
```

```
pnpm --filter @workspace/ascension run dev
```

The API defaults to port 8080 and the web app to 5173, which is what the Vite
proxy expects. Override with `PORT` on either, and `API_PROXY_TARGET` on the web
app if the API is not on 8080.

### A note on non-ASCII paths

`lib/db/drizzle.config.ts` resolves its schema path with `__dirname`, which
`drizzle-kit` fails to glob when the project sits under a directory containing
non-ASCII characters — as this one does (`ذو الفقار`). `scripts/migrate.mjs`
works around it by passing `--schema` and `--url` on the command line, so prefer
`pnpm run migrate` over calling `drizzle-kit push` directly.

## No seed data

A fresh database has the right schema but **no content** — no curriculum,
lessons, vocabulary, placement questions, or subscription plans. `/api/levels`
returns an empty list. You can register and log in, but there is nothing to
study. See [ARCHITECTURE.md](ARCHITECTURE.md#database-seed-data).

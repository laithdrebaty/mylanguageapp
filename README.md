# Ascension (لغتي)

## What this is
An English-learning app built first for Arabic-speaking students in Syria (mobile-first, Arabic as the main UI language). A student signs up, takes a short placement test, then works through a structured curriculum of lessons and quizzes — reading, vocabulary, grammar, pronunciation, and speaking practice — with progress, scores, and levels tracked automatically.

The plan for this product beyond today:
- **English first, German next.** The data model doesn't hard-code any one language or level system, so adding German (or any other language) later is meant to be a content change, not a rewrite.
- **Scale to about 10,000 users**, with room to grow past that.
- **A daily-limited AI feature** where students get a small number of AI interactions per day (more on paid plans, none on free) — this is designed for but not yet built (see [docs/features/ai-chat.md](docs/features/ai-chat.md)).

If you want the deeper "what does each feature actually do, and how good is the code" writeup, see [docs/features/](docs/features/) — this README is the map of the territory, not the full tour.

## Technologies used

**Backend** — Node.js + TypeScript, running [Express 5](https://expressjs.com/). Key libraries: `express-session` + `connect-pg-simple` for logins (sessions live in Postgres, not in a token), `bcryptjs` for password hashing, `helmet` for security headers, `express-rate-limit` (backed by Redis when available) to slow down abuse, `pino` for logging, and `ioredis` for caching/rate-limiting/AI-quota tracking.

**Frontend** — [React 19](https://react.dev/) + [Vite](https://vite.dev/), routed with `wouter`, data-fetched with TanStack Query, styled with Tailwind CSS 4 and Radix UI components (shadcn-style), forms with React Hook Form + Zod.

**Database** — PostgreSQL, accessed through [Drizzle ORM](https://orm.drizzle.team/) (schema defined in TypeScript, structural changes applied as raw SQL migrations — see [docs/db-migration-non-interactive.md](docs/db-migration-non-interactive.md) for why).

**Caching / rate limiting / AI quotas** — Redis (`ioredis`), used for shared caching across servers, shared rate-limit counters, and daily AI-usage limits. The app is designed to keep working (in a reduced way) if Redis is unavailable — see [docs/redis-arch.md](docs/redis-arch.md).

**API contract** — one OpenAPI spec (`lib/api-spec/openapi.yaml`) is the source of truth; a tool called Orval generates the typed React Query client (`lib/api-client-react`) from it, so the frontend and backend can't silently drift apart on what an endpoint expects or returns.

**Tooling** — `pnpm` workspaces (monorepo), TypeScript throughout, Docker + `docker-compose` for local development, `Dockerfile` with separate build targets for the API, the web frontend, and one-off database migrations.

## How the pieces fit together (architecture)

This is a monorepo — one repository, several packages that depend on each other:

- **`artifacts/api-server`** — the Express API server. All business logic lives here: routes (`src/routes/`), the request/response layer; services (`src/services/`), the actual logic like grading, learning progress, caching, AI quotas; and middleware for auth/rate-limiting/security.
- **`artifacts/ascension`** — the React frontend students and content-editors use. Talks to the API only through the generated client, never by hand-writing fetch calls.
- **`lib/db`** — the database layer: every table is defined here (Drizzle schema), shared by the API server and by scripts.
- **`lib/api-spec`** — the OpenAPI contract for the API.
- **`lib/api-client-react`** — generated from that contract; the typed hooks the frontend uses to call the API.
- **`scripts`** — command-line scripts for running migrations and seeding the database.
- **`docs`** — architecture notes, deployment guide, and (new) per-feature docs in `docs/features/`.

**Request flow, roughly:** browser → React app (Vite dev server proxies `/api` calls in development) → Express API → session check → route handler → service layer (grading, progress, caching) → Postgres (and Redis, where used) → response back up the same path. Nothing about scoring, grading, or unlocking content is decided in the browser — the server is the source of truth for anything that matters (see [docs/features/lessons.md](docs/features/lessons.md) for why that matters).

**Content structure:** a student's curriculum is `languages` + `curricula` (which language, learnt in which language) → `levels` (e.g. A1.1 through C2.2 today, but not hard-coded as CEFR) → `lessons` → `content_blocks` (reading, vocabulary, questions, speaking prompts) → `exercises` (the gradable parts). Quizzes reuse the same `content_blocks` idea but are tracked separately since they can be retaken. Full details: [docs/multi-curriculum-arch.md](docs/multi-curriculum-arch.md).

**User roles:** `student` (the default), plus `content_manager`, `content_reviewer`, and `admin` for the CMS side where lessons, quizzes, and vocabulary get authored, reviewed, and published.

**Running it locally:** `docker compose up` starts Postgres, runs migrations, and starts both the API (port 8080) and the web app (port 5173, which proxies `/api` calls to the API). Full steps: [docs/RUNNING.md](docs/RUNNING.md).

**Deploying it:** the frontend (a static Vite build) and the API (a long-running server needing a persistent database/Redis connection) are meant to be deployed separately — see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for why and how.

## Where to look next
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — the original architecture notes (curriculum structure, subscription plans, product conventions)
- [docs/arch-foundation.md](docs/arch-foundation.md) — the production-hardening pass (security middleware, DB indexes, bug fixes)
- [docs/redis-arch.md](docs/redis-arch.md) — caching, rate limiting, and AI quota details
- [docs/multi-curriculum-arch.md](docs/multi-curriculum-arch.md) — how adding a new language/curriculum works
- [docs/features/](docs/features/) — what each feature does and a quality review of the code behind it
- [docs/RUNNING.md](docs/RUNNING.md) / [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — running locally and deploying

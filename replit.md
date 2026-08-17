# Ascension / لغتي

A Syrian-first English-learning platform. Mobile-first, Arabic-primary UI. Emphasizes speaking and conversation from day one, even at A1 level.

## Architecture

**Monorepo** (`pnpm` workspaces):
- `artifacts/ascension` — React + Vite frontend (primary app)
- `artifacts/api-server` — Express 5 API server
- `lib/db` — Drizzle ORM + PostgreSQL (all schema)
- `lib/api-spec` — OpenAPI spec (`openapi.yaml`)
- `lib/api-client-react` — Orval-generated React Query hooks (from spec)
- `lib/api-zod` — Orval-generated Zod schemas (server-side validation, NOT imported by api-server)

## Key Technical Decisions

- **Auth**: express-session + connect-pg-simple (PostgreSQL sessions) + bcryptjs. SESSION_SECRET env var required.
- **Codegen**: Orval 8.23 generates Zod v4 syntax. Fix: replace `type: integer` with `type: number` and remove `format: email` in openapi.yaml. api-server does NOT import @workspace/api-zod (Zod v4 incompatibility with installed Zod v3).
- **Payment**: stub only — records `pending_payment` status with paymentMethod (sham_cash / cryptocurrency / manual). No real gateway in V1.
- **No AI in V1**: all content is static/structured; API is designed with clear hooks for future AI evaluation.

## Curriculum Structure

12 levels: A1.1 → C2.2, each with 5 lessons (A1.1 and A1.2 fully seeded).
Passing threshold: 75%.
Lesson types: general, reading, pronunciation, speaking, vocabulary, grammar, conversation.

## Subscription Plans (seeded)
- `free` — A1.1 access only, $0/mo
- `general_english` — Full A1–C2, $2/mo
- `professional_english` — Full + business vocabulary, $4/mo

## Running Workflows
- `artifacts/api-server: API Server` — `pnpm --filter @workspace/api-server run dev`
- `artifacts/ascension: web` — `pnpm --filter @workspace/ascension run dev`

## Seeded Data
- 12 curriculum levels (A1.1–C2.2)
- 10 A1.1 lessons + 5 A1.2 lessons
- 19 vocabulary items for A1.1
- Content blocks for all 5 A1.1 lessons
- 3 exercises with options
- 10 placement test questions with 4 options each
- 3 subscription plans

## User Preferences
- Syrian-first product framing — Arabic is the primary UI language
- No emojis in the UI
- Mobile-first design
- Speaking emphasized from day one, even at A1

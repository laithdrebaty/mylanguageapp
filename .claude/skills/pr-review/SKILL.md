---
name: pr-review
description: Review a pull request or code diff in this repo (Ascension / لغتي) for correctness, security, performance, and test coverage before merging. Figures out which parts of the stack changed and applies the matching checklist(s). Use when asked to review a PR, review a branch, review a diff, do a code review, or check changes before merging.
---

# PR Review — Ascension / لغتي

This is the entry point for reviewing any pull request or set of changes in this repo. It tells you what to check and in what order. It hands off to two more specific checklists for the actual technical details:
- `.claude/skills/pr-review-backend/SKILL.md` — for `artifacts/api-server`, `lib/db`, `lib/api-spec`
- `.claude/skills/pr-review-frontend/SKILL.md` — for `artifacts/ascension`

**Reminder for this repo specifically:** reviewing means reading, running checks, and reporting findings. It does not mean committing, pushing, or merging anything yourself — this project's rules say not to do that.

## Step 1 — See what actually changed

Get the diff against the base branch (usually `main`) and sort the changed files into buckets:

- **Backend** — `artifacts/api-server/**`, `lib/db/**`, `lib/api-spec/**`
- **Frontend** — `artifacts/ascension/**`
- **Generated client** — `lib/api-client-react/src/generated/**`. This is machine-generated from `lib/api-spec/openapi.yaml` by Orval. It should basically never be hand-edited — if the diff shows manual edits inside `generated/`, that's a finding on its own; the fix is to change the spec and regenerate, not to patch the generated file.
- **Infra / tooling** — `docker-compose.yml`, `Dockerfile`, `pnpm-workspace.yaml`, root `package.json`, `artifacts/api-server/migrations/**`
- **Docs** — `docs/**`, including `docs/features/**`

Read enough of the surrounding code (not just the diff lines) to understand what a change actually does in context — a two-line diff can hide a real problem if you don't look at the function it's part of.

## Step 2 — Apply the matching checklist(s)

- Any backend bucket file touched → read `.claude/skills/pr-review-backend/SKILL.md` and apply it.
- Any frontend bucket file touched → read `.claude/skills/pr-review-frontend/SKILL.md` and apply it.
- Both touched in the same PR → apply both, then also check the two sides agree with each other (Step 5).

## Step 3 — Tests (always check this, every PR)

Important context for this repo: **there is no test suite running today.** `vitest` is installed and configured for the API server (`artifacts/api-server/vitest.config.ts`), but there is no `test` script in `package.json` yet and no test files exist anywhere in the repo. The frontend has no test tooling installed at all. (Re-check this yourself before relying on it — it may have changed since this was written.)

Given that:

1. **If the PR adds or changes real logic** — grading/scoring, access control, anything affecting what a student earns, unlocks, or is charged for, subscription/payment status, AI quota enforcement — **and it doesn't add any tests, ask the author to add some**, or to explain why it isn't practical (a copy/text-only change, a pure styling tweak, a one-off script). Don't let "there's no test culture here yet" become a permanent excuse — every PR that skips tests for real logic makes the next one easier to skip too.
2. **If the PR does add tests, run them — don't just read them and assume they pass.**
   - Backend: `cd artifacts/api-server && npx vitest run`
   - If that command fails outright because there's still no `test` script, that's fine — run vitest directly as above, and separately suggest the author add `"test": "vitest run"` to `artifacts/api-server/package.json` so it's not a one-off you have to remember.
3. **If tests already exist elsewhere in the codebase by the time you're doing this review** (check first — the "no tests yet" note above may be outdated), run the *whole* existing suite, not just whatever the PR added. The point is to catch this change breaking something unrelated, not just to confirm the new tests pass in isolation.
4. **Always run these regardless of test coverage**, for whichever side(s) changed:
   - Backend: `cd artifacts/api-server && pnpm run typecheck` and `pnpm run build`
   - Frontend: `cd artifacts/ascension && pnpm run typecheck` and `pnpm run build`
   - Root (shared libs): `pnpm run typecheck` from the repo root
   A PR that fails typecheck or build is a **blocking** finding no matter how good the rest of the diff looks.

## Step 4 — Don't break older features (regression check)

For every function, route, component, or shared helper the diff touches, find its other call sites and check they still get what they expect:

- A changed API route — check status codes, response shape, and required fields haven't silently changed for existing callers.
- A changed shared backend helper (`services/learning.ts`, `lib/validate.ts`, `middlewares/auth.ts`, anything in `services/`) — these are used across many routes; a "small fix" in one can change behavior everywhere else that calls it.
- A changed shared frontend component (`artifacts/ascension/src/components/ui/*`, `components/layout.tsx`, `components/cms-layout.tsx`, hooks in `src/hooks/`) — same idea, check every page that uses it.
- A changed database column or table (`lib/db/src/schema/**`) — check every route/service reading or writing it, and check whether `lib/api-spec/openapi.yaml` needs updating and the client regenerating to match (see `docs/openapi-codegen-rules.md` and `docs/zod-orval-compat.md` for known Orval/Zod version gotchas before regenerating — Orval 8.23 generates Zod v4 syntax, but the API server uses Zod v3, so the generated Zod package must never be imported by `api-server`).

## Step 5 — Frontend/backend agreement (when a PR touches both)

- If a route's request or response shape changed, `lib/api-spec/openapi.yaml` should be updated in the same PR and the client regenerated (`lib/api-client-react`). A PR that changes route behavior but not the spec is a mismatch waiting to surface as a bug later — flag it even if the app happens to still work today.
- If a new field was added to a response, check the frontend consumes it through the generated, typed client rather than through a hand-written type or an `any` — a hand-typed duplicate silently drifts from reality the next time the API changes.

## Step 6 — Write up the findings

Group findings into three buckets:
- **Blocking** — breaks something, security hole, data-integrity risk (e.g. a race condition on money/XP/progress), fails typecheck/build/tests.
- **Should fix** — real but not urgent: a performance issue that only bites at scale, a missing validation check, a missing test for meaningful logic.
- **Nice to have** — style, naming, minor cleanup, an optimization that doesn't matter yet.

For each finding: name the file (and line, if you have one), say what's wrong in plain terms, and say what a fix would look like — "this could be better" isn't a usable review comment on its own. When you're not sure something is actually a problem, say so and explain your reasoning rather than stating it as fact.

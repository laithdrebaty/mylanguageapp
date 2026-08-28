# Shared base: install workspace dependencies once, reuse for every service.
FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.5.2 --activate
WORKDIR /app

# Copy only the manifests first so dependency installation stays cached
# across source-code edits.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY artifacts/api-server/package.json  artifacts/api-server/
COPY artifacts/ascension/package.json   artifacts/ascension/
COPY lib/api-client-react/package.json  lib/api-client-react/
COPY lib/api-spec/package.json          lib/api-spec/
COPY lib/api-zod/package.json           lib/api-zod/
COPY lib/db/package.json                lib/db/
COPY scripts/package.json               scripts/

RUN pnpm install --frozen-lockfile

COPY . .

# ── Migration runner ─────────────────────────────────────────────────────────
# Pushes the Drizzle schema, then applies the hand-written SQL migrations.
# Runs to completion and exits; the api service waits for it.
FROM base AS migrate
CMD ["pnpm", "--filter", "@workspace/scripts", "run", "migrate"]

# ── API server ───────────────────────────────────────────────────────────────
FROM base AS api
RUN pnpm --filter @workspace/api-server run build
EXPOSE 8080
CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]

# ── Web (Vite dev server) ────────────────────────────────────────────────────
FROM base AS web
EXPOSE 5173
CMD ["pnpm", "--filter", "@workspace/ascension", "run", "dev"]

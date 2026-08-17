---
name: OpenAPI spec rules for Orval 8.23 codegen
description: Rules for writing openapi.yaml to keep Orval 8.23 codegen passing with Zod v3 consumers.
---

## Rules
1. Use `type: number` (not `type: integer`) for all integer fields.
2. Omit `format: email` from string fields — Orval maps it to `zod.email()` which is Zod v4 only.
3. After changing the spec, run `pnpm --filter @workspace/api-client-react run generate` and `pnpm --filter @workspace/api-zod run generate`.

**Why:** Orval 8.23 generates Zod v4 syntax for `format: email` and `type: integer`. The monorepo uses Zod v3, so these fields cause a runtime crash in any consumer that imports the generated schemas.

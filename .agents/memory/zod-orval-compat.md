---
name: Zod v3 / Orval api-zod compatibility
description: api-server must never import @workspace/api-zod because Orval 8.23 generates Zod v4 syntax (zod.email(), zod.int()) that crashes at runtime with Zod v3.
---

## Rule
Never add `@workspace/api-zod` as a dependency of `artifacts/api-server`. Write route validation manually or skip it.

**Why:** Orval 8.23 generates `zod.email()` and `zod.int()` (Zod v4 methods). The monorepo has `zod@3.x` installed. At runtime the bundle crashes with `TypeError: (void 0) is not a function` when any api-zod schema is evaluated.

**How to apply:** If a route needs Zod validation, write it inline using `zod@3.x` syntax (`z.string().email()`, `z.number().int()`). The api-zod package exists only for external consumers who bring their own Zod v4.

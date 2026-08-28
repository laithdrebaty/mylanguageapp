---
name: DB migration non-interactive workaround
description: drizzle-kit push blocks on TTY prompts when dropping/renaming columns; use raw SQL via executeSql instead.
---

## Rule
When schema changes involve dropping or renaming columns, or dropping unique constraints, use `executeSql` in CodeExecution to apply the DDL directly rather than `drizzle-kit push`.

**Why:** `drizzle-kit push` raises interactive prompts (`promptColumnsConflicts`) that require a TTY. In a non-interactive shell (CI, container entrypoint), `process.stdin.isTTY` is false and the process errors out. The `--force` flag exists but does not suppress column-conflict prompts in drizzle-kit 0.31.x.

**How to apply:**
1. Write the Drizzle TypeScript schema as normal (the source of truth for Drizzle ORM queries).
2. Apply the structural DDL (ALTER TABLE, DROP COLUMN, CREATE UNIQUE INDEX, DROP CONSTRAINT) using `executeSql` in CodeExecution.
3. For additive changes only (new tables, new nullable columns), `drizzle-kit push` works fine without TTY.
4. After applying DDL manually, the drizzle schema snapshot diverges — that's OK in dev push mode since drizzle ORM uses the TS schema files, not the snapshot, for query building.

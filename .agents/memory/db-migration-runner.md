---
name: Database migration runner
description: The API startup migration runner is safer than schema push for incremental changes in this workspace.
---

Use the numbered SQL migration files and the API startup migration runner for incremental database changes; avoid relying on interactive schema push when it proposes unrelated destructive changes.

**Why:** The development database can contain existing data and schema drift, so an interactive push may stop on an unrelated uniqueness/truncation prompt even when the intended migration is safe and idempotent.

**How to apply:** Add an idempotent numbered migration, restart the managed API workflow, and verify the migration is recorded in `_migrations` and the target relation exists.
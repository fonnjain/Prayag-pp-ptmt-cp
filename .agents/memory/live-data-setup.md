---
name: Live data setup (Google connector + DB seeds across merges)
description: Two gotchas when wiring the production-planning app to real Google Sheets and after task-agent merges.
---

# Sheet reads need the `google-sheet` connector, not Drive

The ingestion reader (`artifacts/api-server/src/lib/google.ts`) calls the Sheets
API (`/v4/spreadsheets/...`) through the connector named **`google-sheet`**.
Authorizing only Google **Drive** is NOT enough — Drive's proxy targets a
different host and returns 401 for Sheets value reads.

**Why:** Drive was authorized first and looked "connected", but pulls still
failed because value reads go through the separate `google-sheet` connector.

**How to apply:** before debugging pull failures, confirm the `google-sheet`
connection is authorized/healthy (not just Drive). Authorizing it is a user
OAuth step via the integrations panel.

# DB data does not carry across task-agent merges

When an isolated task agent's work is merged, only the **schema** is pushed
(post-merge runs `drizzle-kit push`). Any rows the agent seeded in its isolated
database (e.g. `source_config`) do **not** come along — the table will be empty
in the main env.

**Why:** merges move code, not database contents; each environment has its own DB.

**How to apply:** re-seed reference/config tables in the main env after a merge.
For `source_config` there is a re-runnable seed at `lib/db/seeds/source_config.sql`.

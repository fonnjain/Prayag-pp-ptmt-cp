---
name: Production plan run creation
description: Plan runs created in dev do not copy to production on publish. Must be created via the production API explicitly.
---

# Production plan run creation

## The rule
Creating or finalizing a `plan_runs` row in dev (or any dev-only operation that writes DB rows) has **zero effect** on production. Publish copies only the code bundle and schema diffs — not data rows.

**Why:** When dev creates a new plan run (e.g. #21 PTMT / 617,710 after fixing multipliers), that row lives only in the dev database. Production still has the old plan run (#18 at 684,492). The corrective auto-select (`ORDER BY id DESC LIMIT 1`) in production will keep picking the old run until a new one is created there.

**How to apply:**
1. After fixing anything that changes the plan output (multipliers, data sources, formula), also create a fresh plan run **in production** via `curl -X POST https://<prod-url>/api/plan/runs` with the correct `month` and `segment`.
2. Finalize it: `curl -X POST https://<prod-url>/api/plan/runs/:id/finalize`.
3. The corrective auto-select will then pick it up immediately — no redeploy needed for data fixes.
4. The seeding code (`seedPtmtOverrides`) runs on every boot with the locked PTMT multipliers, so production computes the same totals as dev (617,710 for PTMT Aug 2026) as long as the same uploaded files are in production.

For a PTMT persistence smoke test, set `planType` explicitly to `temporary` and delete the returned test run after verifying the list response. Omitting `planType` defaults to a PTMT Production Plan, which correctly requires a finalized Temporary Plan lineage; that `TEMPORARY_PLAN_REQUIRED` response is not a database parity failure.

**Why:** A save/list check that omitted the plan type failed identically in development and production once both environments ran the lineage guard, so it was testing an invalid request rather than persistence.

**How to apply:** Keep production plan creation strict; make smoke tests satisfy the route contract and clean only the run ID they created.

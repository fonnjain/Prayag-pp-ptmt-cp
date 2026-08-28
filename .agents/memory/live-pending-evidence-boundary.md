---
name: Live pending evidence boundary
description: How to interpret reconciliation failures when the live pending sheet changes before investigation
---

Live pending reconciliation failures are point-in-time observations. A failed validation can expose totals and a fingerprint, but the rejected live source rows are not automatically retained; a later read may be a materially different source cut.

**Why:** During a Plumbing investigation, a 7,944-piece source cut was rejected, then the same live report later read 75,046 pieces. No persisted plan-run/input snapshot contained the rejected cut, so its row-level exclusion ledger was not recoverable.

**How to apply:** Treat the error totals/fingerprint as authoritative for the failed read only. Capture the source identity and row-level evidence at the same read whenever the ledger may be needed; never substitute a later live pull for the historical failure.

Validation must persist the complete live source diagnostics before evaluating independent uploaded-plan assertions, and validation/monitoring responses should retain that evidence when the uploaded source is rejected.

**Why:** A validation route can correctly reject a stale or incomplete planning upload while still having a valid live capture that is needed to establish the first immutable baseline.

**How to apply:** Keep the live capture/update and baseline promotion ahead of upload policy failures; production corrective replans remain strict, while only an explicitly diagnostic validation/monitoring path may inspect unreviewed input. Preserve upload ID/filename separately from live-sheet provenance in validation diagnostics.
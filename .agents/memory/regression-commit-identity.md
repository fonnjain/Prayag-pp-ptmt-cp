---
name: Regression commit identity
description: Live regression results must be tied to the API process commit, not only the local source or bundle.
---

## Rule
Before attributing a regression to a source change, verify that the API process under test reports the commit containing that change. A fresh local bundle does not prove that an already-running dev API has loaded it.

**Why:** A run can report a valid bundle-freshness check while the long-lived API process still serves the previous module graph, making before/after conclusions invalid.

**How to apply:** Record `GET /api/healthz` commit identity beside the regression result; restart the API after source changes when the identity is stale, then rerun the affected flow.

## Reviewed-input fingerprints

When a reviewed exclusion fingerprint gates a plan, compute and verify it with
the same canonical serializer used by the running API process. A standalone
diagnostic can reproduce every row and still produce a different hash if its
separator encoding differs.

**Why:** A September Plumbing preflight matched `905004 / 768558 / 175` in both
paths, but the API used actual LF separators while the direct diagnostic used
literal backslash-n separators; accepting the mismatch would weaken the review
gate.

**How to apply:** Compare the exact pre-hash bytes, including delimiters and
field ordering, before approving a new fingerprint. The gating path owns the
approved value.
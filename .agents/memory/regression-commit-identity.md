---
name: Regression commit identity
description: Live regression results must be tied to the API process commit, not only the local source or bundle.
---

## Rule
Before attributing a regression to a source change, verify that the API process under test reports the commit containing that change. A fresh local bundle does not prove that an already-running dev API has loaded it.

**Why:** A run can report a valid bundle-freshness check while the long-lived API process still serves the previous module graph, making before/after conclusions invalid.

**How to apply:** Record `GET /api/healthz` commit identity beside the regression result; restart the API after source changes when the identity is stale, then rerun the affected flow.
---
name: Regression development drift
description: Development-mode regression validation must distinguish known live-data drift from structural failures.
---

Development-mode regression checks may downgrade explicitly known live-source or historical-baseline drift to warnings, but structural identities, source completeness, endpoint behavior, and safety guards must remain hard failures. Check names may include human-readable tolerance suffixes, so drift classification should use stable prefixes where labels are decorated.

**Why:** Live Sheets values move between runs, while relaxing structural checks would hide actual pending loss or broken joins.

**How to apply:** Keep production mode strict; in development mode classify only documented baseline-value checks as warnings and preserve exact reconciliation and API checks.
---
name: MRP API discontinued-state boundary
description: The upstream catalogue API does not expose the authoritative discontinued population.
---

The authoritative September MRP file is the discontinued-state load source: `discontinuedFrom` is populated on only 18 of 233 MRP discontinued rows, leaving 215 already-effective withdrawals invisible to the upstream catalogue API.

**Why:** The catalogue endpoint currently reports active rows and cannot reconstruct the full withdrawal population, so relying on it would understate withdrawn-product exposure.

**How to apply:** At each sync, compare the API’s `discontinuedFrom` coverage with the MRP file and keep the file as the source for discontinued controls; do not infer the missing 215 rows from API inactivity.
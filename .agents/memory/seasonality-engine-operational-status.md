---
name: Seasonality engine operational status
description: PTMT seasonality coverage, source years, persistence behavior, and the override boundary.
---

The PTMT seasonality engine retains its category-level benchmark and a month-scoped matrix covering all nine governed categories. After a complete source read, the auto-sync scheduler runs the global engines for PTMT and Plumbing plus the PTMT monthly matrix once per planning month; suggestions become applied defaults while explicit overrideMultiplier values remain the only manual exception. Failed/partial reads never change applied values.

**Why:** a single `1 + z × CV` value cannot reproduce a March/June/July multiplier matrix, and historical-only inputs cannot detect current-year monthly policy changes. The monthly path uses the catalogue's Old ERP Code fallback because historical order sheets carry long operational Item Code values while current FY files often expose Old ERP Code. Missing held categories must remain explicit rather than appearing as stale engine output; a source failure must not turn partial history into a plan change.

**How to apply:** when diagnosing a mismatch, inspect lastComputedAt, zScore, dataQuality, reliabilityFlag, and overrideMultiplier separately. Temporary Plans use the PTMT month-scoped value when available, then the global category value; Plumbing uses the global category value. Treat failed cadence rows as stale-but-safe until the next complete source read.
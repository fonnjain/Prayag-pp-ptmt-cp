---
name: Monitoring dashboard route separation
description: Durable navigation rule for the Production Monitoring plant landing and machine dashboard.
---

The Production Monitoring plant landing route and PTMT machine dashboard must use separate paths. The root route is reserved for the Plant Control Board, while the Machine Level Dashboard needs its own dedicated route.

**Why:** Reusing `/` for the machine dashboard makes a visible Machine Level navigation link unreachable once `/` is changed to the plant landing page.

**How to apply:** When changing the default landing page, update the machine dashboard route and sidebar link together; verify both routes and their active states in the browser.
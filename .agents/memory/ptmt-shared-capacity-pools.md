---
name: PTMT shared capacity pools
description: Approved physical-line relationships used when fitting PTMT production plans.
---

Special Cock shares the Cocks Standard capacity pool; Collapsible Waste Pipes shares Waste Pipes; Showers Sets shares Faucets & Jetsprays & Shower. Unclassified is a holding state with no pool.

**Why:** Prayag explicitly approved pooled capacity because separate rows would double-count shared machinery and allow the same physical line to promise more than it can deliver. Workbook range evidence supports the three roll-ups, but does not justify copied standalone capacities.

**How to apply:** Aggregate demand against the existing capacity row, preserve the source planning category on item results, and expose the pool relationship in audit output. Keep Unclassified demand visible with zero executable buffer and skip it during capacity fitting.
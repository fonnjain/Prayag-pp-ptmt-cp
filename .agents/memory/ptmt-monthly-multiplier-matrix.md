---
name: PTMT monthly multiplier matrix
description: Historical Jan–Jul PTMT category multipliers derived from item buffer divided by three-month average sale.
---

The linked daily-production workbooks show month-varying PTMT buffer policy, not one fixed category constant. Representative item-level ratios are: March CS 2.0, CP 2.0, FJ 2.5, ACC 2.0, and the remaining categories 1.5; April CS 1.5, CP/FJ/ACC 2.0, and the remaining categories 1.5; June is broadly 1.2; July is CS/FJ/ACC/BC/CON/WP 1.5 and CP/CIS/CAB 1.2. January and February have zeroed avg/buffer fields. Cocks Standard is mixed/stale in May and June rather than a valid single ratio.

**Why:** item ratios cluster tightly around the observed monthly factors, so fixed PTMT seeds can disagree with the historical workbook policy. The Cocks Standard exceptions indicate source-row formula or refresh problems in addition to the moving policy.

**How to apply:** treat PTMT multipliers as month-scoped source evidence; do not retrofit one global seed or infer a value for a held category. Preserve mixed/stale cells as data-quality findings requiring business review.
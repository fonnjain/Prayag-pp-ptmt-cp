---
name: PTMT upload schema drift & silent-zero join guards
description: Monthly PTMT upload files change column names; silent-zero joins are the failure mode; goldens are month-keyed
---

**Rule:** Every monthly PTMT upload set can rename its columns; a missed alias silently zeroes the join and the plan still "works" but is hugely wrong. Never trust a plan built from fresh uploads until the validate guards pass.

**Why:** The Aug 2026 plan came out 684k instead of 618k purely from silent zeroes: FG stock qty appeared as `Closing Stock` (~498k units unjoined), LM pending qty as `Qty.` (trailing dot). Aug DATA.xlsx pending rows carry NO balance column — pending genuinely contributes 0; aliasing its `Quantity` column overshoots massively. Uploads made via the deployed app land only in the prod DB, not dev.

**How to apply:**
- Qty-column aliases live in both the uploads parser and the validate/plan sumByKey key lists — extend BOTH when a new name appears.
- `/api/plan/validate` guards (consumed by the suite): stock-join coverage (engine layer must be 0; strict punctuation layer baseline ≤1), Σjoined vs strict ΣFG-for-plan-codes ±2% (deliberate asymmetry so join degradation trips it), both-direction item coverage always reported, same stock-join guard on the Plumbing branch.
- Goldens are month-keyed in plumbing-golden.ts; the suite's plan-validate month rolls with the upload set while monitoring/mgmt sections stay pinned to their actuals month. Capture fresh goldens (with snapshot date) each rollover; never assert old-month goldens against new uploads.
- Residuals vs business target tables (up to ~±3% per category) are item-roster coverage (source codes absent from item_master and vice versa) — report, never invent items.
- Weekly-release invariant: items with `week=null` (cover beyond top band) are intentionally unreleased; exclude from wSum≈plan but surface their pcs.

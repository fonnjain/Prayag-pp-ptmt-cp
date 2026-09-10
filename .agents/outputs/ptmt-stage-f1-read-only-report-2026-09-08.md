# PTMT Stage F1 read-only report

**Date:** 2026-09-08  
**Scope:** F1 only. No code, database, override, plan, scheduler, production, deployment, recompute, or validation changes were made. F2 remains unstarted and requires explicit approval.

## F1.1 — Effective roster entry paths

The effective roster is constructed in `artifacts/api-server/src/lib/rate-list.ts`, inside `buildEffectivePtmtRosterWithClassifier`. The current async entry point is `getEffectivePtmtRoster`, which loads PTMT item-master rows, the governed rate list, active reviewed catalogue rows, loadable PTMT MRP rows, capacity-category names, and Prayag category evidence.

| Entry path | Requirements | Implementation | Codes entering #2419 |
|---|---|---|---:|
| Item master / workbook | PTMT `item_master` row | `rate-list.ts:322–370`; every PTMT item row is emitted, with classification precedence applied | **1,459** |
| Reviewed catalogue | Active PTMT `master_products` row with a non-empty `planningCategory`, and code not already represented | `rate-list.ts:372–405` | **68** |
| Explicit MRP bridge | Code not already represented; MRP series exactly `LUXOR` or `GLORY`; `resolveMrpClassification` must classify it | `rate-list.ts:408–446` | **0** |
| Rate-list-only | Remaining governed rate-list code not already represented | `rate-list.ts:448–480` | **177** |
| **Total unique code identities in #2419** | — | — | **1,704** |

Prayag planning-tab evidence is currently a **classification/precedence source for rows already entering the roster**. `prayag-category-evidence.ts` reads the managed itemised comparison evidence and provides `codeToCategory`; it does not itself add an absent code to the roster.

### LUXOR/GLORY bridge in full

The bridge runs after item-master and reviewed-catalogue admission and before rate-list-only admission:

1. Normalize the MRP item code.
2. Skip it if the code is already represented.
3. Admit it only if the normalized MRP series is exactly `LUXOR` or `GLORY`.
4. Resolve the MRP classification.
5. Skip it unless the classification is `classified` and has a category.
6. Use Prayag evidence for the category when available; otherwise use the MRP category.
7. Persist `rosterSource: "mrp"` and the MRP series.

No #2419 code entered through this bridge after applying the current source sets.

## F1.2 — Candidate set that a general MRP + Prayag-evidence path would admit

The requested candidate definition is:

> loadable MRP product row + Prayag planning-tab evidence + absent from the current effective #2419 roster.

The Stage E file contains 58 evidence rows but only 39 unique code identities. Of those, 18 identities are already in #2419 as `Unclassified`; they are not candidates under the definition above. The resulting candidate set is **21 unique codes**.

### Candidate totals

- Candidate codes: **21**.
- Three-month average sale: **13,042.33 pieces/month**.
- Stock: **10,520 pieces**.
- Current pending: **420 pieces**.
- Dummy demand, defined as positive pending-last-month: **1,025 pieces**.
- Estimated September demand at the current Prayag workbook multipliers: **15,038.50 pieces**.
- The eight known P.V.C. Connections codes account for **8,100.50 pieces**.
- The other 13 candidate codes account for **6,938.00 pieces**.

The complete code-level table is in `.agents/outputs/stage-f1-candidate-codes.csv`.

| Code | MRP series | Prayag category | Avg 3-month sale | Stock | Pending | Dummy | Estimated demand |
|---|---|---|---:|---:|---:|---:|---:|
| 124-T | Special Cock | Cocks Standard | 0.00 | 0 | 0 | 0 | 0.00 |
| 146-D | Delta | Accessorise | 0.00 | 0 | 0 | 0 | 0.00 |
| 146-I | Ibix | Accessorise | 0.00 | 0 | 0 | 0 | 0.00 |
| 146-R | Ovian | Accessorise | 0.00 | 0 | 0 | 0 | 0.00 |
| 148-D | Delta | Accessorise | 0.00 | 0 | 0 | 0 | 0.00 |
| 148-I | Ibix | Accessorise | 0.00 | 0 | 0 | 0 | 0.00 |
| 148-R | Ovian | Accessorise | 0.00 | 0 | 0 | 0 | 0.00 |
| 322 | P.V.C. Connections | P.V.C. Connections | 100.00 | 691 | 0 | 0 | 0.00 |
| 323-H | P.V.C. Connections | P.V.C. Connections | 1,766.67 | 2,866 | 0 | 0 | 0.00 |
| 324-H | P.V.C. Connections | P.V.C. Connections | 3,060.33 | 610 | 0 | 347 | 4,327.50 |
| 325-H | P.V.C. Connections | P.V.C. Connections | 200.00 | 2,095 | 0 | 0 | 0.00 |
| 326-H | P.V.C. Connections | P.V.C. Connections | 533.33 | 650 | 100 | 0 | 250.00 |
| 3272-BC | Collapsible Waste Pipe | Waste Pipes | 5,000.00 | 588 | 0 | 0 | 6,912.00 |
| 3274-B | Collapsible Waste Pipe | Waste Pipes | 33.33 | 421 | 0 | 0 | 0.00 |
| 3274-BC | Collapsible Waste Pipe | Waste Pipes | 0.00 | 385 | 0 | 0 | 0.00 |
| 328-C | P.V.C. Connections | P.V.C. Connections | 333.33 | 9 | 0 | 0 | 491.00 |
| 3461 | Waste Pipes | Waste Pipes | 10.00 | 260 | 0 | 0 | 0.00 |
| 348 | P.V.C. Connections | P.V.C. Connections | 1,563.33 | 501 | 300 | 678 | 2,822.00 |
| 350 | P.V.C. Connections | P.V.C. Connections | 210.00 | 105 | 0 | 0 | 210.00 |
| 3727 | Collapsible Waste Pipe | Waste Pipes | 228.00 | 1,339 | 0 | 0 | 0.00 |
| SF-02 | Cistern's & Seat Cover's Accessories | Accessorise | 4.00 | 0 | 20 | 0 | 26.00 |

### The other 50 Stage E evidence rows

The 50 evidence rows beyond the eight known P.V.C. rows resolve into:

- **13 additional absent-roster MRP candidates**, listed above.
- **18 existing-roster identities** already present as `Unclassified`; they are not absent-roster candidates. They are:
  `123-FH, 123-HN, 124-FH, 126-SQ, 130-RN, 1322-HN, 1375-SP, 146-B, 146-BO, 146-HB, 147-HQ, 147-RQ, 148-B, 148-BO, 148-HB, 186, 1861, 202`.

Those 18 have Prayag evidence categories but currently enter #2419 as `Unclassified`, generally because their Prayag evidence contains multiple category assignments. They are a separate category-resolution issue, not an absent-roster admission under F1.2.

## F1.3 — Other movement and downstream assumptions

### Existing code categories

The 21-code candidate set is disjoint from the current #2419 code set. Adding a path that runs only for `MRP row + Prayag evidence + not represented` would add rows without changing the category of an existing represented code. The 18 evidence-only category records already represented as `Unclassified` would remain outside that add-only candidate path.

### Existing plan runs

Read-only database status:

| Run | Month | Status | Type |
|---:|---|---|---|
| 2410 | 2026-09 | **finalized** | temporary |
| 2419 | 2026-09 | **draft** | temporary |
| 2420 | 2026-09 | **draft** | temporary |

A roster-construction change does not recompute or mutate persisted runs. A future plan build would use the changed roster; the three stored runs remain as listed above unless a separate explicit operation changes them.

### Fixed roster-size assumptions

The source review found no current PTMT golden, fixture, alert threshold, or capacity denominator tied to a fixed roster count.

- Plan validation records `items.length` dynamically.
- Synthetic calculation fixtures use their own explicit fixture rows, not the live #2419 roster count.
- Alert thresholds are demand values; for example R6 is **5,000 pieces** of unresolved pending/dummy demand, not an item/code count.
- Capacity calculations use category capacity/day and working days; they do not divide by a fixed roster size.
- The current live reference values are dynamic: **1,704 unique codes** and **3,584 stored item/colour rows** in #2419.

## F1.4 — The 194 with no MRP row under any spelling

The exact normalized join review was recomputed from the persisted #2419 result rows:

- Exact MRP join failures: **213 codes**, carrying **45,129.34 pieces**.
- Hyphen/space-stripping candidates: **19 codes**, carrying **35,909.67 pieces**.
- Remaining codes with no MRP row even under stripped hyphen/space spelling: **194 codes**, carrying **9,219.67 pieces**.

This fresh persisted-row sum supersedes the earlier Stage E report's 45,542.69 figure; the current database aggregation and the exported #2419 result rows both total 45,129.34 for the exact-failure set.

### Top 20 of the 194 by #2419 demand

| Code | #2419 demand | Current source path |
|---|---:|---|
| PTA-67 | 1,568.50 | rate-list-only |
| PTA-54 | 1,358.00 | rate-list-only |
| PTA-68 | 1,344.50 | rate-list-only |
| PTA-61 | 1,002.50 | rate-list-only |
| 513-EWC | 846.67 | rate-list-only |
| PTA-62 | 572.00 | rate-list-only |
| PTA-49 | 264.33 | rate-list-only |
| PTA-14 | 247.67 | rate-list-only |
| PTA-78 | 242.00 | rate-list-only |
| PTA-53 | 230.67 | rate-list-only |
| PTA-76 | 208.67 | rate-list-only |
| PTA-18 | 172.00 | rate-list-only |
| PTA-71 | 155.00 | rate-list-only |
| PTA-15 | 140.00 | rate-list-only |
| PTA-59 | 92.50 | rate-list-only |
| PTA-73 | 89.33 | rate-list-only |
| PTA-55 | 75.33 | rate-list-only |
| CNS-15 | 70.00 | item-master/workbook |
| PTA-84 | 61.67 | rate-list-only |
| PTA-79 | 60.33 | rate-list-only |

The complete 194-code list is in `.agents/outputs/stage-f-no-mrp-any-code-paths.csv`.

## F1.5 — Hyphen and space normalization

The current implementation is:

```ts
String(itemCode ?? "").trim().toUpperCase().replace(/\.0$/, "")
```

The 19 codes that would match after stripping hyphens/spaces are:

| Current #2419 code | Demand | MRP code it would join |
|---|---:|---|
| 1231F | 0.00 | 1231-F |
| 129I | 0.00 | 129-I |
| 129QW | 0.00 | 129-QW |
| 130C | 0.00 | 130-C |
| 132-2U | 0.00 | 1322-U |
| 132I | 0.00 | 132-I |
| 132T | 0.00 | 132-T |
| 133NEW | 0.00 | 133-NEW |
| 322-K | 0.00 | 322K |
| 323-K | 16,407.00 | 323K |
| 324-K | 15,286.00 | 324K |
| 325-K | 1,082.00 | 325K |
| 326-K | 3,052.00 | 326K |
| 348-K | 0.00 | 348K |
| 501-N | 0.00 | 501N |
| 501-S | 0.00 | 501S |
| 503-N | 0.00 | 503N |
| 701-N | 82.67 | 701N |
| DB-02 L | 0.00 | DB-02L |

Across all current loadable PTMT MRP product codes, stripped hyphen/space normalization produces **zero ambiguous collision keys**: no two distinct MRP codes normalize to the same stripped key.

## Read-only outputs

- `.agents/outputs/ptmt-stage-f1-read-only-report-2026-09-08.md`
- `.agents/outputs/stage-f1-candidate-codes.csv`
- `.agents/outputs/stage-f-no-mrp-any-code-paths.csv`
- `.agents/outputs/stage-e-prayag-only-codes.csv`

F2 was not started.

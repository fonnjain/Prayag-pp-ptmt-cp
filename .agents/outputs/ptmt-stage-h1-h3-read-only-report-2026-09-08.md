# PTMT Stage H1 and H3 read-only report

**Date:** 2026-09-08  
**Scope:** H1 and H3 only. No normalizer, roster logic, database, override, plan, scheduler, validation, deployment, or production changes were made. H2 and H4 were not started.

## Stage H1 — duplicate guard sizing

### H1.1 Current effective roster

The current effective PTMT roster returned **3,584 rows**. The #2419 result snapshot also contains **3,584 rows**. Applying the existing `normalizeCodeStrict` to the roster produces:

| Measure | Value |
|---|---:|
| Strict-key sets with 2+ roster rows | 568 |
| Sets containing exactly 2 rows | 190 |
| Sets containing 3+ rows | 378 |
| Demand in all affected #2419 rows | 519,416.96 |
| Sets involving more than one raw spelling | 7 |
| Sets involving one raw spelling repeated by colour | 561 |

The **561 single-spelling sets** are normal colour-variant rows sharing a code. A literal guard of “no two roster rows share a normalized code key” would report these colour variants as duplicates even though the raw code is identical.

The seven current strict-key sets involving multiple raw spellings are:

| Strict key | Raw spellings | Roster rows | Entry paths represented | #2419 demand |
|---|---|---:|---|---:|
| 1231F | `1231-F`, `1231F` | 7 | item-master path for `1231-F`; rate-list path for `1231F` | 0.00 |
| 129I | `129-I`, `129I` | 3 | item-master path for `129-I`; rate-list path for `129I` | 0.00 |
| 129QW | `129-QW`, `129QW` | 2 | item-master path for `129-QW`; rate-list path for `129QW` | 0.00 |
| 130C | `130-C`, `130C` | 7 | item-master path for `130-C`; rate-list path for `130C` | 115.00 |
| 132I | `132-I`, `132I` | 3 | item-master path for `132-I`; rate-list path for `132I` | 0.00 |
| 132T | `132-T`, `132T` | 7 | item-master path for `132-T`; rate-list path for `132T` | 6,099.67 |
| 133NEW | `133-NEW`, `133NEW` | 7 | item-master path for `133-NEW`; rate-list path for `133NEW` | 136.00 |

These seven spelling-collision groups carry **6,350.67 pieces** in #2419. The complete group inventory is saved in `stage-h1-duplicate-roster-sets.csv`; the 561 colour-only groups are also represented there through the source roster probe and the raw source data.

### H1.2 MRP evidence for the seven spelling groups

The current loadable PTMT MRP contains one exact product row for the hyphenated spelling in each group. It does not contain a second MRP product row for the unhyphenated spelling. The MRP evidence is therefore a single product identity under the strict key, not two independently described products:

| Strict key | MRP row | Series | Product name | Discontinued |
|---|---|---|---|---|
| 1231F | `1231-F` | Roman | Bib Cock Fancy 15mm (R.H.) (Foam Flow) with Flange | false |
| 129I | `129-I` | Ibix | 2 Way Bib Cock Foam Flow with Flange | false |
| 129QW | `129-QW` | Quadra (Wine) | 2 Way Bib Cock (Foam Flow) with Flange | false |
| 130C | `130-C` | Cobra | Pillar Cock 15mm with Flange | false |
| 132I | `132-I` | Ibix | Sink Cock Foam Flow with Flange | false |
| 132T | `132-T` | Standard (New Handle) | Sink Cock Swan Neck Small Spout Foam Flow with Flange | false |
| 133NEW | `133-NEW` | Standard (New Handle) | Sink Cock (Swing Arm) T/M Foam Flow with Flange | false |

All seven MRP rows are loadable and have no `discontinued_from` value. The `129-QW`/`129QW` pair has a rate-list category difference in the current roster (`Cocks Premium` versus `Cocks Standard`), but there is no second MRP product row establishing a separate product.

The leading-zero examples from G1 do not collide under `normalizeCodeStrict`: `PMS-091`/`PMS-91`, `PIF-007`/`PIF-07`, `BA-02S`/`BA-2S`, and the other leading-zero groups remain different strict keys.

### H1.3 Construction point

The complete roster exists immediately before the return at `rate-list.ts:483` in `buildEffectivePtmtRosterWithClassifier`. This is the single construction point used by:

- `getEffectivePtmtRoster()` at `rate-list.ts:628`;
- the exported `buildEffectivePtmtRoster()` wrapper at `rate-list.ts:493`;
- PTMT plan-building callers at `routes/plan.ts:1182` and `routes/plan.ts:2947`.

The exported wrapper and the live loader both delegate to the same private construction function. No separate production roster-construction route was found. A guard placed at the end of `buildEffectivePtmtRosterWithClassifier` would therefore be on the construction path, rather than only on a reporting path.

### H1 consequence for H2

The measured current roster means the H2 wording cannot be applied literally without treating legitimate colour variants as duplicate products:

- 568 strict-key sets would be reported;
- 561 of those use only one raw code and differ by colour rows;
- 7 use multiple raw spellings;
- the seven spelling groups carry 6,350.67 pieces;
- all affected strict-key sets carry 519,416.96 pieces when colour rows are included.

H2 was not implemented. Any approved guard needs an explicit decision about whether its identity is code-only, code-plus-colour, or specifically multiple raw spellings under one strict key.

## Stage H3 — roster admission candidates

Stage F1 identified **21** loadable MRP + Prayag-evidence codes absent from the current roster, with **15,038.50 pieces** of candidate demand.

### H3.1 `3272-BC` Waste Pipes check

- `3272-BC` is present on Prayag evidence under `WASTE PIPE` / `Waste Pipes`.
- The Stage F1 candidate calculation assigns **6,912.00 pieces** of demand.
- Current #2419 Waste Pipes demand: **51,052.00**.
- Adding `3272-BC`: **57,964.00**.
- Prayag consistently clamped comparison figure: **52,361.00**.
- Difference after admission against the clamped figure: **+5,603.00**.
- Prayag’s published raw Waste Pipe sum: **43,070.00**.
- Difference after admission against the published raw figure: **+14,894.00**.

If current app-only Waste Pipe rows are set aside first, the current app figure is **49,385.00** after removing **1,667.00** of Waste Pipe app-only demand. Adding `3272-BC` gives **56,297.00**, which is **+3,936.00** against 52,361 and **+13,227.00** against 43,070.

The row-level comparison export separately records `manual_plan=2,976` for `3272-BC`, while the Stage F1 candidate planning calculation records 6,912.00. Both values are preserved here as source values; no reconciliation or plan change was performed.

### H3.2 Eight P.V.C. Connections candidates

All eight have Prayag CONNECTION-tab evidence and loadable MRP rows with series `P.V.C. Connections`:

| Code | Candidate demand |
|---|---:|
| 322 | 0.00 |
| 323-H | 0.00 |
| 324-H | 4,327.50 |
| 325-H | 0.00 |
| 326-H | 250.00 |
| 328-C | 491.00 |
| 348 | 2,822.00 |
| 350 | 210.00 |
| **Total** | **8,100.50** |

Current #2419 P.V.C. Connections demand is **123,842.00**, against Prayag’s **93,458.00**.

- After admitting the eight candidates: **131,942.50**.
- Difference against Prayag: **+38,484.50**.
- Current app-only P.V.C. demand: **38,748.00**.
- After setting app-only P.V.C. rows aside: **85,094.00**.
- After then adding the eight candidates: **93,194.50**.
- Difference against Prayag after setting app-only rows aside: **−263.50**.

### H3.3 Seven zero-demand candidates

These seven candidates have zero 3-month average, zero stock, zero current pending, and zero dummy/last-month pending in the Stage F1 source snapshot:

- `124-T`
- `146-D`
- `146-I`
- `146-R`
- `148-D`
- `148-I`
- `148-R`

All seven have loadable MRP rows, `discontinued=false`, and `discontinued_from=null`. Their MRP series are `Special Cock`, `Delta`, `Ibix`, and `Ovian` as appropriate.

The PTMT plan builder maps every effective roster item through the item construction at `routes/plan.ts:1323`; there is no zero-demand filter at that point. If admitted, these seven would therefore create roster/plan items whose calculated demand is zero, rather than disappearing before calculation.

## Read-only outputs

- `.agents/outputs/ptmt-stage-h1-h3-read-only-report-2026-09-08.md`
- `.agents/outputs/stage-h1-duplicate-roster-sets.csv`
- `.agents/outputs/stage-h3-roster-candidates.csv`

H2 and H4 remain unstarted and require explicit approval.

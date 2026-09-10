# PTMT Stage E read-only investigation

**Date:** 2026-09-08  
**Run:** draft Temporary Plan #2419  
**Scope:** stored rows only. No database writes, override changes, plan creation, recompute, validation endpoint, scheduler, production, or deployment work was performed.

## Evidence and pairing

- Stored inputs: 3,584 rows.
- Stored results: 3,584 rows.
- E2 pairs inputs/results by ascending persisted row id within run #2419.
- Run #2419 remains a draft.
- The displayed B4 target values sum to **686,766** exactly; the source query labels the sum as 686,767.

## E1.1–E1.2: P.V.C. Connections roster trace

Five exact normalized codes are shared by #2419 and Prayag's CONNECTION tab:

**321, 323, 324, 325, 326**

The 26 #2419 P.V.C. Connections codes not present on the CONNECTION tab are:

`321-K, 322-K, 323-HK, 323-K, 323-ZK, 324-HK, 324-K, 324-ZK, 325-HK, 325-K, 325-ZK, 326-HK, 326-K, 326-ZK, 328 K, 328-ZK, 330-ZK, 332-ZK, 348-K, 350-K, PTA-65, PTA-66, PTA-67, PTA-68, PTA-69, PTA-70`

The eight suspected missing codes all have MRP rows and Prayag CONNECTION-tab evidence, but are absent from both the rate list and #2419:

| Code | MRP | Rate list | Prayag CONNECTION | #2419 | #2419 demand |
|---|---:|---:|---:|---:|---:|
| 322 | yes | no | yes | no | 0 |
| 348 | yes | no | yes | no | 0 |
| 350 | yes | no | yes | no | 0 |
| 323-H | yes | no | yes | no | 0 |
| 324-H | yes | no | yes | no | 0 |
| 325-H | yes | no | yes | no | 0 |
| 326-H | yes | no | yes | no | 0 |
| 328-C | yes | no | yes | no | 0 |

They do not enter through the current item-master roster, a reviewed catalogue promotion, or the explicit MRP-only LUXOR/GLORY bridge. Therefore category evidence never gets a chance to classify them into the executable roster. Rate-list membership is part of this no-source path, but it is not a universal gate: existing item-master rows, reviewed catalogue rows, and the explicit MRP bridge can enter by other paths.

## E1.3: MRP rows absent from rate list and effective roster

- MRP PTMT codes: **2,121**.
- Rate-list PTMT codes: **1,424**.
- Effective #2419 code set: **1,704**.
- MRP codes absent from the rate list and absent from the effective #2419 roster: **630**.
- Available September-workbook three-month-average-sale total for that set: **13,042.33 pieces/month**.

The detailed list is in `.agents/outputs/stage-e-mrp-excluded-absent-rate-list.csv`. This is the operational exclusion set after the explicit roster exceptions; it does not mean every MRP row lacking a rate-list row is excluded.

## E1.4: Exact MRP joins

The implementation normalizer is:

```ts
String(itemCode ?? "").trim().toUpperCase().replace(/\.0$/, "")
```

It does not remove hyphens or spaces.

- #2419 codes failing the exact normalized MRP join: **213**.
- Demand carried by those failed-join codes: **45,542.69 pieces**.
- Codes among them that would join if hyphens/spaces were stripped: **19**.

Those 19 are: `1231F, 129I, 129QW, 130C, 132-2U, 132I, 132T, 133NEW, 322-K, 323-K, 324-K, 325-K, 326-K, 348-K, 501-N, 501-S, 503-N, 701-N, DB-02 L`.

The complete 213-code list is in `.agents/outputs/stage-e-run2419-mrp-join-failures.csv`.

## E2.1: Colour-level versus code-level reaggregation

Colour-level is `sum(max(unclamped colour row, 0))`. Code-level first sums unclamped rows across colours for each category/code, then clamps once.

| Category | Colour-level | Code-level | Colour preservation | Supplied Prayag target | Colour minus target |
|---|---:|---:|---:|---:|---:|
| Cocks Standard | 419,521.64 | 390,172.63 | 29,349.01 | 338,700 | +80,821.64 |
| Cocks Premium | 21,052.31 | 21,052.31 | 0.00 | 20,866 | +186.31 |
| Faucets & Jetsprays & Shower | 70,691.01 | 65,798.67 | 4,892.34 | 65,864 | +4,827.01 |
| Accessorise | 24,345.66 | 19,215.99 | 5,129.67 | 20,870 | +3,475.66 |
| Cistern & Seat Cover | 40,406.66 | 37,656.65 | 2,750.01 | 36,069 | +4,337.66 |
| Cabinet | 1,647.67 | 1,607.67 | 40.00 | 1,285 | +362.67 |
| Ball Cock | 59,598.31 | 58,064.31 | 1,534.00 | 57,293 | +2,305.31 |
| P.V.C. Connections | 123,841.51 | 123,841.51 | 0.00 | 93,458 | +30,383.51 |
| Waste Pipes | 51,052.03 | 51,052.03 | 0.00 | 52,361 | -1,308.97 |
| Unclassified | 767.00 | 767.00 | 0.00 | — | — |
| **Total** | **812,923.80** | **769,228.77** | **43,695.03** | — | — |

The nine named categories total **812,156.80** in the stored reaggregation, matching the stated B5 total to floating-point precision.

## E2.2: Shared-code reaggregation

Prayag-only demand below uses the September workbook `PRODUCTION REQUIRED Sep' 2026` column, clamped at zero per code. Expected shared demand is the supplied Prayag target minus that positive Prayag-only demand.

| Category | Shared #2419 code total | Prayag-only codes | Prayag-only demand | Expected | Difference |
|---|---:|---:|---:|---:|---:|
| Cocks Standard | 357,489.30 | 17 | 2,749.00 | 335,951.00 | +21,538.30 |
| Cocks Premium | 20,792.31 | 10 | 54.20 | 20,811.80 | -19.49 |
| Faucets & Jetsprays & Shower | 65,740.67 | 1 | 150.00 | 65,714.00 | +26.67 |
| Accessorise | 18,179.99 | 17 | 2,836.00 | 18,034.00 | +145.99 |
| Cistern & Seat Cover | 36,061.99 | 0 | 0.00 | 36,069.00 | -7.01 |
| Cabinet | 1,284.67 | 0 | 0.00 | 1,285.00 | -0.33 |
| Ball Cock | 56,400.31 | 0 | 0.00 | 57,293.00 | -892.69 |
| P.V.C. Connections | 85,093.51 | 8 | 8,100.50 | 85,357.50 | -263.99 |
| Waste Pipes | 49,385.03 | 5 | 6,912.00 | 45,449.00 | +3,936.03 |

There are 58 Prayag-only codes and **20,801.70 pieces** of positive sheet demand in total. The complete list is in `.agents/outputs/stage-e-prayag-only-codes.csv`.

## E2.3: Largest colour-level clamp effects

Across #2419, colour-level clamping preserves **43,695.03 pieces** versus code-level clamping and affects **206 category/code identities**.

| Rank | Category | Code | Code unclamped | Colour total | Preserved | Non-zero colour breakdown |
|---:|---|---|---:|---:|---:|---|
| 1 | Cocks Standard | 123 | 2,811.34 | 8,864.67 | 6,053.33 | IVORY 8,839.67; PINK 25.00 |
| 2 | Cocks Standard | 124 | 1,105.33 | 3,982.33 | 2,877.00 | WHITE 3,982.33 |
| 3 | Accessorise | 103 | 1,559.00 | 3,869.00 | 2,310.00 | WHITE 3,869.00 |
| 4 | Faucets & Jetsprays & Shower | HF-190 | 265.33 | 1,837.00 | 1,571.67 | WHITE 1,837.00 |
| 5 | Cocks Standard | 139 | 2,665.34 | 4,016.67 | 1,351.33 | WHITE 4,016.67 |
| 6 | Cocks Standard | 142 | 2,125.00 | 3,427.00 | 1,302.00 | IVORY 1,848.00; PINK 1,579.00 |
| 7 | Cistern & Seat Cover | 513 | 4,521.99 | 5,792.33 | 1,270.34 | WHITE 5,792.33 |
| 8 | Cocks Standard | 120-M | -203.00 | 1,150.00 | 1,150.00 | WHITE 1,150.00 |
| 9 | Accessorise | 195 | 123.66 | 1,214.33 | 1,090.67 | WHITE 1,214.33 |
| 10 | Cocks Standard | 144-H | -992.67 | 1,038.33 | 1,038.33 | WHITE 1,038.33 |

The detailed colour rows are in `.agents/outputs/stage-e-clamp-top10.csv`.

## Read-only output files

- `.agents/outputs/stage-e-run-2419-inputs.csv`
- `.agents/outputs/stage-e-run-2419-results-full.csv`
- `.agents/outputs/stage-e-mrp-excluded-absent-rate-list.csv`
- `.agents/outputs/stage-e-run2419-mrp-join-failures.csv`
- `.agents/outputs/stage-e-prayag-only-codes.csv`
- `.agents/outputs/stage-e-clamp-top10.csv`

No existing plan, override, source, or production state was changed.

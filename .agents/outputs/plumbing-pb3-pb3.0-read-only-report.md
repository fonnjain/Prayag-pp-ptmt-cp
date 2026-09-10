# Plumbing Stage B — PB3.0 Read-only evidence report

**Date:** 8 September 2026  |  **Scope:** PB3.0 only  |  **Mode:** read-only

## Boundary and constraints

- No upload, source row, override, scheduler, normalizer, plan, plan run, or deployment was changed.
- No recompute, recompute-monthly, or `/api/plan/validate` was run.
- The September roster was read from the CPVC, UPVC, SWR, and AGRI workbook tabs: 1,140 parsed rows and 1,120 effective normalized roster codes.
- Upload #13 is the current stored comparison source: 1,062 rows/codes. Upload #8 is the predecessor stored source: 1,042 rows.

## Executive result

- 203 of 1,062 upload #13 codes do not join the effective September roster.
- Missing positive stock: **110,462 pieces** — upward pressure on production.
- Missing negative Net Stock / pending-last-month: **-9,370 pieces** — downward pressure on production.
- Gross directional estimate before item-level `max(..., 0)` clamping: **+101,092 pieces** (`110,462 - 9,370`). This is an estimate, not a recomputed plan delta.

## PB3.0.1–PB3.0.3 — Code list and classification

The full 203-row list is in `plumbing-pb3-missing-september-roster.csv`.

| Classification | Rows | Positive | Negative | Net source quantity |
|---|---:|---:|---:|---:|
| Likely code spelling/format variant | 9 | 1,055 | -1,067 | -12 |
| Other: material-specific Trading semantic mapping | 5 | 1,649 | -525 | 1,124 |
| Genuinely absent after normalized-code check | 106 | 66,802 | -5,701 | 61,101 |
| Unplanned division/category | 83 | 40,956 | -2,077 | 38,879 |

### Category subtotals

| Source category | Rows | Missing positive stock | Missing negative pending | Directional effect |
|---|---:|---:|---:|---:|
| AGRI FG | 46 | 35,324 | -1,445 | +33,879 |
| AGRI-FG | 25 | 24,161 | -388 | +23,773 |
| AGRI-PIPE | 5 | 411 | -705 | -294 |
| Agri-Trading | 3 | 1,393 | -525 | +868 |
| CPVC FG | 3 | 137 | -128 | +9 |
| CPVC FITTING | 1 | 0 | -300 | -300 |
| CPVC-FG | 7 | 516 | -193 | +323 |
| CPVC-TRADING | 2 | 256 | 0 | +256 |
| Colum Pipe | 6 | 1,820 | 0 | +1,820 |
| PPR Fittimg | 13 | 37,255 | 0 | +37,255 |
| SWR FG | 7 | 4,326 | -1,927 | +2,399 |
| SWR-FG | 2 | 411 | -160 | +251 |
| SWR-PIPE | 2 | 101 | 0 | +101 |
| SWR-TRADING | 3 | 934 | -421 | +513 |
| Trading | 13 | 1,376 | -1,486 | -110 |
| UPVC -FG | 1 | 7 | 0 | +7 |
| UPVC FITTING | 1 | 0 | -320 | -320 |
| UPVC PIPE FG | 2 | 355 | 0 | +355 |
| UPVC-FG | 8 | 1,174 | -636 | +538 |
| WATER TANK | 51 | 505 | -591 | -86 |
| cpvc fg | 2 | 0 | -145 | -145 |

### Notes

- Class a (83 rows) is exact unplanned category evidence: WATER TANK, PPR Fittimg, Colum Pipe, and generic Trading.
- Class b (9 rows) has direct aliases: C230L→C230-L, CF12→CF-12, C49N→C49-N, UH-78/UH-79/UH-80→UH78/UH79/UH80, and RL-2/RL-3/RL-4→RL02/RL03/RL04. No alias was applied.
- Class c (106 rows) has no normalized code match in the effective September workbook. This does not approve expanding the roster.
- Class d (5 rows) is material-specific Trading data needing a business mapping decision; it was not silently reclassified.

## PB3.0.2 — Recurrence and guard

- The -9,370 is the same reviewed Plumbing roster-boundary exclusion recorded in `artifacts/api-server/src/routes/plan.ts`: source=486,033, joined=476,663, excluded=9,370.
- The same policy records predecessor upload #8 as source=544,544, joined=530,961, excluded=13,583.
- The current plan-construction path contains `assertPendingJoinIdentity(...)`, which checks reconciliation identity, source mismatch, reviewed limits, and fingerprint, then refuses a partial plan.
- Older task/prompt evidence describes the historical gap before this guard existed; it is not evidence that the present path remains unguarded.

## PB3.0.4 — Category vocabulary

The complete 28-label table is in `plumbing-pb3-category-variants.csv`; no canonical mapping was changed.

| Raw category | Uploads | Rows | Positive | Negative | Roster present | Roster absent |
|---|---|---:|---:|---:|---:|---:|
| . | 13 | 1 | 241 | 0 | 1 | 0 |
| AGRI FG | 8;13 | 92 | 68,173 | -3,919 | 2 | 90 |
| AGRI PIPE FG | 8;13 | 4 | 542 | 0 | 4 | 0 |
| AGRI-FG | 8;13 | 212 | 99,903 | -23,504 | 162 | 50 |
| AGRI-PIPE | 8;13 | 12 | 937 | -959 | 2 | 10 |
| Agri-Pipe | 8;13 | 92 | 26,564 | -9,170 | 92 | 0 |
| Agri-Trading | 8;13 | 6 | 2,238 | -1,362 | 0 | 6 |
| CPVC FG | 8;13 | 7 | 306 | -480 | 0 | 7 |
| CPVC FITTING | 13 | 1 | 0 | -300 | 0 | 1 |
| CPVC-FG | 8;13 | 440 | 421,982 | -294,717 | 425 | 15 |
| CPVC-PIPE | 8;13 | 58 | 11,330 | -66,998 | 58 | 0 |
| CPVC-TRADING | 8;13 | 42 | 117,381 | -5,549 | 38 | 4 |
| Colum Pipe | 8;13 | 12 | 3,640 | 0 | 0 | 12 |
| PPR Fittimg | 8;13 | 22 | 72,676 | 0 | 0 | 22 |
| SWR FG | 8;13 | 13 | 10,469 | -2,248 | 0 | 13 |
| SWR-FG | 8;13 | 254 | 100,772 | -158,227 | 250 | 4 |
| SWR-PIPE | 8;13 | 106 | 5,924 | -65,249 | 102 | 4 |
| SWR-TRADING | 8;13 | 6 | 2,048 | -442 | 0 | 6 |
| Trading | 8;13 | 27 | 2,722 | -3,532 | 0 | 27 |
| UPVC -FG | 8;13 | 2 | 14 | 0 | 0 | 2 |
| UPVC FITTING | 8;13 | 2 | 0 | -384 | 0 | 2 |
| UPVC PIPE | 8 | 1 | 0 | -60 | 0 | 1 |
| UPVC PIPE FG | 8;13 | 4 | 355 | -2,775 | 0 | 4 |
| UPVC-FG | 8;13 | 467 | 218,108 | -367,764 | 451 | 16 |
| UPVC-PIPE | 8;13 | 89 | 55,505 | -21,806 | 89 | 0 |
| UPVC-TRADING | 8;13 | 34 | 121,886 | 0 | 34 | 0 |
| WATER TANK | 8;13 | 94 | 1,168 | -811 | 0 | 94 |
| cpvc fg | 8;13 | 4 | 0 | -321 | 0 | 4 |

## PB3.0.5 — Direction estimate

The exact plan delta cannot be inferred from aggregate quantities alone because the plan clamps each item-level requirement at zero and depends on buffer, current pending, and last-month pending. The +101,092 value is gross directional evidence only.

## Disposition

PB3.0 is complete as a read-only evidence pass. PB3.1–PB3.4 remain unimplemented and require Nishant’s explicit approval. PTMT Stage H4a/I remain unaffected.

## Evidence files

- `plumbing-pb3-pb3.0-read-only-report.docx`
- `plumbing-pb3-missing-september-roster.csv`
- `plumbing-pb3-category-variants.csv`
- `plumbing-pb3-direction-estimate.csv`
- `plumbing-pb3-class-summary.csv`

## Appendix — all 203 absent codes

| Code | Item name | Source category | Net Stock | Class | Alias / reason |
|---|---|---|---:|:---:|---|
| C230L | 1/2" CPVC EXPANSION LOOP | CPVC-FG | 50 | b | C230-L |
| CF12 | 2-1/2" CPVC SOCKET FLANGE | CPVC-FG | -10 | b | CF-12 |
| EWS04 | CPVC SOLVENT -118ML-TIN (PR) | CPVC-TRADING | 88 | d | material-specific Trading category; roster semantic mapping not established |
| EWS05 | CPVC SOLVENT -237ML-TIN (PR) | CPVC-TRADING | 168 | d | material-specific Trading category; roster semantic mapping not established |
| U21T L | 1/2" THREAD BALL VALVE 20MM (LONG LEVER) | UPVC-FG | 300 | c | not present under normalized code in effective September roster |
| U22TL | 3/4"THREAD BALL VALVE 25MM (LONG LEVER) | UPVC-FG | 400 | c | not present under normalized code in effective September roster |
| U23TL | 1" THREAD BALL VALVE 32MM (LONG LEVER) | UPVC-FG | 440 | c | not present under normalized code in effective September roster |
| UH-78 | 3/4" UPVC  URBONA-CONCEALED VALVE Q/T | UPVC-FG | -496 | b | UH78 |
| UH-79 | 3/4" UPVC  SPA-CONCEALED VALVE Q/T | UPVC-FG | -140 | b | UH79 |
| UH-80 | 3/4" UPVC  VIVA-CONCEALED VALVE Q/T | UPVC-FG | 14 | b | UH80 |
| U27 L | 2-1/2" UPVC BALL VAVLE (Long Handle) | UPVC-FG | 17 | c | not present under normalized code in effective September roster |
| U28L | 3" UPVC BALL VAVLE (Long Handle) | UPVC-FG | 3 | c | not present under normalized code in effective September roster |
| 5771-W | SWR FITTING P TRAP W/Gasket (125X110MM) | SWR-FG | 411 | c | not present under normalized code in effective September roster |
| RL-2 | RUBBER LUBRICANT 100g | SWR-TRADING | -421 | b | RL02 |
| RL-3 | RUBBER LUBRICANT 250g | SWR-TRADING | 295 | b | RL03 |
| RL-4 | RUBBER LUBRICANT 500g | SWR-TRADING | 639 | b | RL04 |
| S45 | 250 ML TIN PVC SOLVENT CEMENT | Agri-Trading | -525 | d | material-specific Trading category; roster semantic mapping not established |
| S46 | 500 ML TIN PVC SOLVENT CEMENT | Agri-Trading | 1,082 | d | material-specific Trading category; roster semantic mapping not established |
| S47 | 1000 ML TIN PVC SOLVENT CEMENT | Agri-Trading | 311 | d | material-specific Trading category; roster semantic mapping not established |
| WT-002 | PLASTIC LIDS LIGHT. | WATER TANK | -18 | a | unplanned division/category |
| WT-3LL-05 | Water Tank 3 layer Light 500 Ltr. | WATER TANK | 151 | a | unplanned division/category |
| WT-3LL-07 | Water Tank 3 layer Light 750 Ltr. | WATER TANK | 104 | a | unplanned division/category |
| WT-3LL-10 | Water Tank 3 layer Light 1000 Ltr. | WATER TANK | 9 | a | unplanned division/category |
| WT-3LL-15 | Water Tank 3 layer Light 1500 Ltr. | WATER TANK | 1 | a | unplanned division/category |
| WT-3LL-20 | Water Tank 3 layer Light 2000 Ltr. | WATER TANK | 2 | a | unplanned division/category |
| WT-3LL-30 | Water Tank 3 layer Light 3000 Ltr. | WATER TANK | 6 | a | unplanned division/category |
| WT-3LL-50 | Water Tank 3 layer Light 5000 Ltr. | WATER TANK | 5 | a | unplanned division/category |
| WT-3LH-05 | Water Tank 3 layer heavy  500 Ltr. | WATER TANK | 4 | a | unplanned division/category |
| WT-3LH-07 | Water Tank 3 layer heavy  750 Ltr. | WATER TANK | 3 | a | unplanned division/category |
| WT-3LH-15 | Water Tank 3 layer heavy  1500 Ltr. | WATER TANK | 1 | a | unplanned division/category |
| WT-4LL-05 | Water Tank 4 layer Light 500 Ltr. | WATER TANK | -27 | a | unplanned division/category |
| WT-4LL-07 | Water Tank 4 layer Light 750 Ltr. | WATER TANK | -5 | a | unplanned division/category |
| WT-4LL-10 | Water Tank 4 layer Light 1000 Ltr. | WATER TANK | 13 | a | unplanned division/category |
| WT-4LL-15 | Water Tank 4 layer Light 1500 Ltr. | WATER TANK | 2 | a | unplanned division/category |
| WT-4LL-20 | Water Tank 4 layer Light 2000 Ltr. | WATER TANK | 1 | a | unplanned division/category |
| WT-4LH-05 | Water Tank 4 layer heavy  500 Ltr. | WATER TANK | 15 | a | unplanned division/category |
| WT-4LH-07 | Water Tank 4 layer heavy  750 Ltr. | WATER TANK | 2 | a | unplanned division/category |
| WT-4LH-10 | Water Tank 4 layer heavy  1000 Ltr. | WATER TANK | 2 | a | unplanned division/category |
| WT-4LH-20 | Water Tank 4 layer heavy  2000 Ltr. | WATER TANK | 3 | a | unplanned division/category |
| WT-ISI-05 | Water Tank 2 layer ISI  500 Ltr. | WATER TANK | -24 | a | unplanned division/category |
| WT-ISI-10 | Water Tank 2 layer ISI  1000 Ltr. | WATER TANK | -25 | a | unplanned division/category |
| WT-ISI-20 | Water Tank 2 layer ISI  2000 Ltr. | WATER TANK | 2 | a | unplanned division/category |
| PW91C | SWR PIPE TYPE A-SS 90MM 3"/12FT | SWR-PIPE | 65 | c | not present under normalized code in effective September roster |
| PW11C | SWR PIPE TYPE A-SS 90MM 3"/12FT | SWR-PIPE | 36 | c | not present under normalized code in effective September roster |
| C49N | 6" COUPLING | CPVC-FG | 57 | b | C49-N |
| A-504 | ELBOW 45- 6 KG, 63MM AGRI | AGRI-FG | 228 | c | not present under normalized code in effective September roster |
| A-503 | ELBOW 45- 6 KG, 50MM AGRI | AGRI-FG | -119 | c | not present under normalized code in effective September roster |
| A-505 | ELBOW 45- 6 KG, 75MM AGRI | AGRI-FG | 431 | c | not present under normalized code in effective September roster |
| A-228 | coupler- 2.5 KG, 90MM AGRI | AGRI-FG | 1,421 | c | not present under normalized code in effective September roster |
| A-428 | AGRI EQUAL ELBOW 90 (2.5 Kg | AGRI-FG | 299 | c | not present under normalized code in effective September roster |
| A-328 | AGRI EQUAL TEE 90 (2.5 Kg | AGRI-FG | 857 | c | not present under normalized code in effective September roster |
| A-229 | coupler- 2.5 KG, 10MM AGRI | AGRI-FG | 229 | c | not present under normalized code in effective September roster |
| A-327 | EQUAL TEE 2.5 KG, 75MM AGRI | AGRI-FG | 113 | c | not present under normalized code in effective September roster |
| A-227 | COUPLER 2.5 KG, 75MM AGRI | AGRI-FG | 206 | c | not present under normalized code in effective September roster |
| A-427 | AGRI EQUAL ELBOW 75 (2.5 Kg | AGRI-FG | 1,257 | c | not present under normalized code in effective September roster |
| A-702 | BUSH 4KG, 50X40MM, AGRI | AGRI-FG | 5,128 | c | not present under normalized code in effective September roster |
| A-704 | BUSH 4KG, 75X110MM, AGRI | AGRI-FG | -37 | c | not present under normalized code in effective September roster |
| A-703 | BUSH 4KG, 75X50MM, AGRI | AGRI-FG | -38 | c | not present under normalized code in effective September roster |
| A-329 | EQUAL TEE 2.5 KG, 110MM AGRI | AGRI-FG | 2,415 | c | not present under normalized code in effective September roster |
| CH88 | 25MM CANCELLED VALVE QUARTER TURN.WITH URBONA-HANDLE | CPVC-FG | -96 | c | not present under normalized code in effective September roster |
| CH86 | 25MM CANCELLED VALVE QUARTER TURN.WITH MACASA-HANDLE | CPVC-FG | 14 | c | not present under normalized code in effective September roster |
| A-429 | AGRI EQUAL ELBOW 110 (2.5 Kg | AGRI-FG | 1,840 | c | not present under normalized code in effective September roster |
| CH84 | 25MM CANCELLED VALVE QUARTER TURN.WITH GREACIA-HANDLE | CPVC-FG | -87 | c | not present under normalized code in effective September roster |
| WT-ISI-15 | Water Tank 2 layer ISI  1500 Ltr. | WATER TANK | 2 | a | unplanned division/category |
| AS-329 | AGRI EQUAL TEE 110 | AGRI-FG | 1,344 | c | not present under normalized code in effective September roster |
| AS-429 | AGRI EQUAL ELBOW 110 | AGRI-FG | 791 | c | not present under normalized code in effective September roster |
| AS-328 | AGRI EQUAL TEE 90 | AGRI-FG | 449 | c | not present under normalized code in effective September roster |
| AS-428 | AGRI EQUAL ELBOW 90 | AGRI-FG | -66 | c | not present under normalized code in effective September roster |
| AS-229 | AGRI COUPLER PN-7110 | AGRI-FG | 667 | c | not present under normalized code in effective September roster |
| AS-327 | AGRI EQUAL TEE 75 | AGRI-FG | 2,211 | c | not present under normalized code in effective September roster |
| 5792 | MULTIFLOOR TRAPE 110X75X50 MM | SWR-FG | -160 | c | not present under normalized code in effective September roster |
| AS-227 | AGRI COUPLER PN-575 | AGRI-FG | 3,267 | c | not present under normalized code in effective September roster |
| C324 | BRASS TEA-25X25X25 | CPVC-FG | 395 | c | not present under normalized code in effective September roster |
| AS-427 | AGRI EQUAL ELBOW 75 | AGRI-FG | 422 | c | not present under normalized code in effective September roster |
| AS-228 | AGRI COUPLER PN-690 | AGRI-FG | 586 | c | not present under normalized code in effective September roster |
| CH82F | 3/4" CPVC TRIANGLE CONCEALED VALVE | CPVC FG | -128 | c | not present under normalized code in effective September roster |
| PU-4TB | THREADED PIPE SCH 80 32 MM | UPVC PIPE FG | 345 | c | not present under normalized code in effective September roster |
| AS-449 | AGRI ELBOW 90⁰ 110 | AGRI FG | -576 | c | not present under normalized code in effective September roster |
| AS-446 | AGRI ELBOW 90⁰ 63 | AGRI FG | -60 | c | not present under normalized code in effective September roster |
| AS-448 | AGRI ELBOW 90⁰ 90 | AGRI FG | -340 | c | not present under normalized code in effective September roster |
| AS-447 | AGRI ELBOW 90⁰ 75 | AGRI FG | 1,046 | c | not present under normalized code in effective September roster |
| AS-346 | AGRI EQUAL TEE 63 | AGRI FG | 600 | c | not present under normalized code in effective September roster |
| AS-349 | AGRI EQUAL TEE 110 | AGRI FG | -3 | c | not present under normalized code in effective September roster |
| AS-347 | AGRI EQUAL TEE 110 | AGRI FG | 1,440 | c | not present under normalized code in effective September roster |
| PU-5TB | THREADED PIPE SCH 80 40 MM | UPVC PIPE FG | 10 | c | not present under normalized code in effective September roster |
| CH90F | 25 MM FULL TURN CONCEALED VALVE VIVA | CPVC FG | 32 | c | not present under normalized code in effective September roster |
| AS-249 | 110MM COUPLER4 KG/CM2 | AGRI FG | 548 | c | not present under normalized code in effective September roster |
| AS-348 | AGRI EQUAL TEE 90 | AGRI-FG | -128 | c | not present under normalized code in effective September roster |
| MHC-10 | MANHOLE COVER 770 X 770 | Trading | 89 | a | unplanned division/category |
| MHC-09 | MANHOLE COVER 720 X 720 | Trading | 55 | a | unplanned division/category |
| MHC-08 | MANHOLE COVER 600 X 600 | Trading | -160 | a | unplanned division/category |
| MHC-07 | MANHOLE COVER 535 X 535 | Trading | 37 | a | unplanned division/category |
| MHC-06 | MANHOLE COVER 450 X 600 | Trading | -61 | a | unplanned division/category |
| MHC-05 | MANHOLE COVER 450 X 450 | Trading | -73 | a | unplanned division/category |
| MHC-04 | MANHOLE COVER 300 X 450 | Trading | 41 | a | unplanned division/category |
| MHC-03 | MANHOLE COVER 380 X 380 | Trading | -66 | a | unplanned division/category |
| MHC-02 | MANHOLE COVER 300 X 300 | Trading | -173 | a | unplanned division/category |
| AS-248 | 90MM COUPLER4 KG/CM2 | AGRI FG | 75 | c | not present under normalized code in effective September roster |
| PB125 | COLUMN PIPE 25 MM 10 KG/CM2 | Colum Pipe | 20 | a | unplanned division/category |
| PB225 | COLUMN PIPE 25 MM 12.5 KG/CM2 | Colum Pipe | 900 | a | unplanned division/category |
| PB132 | COLUMN PIPE 32 MM 10 KG/CM3 | Colum Pipe | 30 | a | unplanned division/category |
| PB232 | COLUMN PIPE 32 MM 12.5 KG/CM3 | Colum Pipe | 165 | a | unplanned division/category |
| PB332 | COLUMN PIPE 32 MM 15 KG/CM3 | Colum Pipe | 700 | a | unplanned division/category |
| 5793 | MULTIFLOOR TRAPE 110X75X50 MM WITH COVER | SWR FG | -356 | c | not present under normalized code in effective September roster |
| PN28C | 90MM AGRI PIPE NON ISI PN4 | AGRI-PIPE | 166 | c | not present under normalized code in effective September roster |
| PN48C | 90MM AGRI PIPE NON ISI PN6 | AGRI-PIPE | 187 | c | not present under normalized code in effective September roster |
| PN29C | 110MM AGRI PIPE NON ISI PN4 | AGRI-PIPE | -307 | c | not present under normalized code in effective September roster |
| PN49C | 110MM AGRI PIPE NON ISI PN6 | AGRI-PIPE | -398 | c | not present under normalized code in effective September roster |
| PN32C | 160MM AGRI PIPE NON ISI PN4 | AGRI-PIPE | 58 | c | not present under normalized code in effective September roster |
| CH86F | 25 MM FULL TURN CONCEALED VALVE MACASA | CPVC FG | 105 | c | not present under normalized code in effective September roster |
| PB232B | COLUMN BILLING PIPE 32 MM 12.5 KG/CM3 | Colum Pipe | 5 | a | unplanned division/category |
| AS-442 | AGRI ELBOW 90? 160 | AGRI FG | 120 | c | not present under normalized code in effective September roster |
| AS-246 | AGRI COUPLER PN-6 63 | AGRI FG | 478 | c | not present under normalized code in effective September roster |
| AS-549 | AGRI END CAP 110 | AGRI FG | -75 | c | not present under normalized code in effective September roster |
| AS-242 | AGRI COUPLER PN-10160 | AGRI FG | 154 | c | not present under normalized code in effective September roster |
| PN52C | 160MM AGRI PIPE NON ISI PN6 | AGRI FG | -5 | c | not present under normalized code in effective September roster |
| AS-443 | AGRI ELBOW 90? 200 | AGRI FG | 32 | c | not present under normalized code in effective September roster |
| 5706 | 75MM SOCKET PLUG | SWR FG | 3,772 | c | not present under normalized code in effective September roster |
| 5106 | 110MM SOCKET PLUG | SWR FG | -774 | c | not present under normalized code in effective September roster |
| 5606 | 160MM SOCKET PLUG | SWR FG | -777 | c | not present under normalized code in effective September roster |
| AS-342 | 160MM EQUAL TEE4 KG/CM2(PN-6) | AGRI FG | 60 | c | not present under normalized code in effective September roster |
| U29 L | 4" BALL VALVE (long handle) | UPVC -FG | 7 | c | not present under normalized code in effective September roster |
| 4763 | 110X63 MMNAHANI TRAP WITH JALI | SWR FG | 26 | c | not present under normalized code in effective September roster |
| 4507 | 63 MM BACK FLOW VALVE | SWR FG | -20 | c | not present under normalized code in effective September roster |
| 5707 | 75 MM BACK FLOW VALVE | Trading | 90 | a | unplanned division/category |
| 5907 | 90 MM BACK FLOW VALVE | Trading | 812 | a | unplanned division/category |
| 5107 | 110 MM BACK FLOW VALVE | Trading | -953 | a | unplanned division/category |
| 5607 | 160 MM BACK FLOW VALVE | Trading | 252 | a | unplanned division/category |
| A-213 | 32 MM COUPLER 10 KG/CM2 | AGRI FG | 2,600 | c | not present under normalized code in effective September roster |
| A-214 | 40 MM COUPLER 10 KG/CM2 | AGRI FG | 1,200 | c | not present under normalized code in effective September roster |
| A-411 | 20 MM ELBOW 10 KG/CM2 | AGRI FG | 1,700 | c | not present under normalized code in effective September roster |
| A-413 | 32 MM ELBOW 10 KG/CM2 | AGRI FG | -21 | c | not present under normalized code in effective September roster |
| A-313 | 32 MMTEE 10 KG/CM2 | AGRI FG | 400 | c | not present under normalized code in effective September roster |
| A-513 | 32 MM 45* ELBOW 10 KG/CM2 | AGRI FG | 3,200 | c | not present under normalized code in effective September roster |
| A-711 | 20X25 MM REDUCER BUSH 4 KG/CM2 | AGRI FG | 2,300 | c | not present under normalized code in effective September roster |
| A-712 | 20X32 MMREDUCER BUSH 4 KG/CM2 | AGRI FG | 1,100 | c | not present under normalized code in effective September roster |
| A-713 | 20X40 MMREDUCER BUSH 4 KG/CM2 | AGRI FG | 800 | c | not present under normalized code in effective September roster |
| A-714 | 20X50 MMREDUCER BUSH 4 KG/CM2 | AGRI FG | 480 | c | not present under normalized code in effective September roster |
| A-715 | 25X32 MMREDUCER BUSH 4 KG/CM2 | AGRI FG | 600 | c | not present under normalized code in effective September roster |
| A-717 | 25X50 MMREDUCER BUSH 4 KG/CM2 | AGRI FG | 480 | c | not present under normalized code in effective September roster |
| A-719 | 32X50 MMREDUCER BUSH 4 KG/CM2 | AGRI FG | 400 | c | not present under normalized code in effective September roster |
| A-721 | 50X63 MMREDUCER BUSH 4 KG/CM2 | AGRI FG | 10 | c | not present under normalized code in effective September roster |
| 4763W | 110X63 MMNAHANI TRAP WITHOUT JALI | SWR FG | 528 | c | not present under normalized code in effective September roster |
| A-419 | REDUCER ELBOW 4KG 110X90 | AGRI FG | -265 | c | not present under normalized code in effective September roster |
| A-509 | ELBOW 45- 4 KG 90MM AGRI | AGRI FG | 824 | c | not present under normalized code in effective September roster |
| A-510 | ELBOW 45- 4 KG 110MM AGRI | AGRI FG | 750 | c | not present under normalized code in effective September roster |
| A-311 | 20 MM EQUAL TEE  AGRI-(10 KG) | AGRI FG | 300 | c | not present under normalized code in effective September roster |
| A-211 | 20 MM COUPLER AGRI-(10 KG) | AGRI FG | 950 | c | not present under normalized code in effective September roster |
| A-412 | 25 MM ELBOW 90 AGRI-(10 KG) | AGRI FG | 2,500 | c | not present under normalized code in effective September roster |
| A-312 | 25 MM EQUAL TEE  AGRI-(10 KG) | AGRI FG | 550 | c | not present under normalized code in effective September roster |
| A-511 | 20 MM ELBOW 45  AGRI-(10 KG) | AGRI FG | 500 | c | not present under normalized code in effective September roster |
| A-512 | 45° ELBOW 10kg/cm² 25MM | AGRI FG | 900 | c | not present under normalized code in effective September roster |
| A-720 | 32X40 MM AGRI REDUCER BUSH 4 KG/CM2 | AGRI FG | 100 | c | not present under normalized code in effective September roster |
| A-718 | 32X40 MM AGRI REDUCER BUSH 4 KG/CM2 | AGRI FG | 400 | c | not present under normalized code in effective September roster |
| A-212 | 25 MM COUPLER AGRI-(10 KG) | AGRI FG | 4,600 | c | not present under normalized code in effective September roster |
| A-514 | 45° ELBOW 10kg/cm² 40MM | AGRI FG | 1,732 | c | not present under normalized code in effective September roster |
| A-515 | 50° ELBOW 10kg/cm² 40MM | AGRI FG | -100 | c | not present under normalized code in effective September roster |
| C134 | 32 mm Non Return Valve | cpvc fg | -100 | c | not present under normalized code in effective September roster |
| UH88-L | 1" UPVC  URBONA CONCEALED VALVE Q/T | UPVC FITTING | -320 | c | not present under normalized code in effective September roster |
| A-417 | 110X75 MM Red. ELBOW 10 KG/CM2 | AGRI FG | 515 | c | not present under normalized code in effective September roster |
| AS-247 | AGRI COUPLER PN-6 75 | AGRI FG | 880 | c | not present under normalized code in effective September roster |
| PP42 | Coupler 20 MM PPR FITTINGS (White Single Layer) | PPR Fittimg | 2,383 | a | unplanned division/category |
| PP54 | Elbow 90 32 MM PPR FITTINGS (White Single Layer) | PPR Fittimg | 5,515 | a | unplanned division/category |
| PP44 | Coupler 32 MM PPR FITTINGS (White Single Layer) | PPR Fittimg | 2,800 | a | unplanned division/category |
| PP64 | Equal Tee 32 MM PPR FITTINGS (White Single Layer) | PPR Fittimg | 5,715 | a | unplanned division/category |
| PP43 | Coupler 25 MM PPR FITTINGS (White Single Layer) | PPR Fittimg | 1,740 | a | unplanned division/category |
| PP63 | Equal Tee 25 MM PPR FITTINGS (White Single Layer) | PPR Fittimg | 6,017 | a | unplanned division/category |
| PP53 | Elbow 90 25 MM PPR FITTINGS (White Single Layer) | PPR Fittimg | 10,145 | a | unplanned division/category |
| PP323 | Brass Tee 25x15 MM PPR FITTINGS (White Single Layer) | PPR Fittimg | 518 | a | unplanned division/category |
| PP303 | 25x15mm male  brass tee | PPR Fittimg | 525 | a | unplanned division/category |
| WT-3LC-05 R | Water Tank 3 layer Colour 500 Ltr. | WATER TANK | 2 | a | unplanned division/category |
| WT-3LC-05 G | Water Tank 3 layer Colour 500 Ltr. | WATER TANK | 2 | a | unplanned division/category |
| WT-3LC-07 G | Water Tank 3 layer Colour  750 Ltr. | WATER TANK | 2 | a | unplanned division/category |
| WT-3LC-10 G | Water Tank 3 layer Colour  1000 Ltr. | WATER TANK | 1 | a | unplanned division/category |
| WT-3LC-15 G | Water Tank 3 layer Colour  1500 Ltr. | WATER TANK | 2 | a | unplanned division/category |
| WT-3LC-05 B | Water Tank 3 layer Colour 500 Ltr. | WATER TANK | 5 | a | unplanned division/category |
| WT-3LC-15 B | Water Tank 3 layer Colour  1500 Ltr. | WATER TANK | 1 | a | unplanned division/category |
| WT-3LC-05 LB | Water Tank 3 layer Colour 500 Ltr. | WATER TANK | 2 | a | unplanned division/category |
| WT-3LC-05 O | Water Tank 3 layer Colour 500 Ltr. | WATER TANK | 2 | a | unplanned division/category |
| WT-3LC-10 O | Water Tank 3 layer Colour  1000 Ltr. | WATER TANK | 1 | a | unplanned division/category |
| WT-4LC-05 Y | Water Tank 4 layer Colour 500 Ltr. | WATER TANK | 1 | a | unplanned division/category |
| WT-4LC-07 Y | Water Tank 4 layer Colour  750 Ltr. | WATER TANK | 1 | a | unplanned division/category |
| WCT-3LL-05 | WATER COOL TANK 3 LAYER LIGHT 500 LTR. | WATER TANK | -270 | a | unplanned division/category |
| WCT-3LL-07 | WATER COOL TANK 3 LAYER LIGHT 750 LTR. | WATER TANK | -38 | a | unplanned division/category |
| WCT-3LL-10 | WATER COOL TANK 3 LAYER LIGHT 1000 LTR. | WATER TANK | -177 | a | unplanned division/category |
| C521S | 3/4"x1/2" 90⁰ BRASS ELBOW (New) | CPVC FITTING | -300 | c | not present under normalized code in effective September roster |
| WCT-3LL-05 B | WATER COOL TANK 3 LAYER LIGHT 500 LTR. | WATER TANK | 80 | a | unplanned division/category |
| WCT-3LL-07 B | WATER COOL TANK 3 LAYER LIGHT 750 LTR. | WATER TANK | 23 | a | unplanned division/category |
| WCT-3LL-10 B | WATER COOL TANK 3 LAYER LIGHT 1000 LTR. | WATER TANK | 19 | a | unplanned division/category |
| WCT-3LL-05 Y | WATER COOL TANK 3 LAYER LIGHT 500 LTR. | WATER TANK | -2 | a | unplanned division/category |
| WCT-3LL-07 Y | WATER COOL TANK 3 LAYER LIGHT 750 LTR. | WATER TANK | -5 | a | unplanned division/category |
| C135 | 40 MM Non Return Valve | cpvc fg | -45 | c | not present under normalized code in effective September roster |
| WCT-3LL-07 G | WATER COOL TANK 3 LAYER LIGHT 750 LTR. | WATER TANK | 1 | a | unplanned division/category |
| WCT-3LL-10 G | WATER COOL TANK 3 LAYER LIGHT 1000 LTR. | WATER TANK | 2 | a | unplanned division/category |
| WCT-3LL-05 GD | WATER COOL TANK 3 LAYER LIGHT 500 LTR. | WATER TANK | 16 | a | unplanned division/category |
| WCT-3LL-07 GD | WATER COOL TANK 3 LAYER LIGHT 750 LTR. | WATER TANK | 8 | a | unplanned division/category |
| WCT-3LL-10 GD | WATER COOL TANK 3 LAYER LIGHT 1000 LTR. | WATER TANK | 4 | a | unplanned division/category |
| WCT-3LL-07 PG | WATER COOL TANK 3 LAYER LIGHT 750 LTR. | WATER TANK | 1 | a | unplanned division/category |
| WCT-3LL-10 P | WATER COOL TANK 3 LAYER LIGHT 1000 LTR. | WATER TANK | 1 | a | unplanned division/category |
| PP523 | Brass Elbow 90 25x15 MM PPR FITTINGS (White Single Layer) | PPR Fittimg | 515 | a | unplanned division/category |
| PP513 | Male Brass Elbow 90 25x15 MM PPR FITTINGS (White Single Layer) | PPR Fittimg | 538 | a | unplanned division/category |
| PP413 | 25"x1/2" Female brass coupling | PPR Fittimg | 409 | a | unplanned division/category |
| PP403 | 25"x1/2" Male brass coupling | PPR Fittimg | 435 | a | unplanned division/category |

# Plumbing PB5 — Read-only evidence report

Date: 8 September 2026. Scope: PB5.1–PB5.3. No code, data, uploads, overrides, scheduler, plans, recomputes, validation calls, deployments, or publications were changed or run.

## PB5.1 — Guard evidence

The 8 September regression run had 37 failures of 351 checks: 18 golden-integrity self-sum/identity failures and 19 measured/new-check failures. The Plumbing measured failures included pieces total 2,026,860 expected versus 2,026,862 actual; KG total 458,986 versus 458,985; weekly CPVC Fitting 792,272 versus 792,273; UPVC Pipe 53,077 versus 53,076; AGRI Pipe 20,537 versus 20,538; AGRI Fitting 56,446 versus 56,447; plant W1/W2/W4 deltas of +1/+1/+2; replan SWR Pipe +757; AGRI Pipe +728; AGRI Fitting +231; replan remaining and shortfall totals each −16; SWR Pipe buffer 1.00 versus 1.31; pending unmatched 1,789 versus 2,022; and the pending fingerprint baseline check failed.

Other failures were PTMT July/August self-sums, PTMT input diagnostics and monitoring checks, and a September Plumbing monitoring request that lacked the required 2026-09 plumbing_fg_stock upload. The golden-integrity preflight was introduced in git on 26 August 2026 (c06af76); the reviewed Plumbing guard was published on 26 August 2026 at 12:25 UTC. No earlier regression log is present to date the first live-data mismatch, and the available evidence does not attribute it to PB3 Stage B work.

Upload #13 current last-month evidence: source 486,033; joined 476,663; unmatched 9,370; resolution loss 0.
Current fingerprint: e9a898b6fb97ceb7c52da36e8916c2cf5823339737090f77e8ee04e82e882446
Reviewed fingerprint: e9a898b6fb97ceb7c52da36e8916c2cf5823339737090f77e8ee04e82e882446
Result: MATCH. The last-month guard is not refusing a plan because of the upload #13 exclusion set.

The policy calls the approved historical source upload #12, but database row id 12 is a pending_orders DATA.xlsx upload. Its actual predecessor comparison is upload #8 versus the source represented by #13. Direct current-roster comparison: #8 excluded set 191 codes; #13 excluded set 203 codes; #13-only codes 4507, A-515, AS-447, C521S, CF12, PP403, PP413, PP513, PP523, WCT-3LL-05 GD, WCT-3LL-07 B, WCT-3LL-07 G, WCT-3LL-07 GD, WCT-3LL-07 PG, WCT-3LL-07 Y, WCT-3LL-10 G, WCT-3LL-10 GD, WCT-3LL-10 P, WT-002; #8-only codes CH82, CH88F, CH89, MHC-01, PU13T, WCT-3LL-10 Y, WT-ISI-07; shared excluded codes 184.
The policy rationale separately reports 23 added, 22 dropped, 24 changed shared, and 2 unchanged shared codes because it uses a historical movement partition. The fingerprint still matches exactly.

Current live pending_current: source 140,508; joined 138,486; unmatched 2,022; resolution loss 0. The reviewed ceiling is 234 unmatched and 0 resolution loss, so current unmatched is 1,788 above the ceiling. Live validation captures this source with allowUnreviewedCurrentPending=true. Last-month upload #13 is within its 13,583 / 0 ceiling.
Stock has no equivalent reviewed quantity ceiling or exclusion fingerprint. It has only an exact stock-join coverage check for plan rows with zero stock while the FG upload has positive stock for the same normalized code. The 110,462 positive-stock pieces absent from the roster are not covered by a stock exclusion ledger.

## PB5.2 — AGRI-excluded scenarios

Inputs: September workbook roster, upload #13 stock and last-month pending, current pending upload #18, and per-row clamping. Prayag targets: CPVC 728,042.3; UPVC 795,174.3; SWR 276,301.3; total 1,799,518.0.

| Scenario | CPVC | UPVC | SWR | Total | Difference vs total |
|---|---:|---:|---:|---:|---:|
| A engine suggestion | 834,257.74 | 801,099.59 | 366,719.11 | 2,002,076.44 | +202,558.44 (+11.26%) |
| B workbook dominant | 996,936.50 | 909,439.10 | 317,819.00 | 2,224,194.60 | +424,676.60 (+23.60%) |
| C workbook row | 996,936.50 | 925,847.90 | 317,819.00 | 2,240,603.40 | +441,085.40 (+24.51%) |

Per-material differences: A = CPVC +106,215.44 (+14.59%), UPVC +5,925.29 (+0.75%), SWR +90,417.81 (+32.72%); B = CPVC +268,894.20 (+36.93%), UPVC +114,264.80 (+14.37%), SWR +41,517.70 (+15.02%); C = CPVC +268,894.20 (+36.93%), UPVC +130,673.60 (+16.43%), SWR +41,517.70 (+15.02%).

CPVC + UPVC against 1,523,216.6: A 1,635,357.33, +112,140.73 (+7.36%); B 1,906,375.60, +383,159.00 (+25.15%); C 1,922,784.40, +399,567.80 (+26.23%). SWR is kept separate because the app recomputes buffer from average sales and multiplier, rather than reading Prayag BUFFER STOCK REQ.

| Scenario | AGRI Pipe | AGRI Fitting | AGRI Solvent | AGRI total |
|---|---:|---:|---:|---:|
| A | 14,459.64 | 44,283.18 | 0 | 58,742.82 |
| B | 15,561 | 52,465 | 0 | 68,026 |
| C | 15,561 | 52,465 | 0 | 68,026 |

Option C uses no engine suggestion for the current workbook: 1,120/1,120 rows have a sheet multiplier and 0 need fallback. A future blank sheet multiplier falls through to engine suggestion, then database category fallback, with explicit override/projection precedence; it does not refuse solely because the cell is blank.

## PB5.3 — AGRI evidence

| Subtype | Codes | 3-month average sale | Stock | Current pending | Dummy / last-month pending | Scenario A demand |
|---|---:|---:|---:|---:|---:|---:|
| AGRI Pipe | 123 | 11,280 | 16,323 | 0 | 3,229 | 14,459.64 |
| AGRI Fitting | 82 | 41,045 | 28,169 | 209 | 7,457 | 44,283.18 |
| AGRI Solvent | 1 | 0 | 0 | 0 | 0 | 0 |
| Total | 206 | 52,325 | 44,492 | 209 | 10,686 | 58,742.82 |

The 76 AGRI class-c codes with item name, stock, and pending-last-month are in plumbing-pb5-agri-class-c.csv.
The August Plumbing workbook contains AGRI tabs and parses 123 AGRI Pipe, 82 AGRI Fitting, and 1 AGRI Solvent rows. No August total was substituted into the September scenarios.
SAP DATA upload #18 carries 6 AGRI rows totaling 388 pieces: A-329, A-349, A-369, A-429, A-449, A-469. The latest live-sheet capture is a different source vintage and showed 1,377 AGRI pieces across 10 rows; the vintages were not merged.

Evidence appendix: .agents/outputs/plumbing-pb5-agri-class-c.csv
Regression source: /tmp/logs/plumbing-regression_20260908_114546_248_997c8ff8.log


## Appendix — exact regression failure lines

The complete 37 assertion failures, including expected/actual lines where the runner emitted them, are reproduced below from the existing regression log.

```text
❌  FAIL Plumbing category pieces sum = grand total (delta +2)
     expected 20,26,860  ·  got 20,26,862
❌  FAIL Plumbing category KG sum = grand total (delta -1)
     expected 4,58,986  ·  got 4,58,985
❌  FAIL PTMT July category Max sum = grand total (delta +328)
     expected 5,76,037  ·  got 5,76,365
❌  FAIL PTMT July category Min sum = grand total (delta -1)
     expected 3,01,918  ·  got 3,01,917
❌  FAIL PTMT August category Max sum = grand total (delta +8)
     expected 6,23,207  ·  got 6,23,215
❌  FAIL PTMT August category Min sum = grand total (delta -92)
     expected 3,35,145  ·  got 3,35,053
❌  FAIL Plumbing weekly CPVC Fitting W1–W4 sum = category pieces (delta +1)
     expected 7,92,272  ·  got 7,92,273
❌  FAIL Plumbing weekly UPVC Pipe W1–W4 sum = category pieces (delta -1)
     expected 53,077  ·  got 53,076
❌  FAIL Plumbing weekly AGRI Pipe W1–W4 sum = category pieces (delta +1)
     expected 20,537  ·  got 20,538
❌  FAIL Plumbing weekly AGRI Fitting W1–W4 sum = category pieces (delta +1)
     expected 56,446  ·  got 56,447
❌  FAIL Plumbing weekly category W1 sum = plant total (delta +1)
     expected 19,07,537  ·  got 19,07,538
❌  FAIL Plumbing weekly category W2 sum = plant total (delta +1)
     expected 12,260  ·  got 12,261
❌  FAIL Plumbing weekly category W4 sum = plant total (delta +2)
     expected 25,288  ·  got 25,290
❌  FAIL Plumbing replan SWR Pipe produced + remaining = plan (delta +757)
     expected 64,515  ·  got 65,272
❌  FAIL Plumbing replan AGRI Pipe produced + remaining = plan (delta +728)
     expected 20,296  ·  got 21,024
❌  FAIL Plumbing replan AGRI Fitting produced + remaining = plan (delta +231)
     expected 54,356  ·  got 54,587
❌  FAIL Plumbing replan remaining sum = grand total (delta -16)
     expected 13,46,225  ·  got 13,46,209
❌  FAIL Plumbing replan shortfall sum = grand total (delta -16)
     expected 2,31,073  ·  got 2,31,057
❌  FAIL Buffer · SWR Pipe = 1×
     expected 1  ·  got 1.31
❌  FAIL Pending · unmatched quantity (exact evidence-backed baseline captureId=23)
     expected 1,789  ·  got 2,022
❌  FAIL Pending · exclusion fingerprint = cited baseline (exact; captureId=23)
     expected 1  ·  got 0
❌  FAIL Pending coverage · unmatched quantity = cited baseline (exact; captureId=23)
     expected 1,789  ·  got 2,022
❌  FAIL Input diagnostics · PTMT plan pending upload · input diagnostics are present (response must include source diagnostics)
     expected 1  ·  got 0
❌  FAIL Input diagnostics · PTMT uploaded pending · plan-resolution diagnostics are present (pendingPlan with stable loss details)
     expected 1  ·  got 0
❌  FAIL Input diagnostics · PTMT uploaded pending · source quantity identity (plan-resolved + unmatched + resolution loss)
     expected 0  ·  got 0
❌  FAIL Input diagnostics · PTMT uploaded pending · roster quantity identity (plan-resolved + resolution loss)
     expected 0  ·  got 0
❌  FAIL Input diagnostics · PTMT uploaded pending · explicit reconciliation contract (source = joined + explained exclusions)
     expected 1  ·  got 0
❌  FAIL Input diagnostics · PTMT uploaded pending · stable detail counts match diagnostics (exact)
     expected 0  ·  got 0
❌  FAIL Input diagnostics · PTMT last-month pending · plan-resolution diagnostics are present (pendingPlan with stable loss details)
     expected 1  ·  got 0
❌  FAIL Input diagnostics · PTMT last-month pending · source quantity identity (plan-resolved + unmatched + resolution loss)
     expected 0  ·  got 0
❌  FAIL Input diagnostics · PTMT last-month pending · roster quantity identity (plan-resolved + resolution loss)
     expected 0  ·  got 0
❌  FAIL Input diagnostics · PTMT last-month pending · explicit reconciliation contract (source = joined + explained exclusions)
     expected 1  ·  got 0
❌  FAIL Input diagnostics · PTMT last-month pending · stable detail counts match diagnostics (exact)
     expected 0  ·  got 0
❌  FAIL NC1 · monitoring/dashboard · PTMT has target or structured input error, PLUMBING returns pieces-based (structural diff)
     expected 1  ·  got 0
❌  FAIL NC1b · monitoring/dashboard · PTMT input failure is a structured 422 when emitted (target payload or named 422)
     expected 1  ·  got 0
❌  FAIL NC6 · PTMT monitoring · categories (0), targetPcs (0), produced (0), NRI < 3636 (categories>0 & targetPcs>0 & produced>0 & NRI<3636)
     expected 1  ·  got 0
❌  FAIL WR · suite executed (Error: HTTP 422 from http://localhost:80/api/monitoring/dashboard?month=2026-09&segment=PLUMBING: {"error":"Required planning upload missing: Plumbing FG Stock for 2026-09 (upload kind \"plumbing_fg_stock\"). Upload the file on the Data page — the plan will not fall back to a sheet or assume zero.)
     expected 1  ·  got 0
```

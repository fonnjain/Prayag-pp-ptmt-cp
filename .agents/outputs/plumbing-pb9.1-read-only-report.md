# Plumbing PB9.1 — read-only dummy-stock report

Date: 8 September 2026. PB9.1 only. No upload, plan build, recompute, validation call, database write, override change, scheduler change, deployment, or publication was performed.

PB9.2 fixture quarantine was not performed because the query requires explicit approval from Nishant.

## Executive result

The code implements reading A, not reading B:

- Negative Net Stock is converted to positive pendingOrderLastMonth and passed into the common item-plan calculation.
- Plumbing has no separate dummy-stock upload. The provenance label dummyStock: source "Not used by the Plumbing plan", mode "not-used" describes that absent separate source; it does not disable the negative-Net-Stock path.
- The attached September-source FG workbook contains 232,214 negative-Net-Stock pieces overall and 118,298 UPVC pieces.
- The Plumbing plan is therefore not missing the entire pending-last-month term. The term is present in the implementation and was present in the stored finalized August run.

## PB9.1.1 — Does the plan consume negative Net Stock?

The code path is:

1. buildPlumbingPlanItemsInner reads the required plumbing_fg_stock upload.
2. Positive Net Stock enters stockMap; negative Net Stock enters pendingLmMap as Math.abs(netStock).
3. The same rows are passed through pendingRowsFromInput with transformQuantity = Math.max(-quantity, 0) and source role pending_last_month.
4. The roster join creates plumbingLastMonthPendingByRoster.
5. Each roster item receives pendingOrderLastMonth from that joined map.
6. computeItemPlan uses it in max(bufferReq - stock + pendingOrderLastMonth + pendingOrder, 0).

The implementation consumes negative Net Stock. A zero value for the 64 unmatched codes is not evidence that the Plumbing segment ignores dummy stock; it only describes the subset's source matches.

### Attached August-named FG workbook

The attached file is the source-month file for a September plan. Its FG Stock tab contains:

| Quantity | Value |
|---|---:|
| Negative-Net-Stock source rows | 214 |
| Negative-Net-Stock source codes | 214 |
| Negative-Net-Stock source total | 232,214 |
| UPVC-FG negative total | 108,493 |
| UPVC-PIPE negative total | 9,805 |
| UPVC negative total | 118,298 |

A September plan was deliberately not built. The attached workbook remains an unuploaded workspace file. The database currently has no plumbing_fg_stock upload whose inferred planning month is 2026-09; stored upload #13 is the July-2026 file and infers planning month 2026-08.

For a roster-level cross-check, the latest persisted Plumbing roster baseline is the 1,120-item roster from finalized run #44. Joining the attached negative source to that stored roster gives:

| Roster cross-check | Value |
|---|---:|
| Source negative pieces | 232,214 |
| Source codes | 214 |
| Codes joining the stored roster | 184 |
| Pieces reaching stored-roster items | 224,623 |
| Source pieces not joining that roster | 7,591 |

The 224,623 figure is a read-only roster cross-check, not a September plan result. The source-level term is 232,214; the plan-level term is the joined amount after the existing roster boundary.

### Stored-plan evidence

The last persisted Plumbing run is run #44 for 2026-08, finalized on 11 August 2026. Its saved input rows contain 530,961 pending-last-month pieces across the stored roster, showing that the term was not globally zeroed. That run predates the later upload #13 and is not a September result.

## PB9.1.2 — What PB8.1.2 actually meant

The wording came from the Plumbing plan provenance object:

    dummyStock: { source: "Not used by the Plumbing plan", mode: "not-used" }

That flag is segment-wide metadata about a separate dummy-stock input. It does not refer specifically to the 64 unmatched codes, and it is distinct from the negative-Net-Stock parser in buildPlumbingPlanItemsInner.

The correct interpretation is:

- Plumbing does not use a separate LAST MONTH PENDING upload like PTMT does.
- Plumbing does use negative Net Stock from the same FG Stock upload as its pending-last-month term.
- PB8.1.2's dummy_stock: 0 was a scenario-field simplification for the 64-code calculation, not a statement that Plumbing never consumes negative Net Stock.

## PB9.1.3 — UPVC gate check

The attached workbook reproduces the established gate exactly:

    UPVC-FG     -108,493
    UPVC-PIPE     -9,805
    UPVC total  -118,298

The code converts those negatives to a positive pending-last-month quantity of 118,298 before the roster join. Against the stored 1,120-item roster, all 59 UPVC negative rows join, so the UPVC roster amount is also 118,298.

### Stored upload #13

Upload #13 is FG Stock and pending production month of July-2026.xlsx; it is the July source for an August plan, not the September source. Its own rows contain:

| Upload #13 UPVC source category | Negative pieces |
|---|---:|
| UPVC-FG | 202,943 |
| UPVC-PIPE | 15,239 |
| UPVC FITTING | 320 |
| All UPVC-labelled rows | 218,502 |

Against the stored 1,120-item roster, upload #13 contributes 217,546 UPVC pieces after the roster join: 202,307 from UPVC-FG, 15,239 from UPVC-PIPE, and none from the 320-piece UPVC FITTING row because that code is not in the stored roster.

The last persisted run #44 stored 171,084 UPVC pending-last-month pieces, but that run was finalized before upload #13 and was based on an earlier source. It must not be compared to upload #13's 218,502 source total as though it were a September result.

For September today, the app produces no plan value because the attached FG file was not uploaded and no September plumbing_fg_stock row exists. If the attached file were selected in-memory against the current stored roster, the read-only cross-check above gives 118,298 for UPVC and 224,623 across all joined negative-Net-Stock rows.

## PB9.1.4 — The same question for the 64 unmatched codes

Using the 64-code unmatched set from PB8 and stored upload #13:

| 64-code subset | Value |
|---|---:|
| Codes with negative Net Stock in upload #13 | 2 |
| Negative-Net-Stock pieces for those codes | 221 |
| Other unmatched codes with negative Net Stock in #13 | 0 |

This closes the PB8 ambiguity: the 64-code scenario's zero dummy-stock value was reading A for the scenario—most of those unmatched codes have no negative Net Stock in upload #13—not reading B. The negative-Net-Stock path itself is active for the Plumbing segment.

## Consequence for the September plan

The Unmapped threshold conclusion from PB8 is unchanged. The negative-stock/dummy interpretation does not unblock September: the 64 unmatched current-pending codes and their 33,386 pieces remain the separate source/roster issue, and the 10% Unmapped threshold would still refuse at 47.572%.

## Boundaries respected

- No uploaded file was inserted into the database.
- No plan, recompute, validation endpoint, override, exclusion policy, scheduler setting, deployment, or publication was changed.
- No PB9.2 fixture quarantine was performed.
- PTMT Stage H4a and Stage I remain open and unaffected.

## Evidence inspected

- attached_assets/FG_Stock_and_Pending_production_month_of_August_1788872848895.xlsx
- attached_assets/SAP_Data_Aug-26_1788872848896.xlsx — Plumbing current pending source totals 70,180: PLUMBING 68,003 + PL 1,789 + AGRI 388.
- Stored upload #13: FG Stock and pending production month of July-2026.xlsx.
- Stored finalized Plumbing run #44 and its 1,120-item roster baseline.
- artifacts/api-server/src/routes/plan.ts and artifacts/api-server/src/lib/calc.ts.

# Plumbing PB8 — read-only completion report

Date: 8 September 2026. Scope completed: PB8.1 and PB8.6 only. No code, database data, upload, override, reviewed policy, scheduler, recompute, validation endpoint, deployment, or publication was changed or run.

PB8.2–PB8.5 and PB8.7 remain approval-gated and were not performed.

## PB8.1 — Unmapped route evidence

### PB8.1.1 — Existing Unclassified precedent

The generic calculation path already supports an unclassified demand-only row. `computeItemPlan` returns `bufferReq = null` when the multiplier is null, and sets both minimum and maximum production to confirmed demand. The existing unit test confirms this behavior: an unclassified item with 1,000 total pending produces 1,000, regardless of its average sale and stock inputs.

The `reviewedBufferMultiplier` helper only returns a buffer when `classificationStatus === "classified"`; otherwise it returns null. Therefore an Unclassified row is intentionally demand-only and does not consume a buffer multiplier. The Plumbing `buffer_categories` table nevertheless contains a row for `Plumbing / Unclassified` with multiplier 1.0, no suggested multiplier, and no override. That row is currently unused by the live Plumbing plan path: the current Plumbing builder constructs only workbook categories such as CPVC Pipe, UPVC Fitting, and AGRI Solvent, and does not route unmatched codes into Unclassified.

The generic mechanism can serve the bridge. A second Plumbing-specific calculation implementation is not indicated by the current code. The bridge would need to preserve the generic demand-only semantics and make the source/disposition visible; merely having the database row does not make unmatched Plumbing codes reachable.

The PB8 brief states the PTMT comparison as 18 Unclassified codes carrying 767 pieces. The current read-only database snapshot contains no current `item_master` rows with PTMT category/status Unclassified, and the September pending upload available in this workspace is the Plumbing upload. I therefore retain 18 / 767 as the supplied PTMT precedent rather than claiming it was independently re-derived from the current PTMT source.

### PB8.1.2 — What would be planned

The unmatched Plumbing upload population is 64 diagnostic codes and 33,386 pending pieces. The complete per-code scenario is in `.agents/outputs/plumbing-pb8-unmapped-read-only.csv`.

| Input | Read-only result |
|---|---:|
| Unmapped codes | 64 |
| Current pending quantity | 33,386 |
| Separate Plumbing dummy-stock input | 0; the Plumbing plan marks dummy stock as not used |
| Average 3-month sale | 0 for all 64; unmatched codes are not in the workbook roster that supplies average sales |
| Production with no stock netted | 33,386 |

Stock needs a source-vintage qualification. There is no `plumbing_fg_stock` upload that resolves to September 2026; the latest stored file is upload #13, `FG Stock and pending production month of July-2026.xlsx`, which resolves to August 2026. I used that file only for a read-only scenario, not as a September plan input.

Against latest upload #13, 16 of the 64 unmatched codes have positive `Net Stock`, totaling 38,902 pieces. Applying the requested per-code clamp `max(pending + dummy − stock, 0)` gives:

| Scenario | Total production |
|---|---:|
| No stock netted | 33,386 |
| Latest available FG upload #13 stock netted per code | 23,438 |

The CSV gives the production result for every code under the latest-available-FG scenario. It is not a September plan result because the September FG upload is missing.

PB7’s earlier presence check found 18 unmatched codes in the union of the two stored FG files, carrying 12,799 pieces of pending demand. That 12,799 is the pending quantity for those code identities; it is not the sum of their `Net Stock` cells. The latest-file `Net Stock` scenario above is the correct quantity to use when estimating stock netting, with its source-vintage limitation made explicit.

### PB8.1.3 — Threshold recommendation

The current Unmapped proportion is 33,386 / 70,180 = **47.572%** of the uploaded Plumbing pending-demand source. The supplied PTMT comparison is 767 / 926,148 = **0.0828%**.

I recommend a temporary Unmapped refusal threshold of **10% of total pending demand**. Above 10%, the plan should refuse and report the threshold and observed proportion. For the current upload, 10% would permit at most 7,018 pieces; the observed 33,386 exceeds that by 26,368 pieces. The current 47.572% is 574 times the supplied PTMT Unclassified proportion and is too large for a safety-valve category: it would become the plan rather than expose a small classification gap.

This is a recommendation only. No threshold or policy was changed.

## PB8.6 — Conservation failures, values not verdicts

### PB8.6.1 — Current computed and expected values

The values below are from the existing 8 September regression log and the frozen golden tables. Difference is computed as actual minus expected.

| Check | Computed / actual | Expected | Difference |
|---|---:|---:|---:|
| Plumbing category pieces sum | 2,026,862 | 2,026,860 | +2 |
| Plumbing category KG sum | 458,985 | 458,986 | -1 |
| Weekly CPVC Fitting W1–W4 | 792,273 | 792,272 | +1 |
| Weekly UPVC Pipe W1–W4 | 53,076 | 53,077 | -1 |
| Weekly AGRI Pipe W1–W4 | 20,538 | 20,537 | +1 |
| Weekly AGRI Fitting W1–W4 | 56,447 | 56,446 | +1 |
| Weekly plant W1 | 1,907,538 | 1,907,537 | +1 |
| Weekly plant W2 | 12,261 | 12,260 | +1 |
| Weekly plant W4 | 25,290 | 25,288 | +2 |
| Replan SWR Pipe produced + remaining | 65,272 | 64,515 | +757 |
| Replan AGRI Pipe produced + remaining | 21,024 | 20,296 | +728 |
| Replan AGRI Fitting produced + remaining | 54,587 | 54,356 | +231 |
| Replan remaining total | 1,346,209 | 1,346,225 | -16 |
| Replan shortfall total | 231,057 | 231,073 | -16 |

The three replan identity values are derived directly from the golden rows: SWR Pipe 11,456 + 53,816 = 65,272; AGRI Pipe 2,925 + 18,099 = 21,024; AGRI Fitting 19,787 + 34,800 = 54,587.

### PB8.6.2 — Rounding versus missing rows

The category pieces, weekly pieces, and replan values are integer frozen-table values. Their self-check failures do not demonstrate that live source rows went missing: the checks compare one persisted golden table against another total or identity. The +2 pieces mismatch is not fractional rounding in the current assertion; it is an internally inconsistent integer golden set. The -1 KG mismatch may have originated during BOM-weight or row-rounding generation, but the current constants cannot distinguish rounding during generation from a one-unit transcription/aggregation error.

The weekly failures are also small integer table discrepancies. The four category differences (+1, -1, +1, +1) sum to +2, matching the category-piece golden delta. The plant W1/W2/W4 differences are separate comparisons against the frozen plant-week totals. This is evidence of a frozen-golden/table-consistency problem, not evidence of a missing row in the current live workbook.

The replan failures are materially different in size and shape: three category identities are high by 757, 728, and 231 pieces, while the grand remaining and shortfall totals are each low by 16. The per-category shortfall formulas themselves are consistent for the listed rows. These values come from a point-in-time Sheet3/replan snapshot and do not show the same ±1/±2 arithmetic pattern as the weekly family.

Conclusion for the shared-cause question: the weekly and replan failures do not share a demonstrated arithmetic cause. They share a maintenance risk—frozen values can drift apart—but the weekly family is a small self-sum mismatch, whereas the replan identities are category-specific snapshot reconciliation mismatches.

### PB8.6.3 — How long the checks have failed

The `getGoldenIntegrityChecks` assertions covering the Plumbing category sums, weekly identities, and replan identities were introduced together in commit `c06af76` on 26 August 2026 at 08:22 UTC. They fail in the first intact checked snapshot available after introduction and remain failing in the current code at commit `1f891c9` from 7 September 2026.

The first intact post-24-August golden-file snapshot examined was commit `a1ecd24` from 24 August 2026; its underlying golden arrays were already internally inconsistent for these families, but the self-integrity assertions had not yet been added. No passing snapshot after the assertions were introduced was found. The repository history contains a missing historical Git object, so an earlier last-passing state cannot be established from the available history without inventing evidence.

## Boundaries respected

- No Unmapped route was implemented.
- No threshold or exclusion policy was changed.
- No September FG file was fabricated or loaded.
- No recompute, plan validation endpoint, plan run, deployment, or publication was performed.
- PTMT Stage H4a and Stage I were not resumed.

## Evidence files

- `.agents/outputs/plumbing-pb8-unmapped-read-only.csv` — 64-code Unmapped scenario using latest available FG upload #13 for stock illustration.
- `.agents/outputs/plumbing-pb7-read-only-report.md` — source-population and 33,386-piece join investigation.
- `.agents/outputs/plumbing-pb5-read-only-report.md` — regression appendix and prior pending evidence.
- `/tmp/logs/plumbing-regression_20260908_114546_248_997c8ff8.log` — current regression values.

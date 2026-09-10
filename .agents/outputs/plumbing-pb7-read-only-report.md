# Plumbing PB7 — the 33,386 pending join failure

Date: 8 September 2026. Scope: PB7.1–PB7.3. This is read-only evidence; no code, database rows, uploads, overrides, reviewed policy, scheduler, plan run, recompute, validation endpoint, deployment, or publication was changed or run.

## Executive evidence

SAP pending upload #18 has 70,180 accepted Plumbing pieces. Against the September Plumbing workbook roster, 36,794 join and 33,386 do not. The join rate is 52.428%. All 33,386 excluded pieces are NO_ROSTER_MATCH; resolution loss is 0. No row was AMBIGUOUS_ROSTER_MATCH or COLOUR_MISMATCH.

The exclusion is concentrated in the division-valued PLUMBING rows: 31,632 pieces, or 94.746% of the total unmatched quantity. PL rows contribute 1,575 and AGRI contributes 179. This is consistent with the division-versus-material population hypothesis, but this report does not make a business decision about which source should govern planning.

The two sources describe substantially different populations. Upload #18 has 1,433 distinct codes; live capture #199 has 230. Only 79 codes are present in both, while 151 are live-only and 1,354 are upload-only. Of the 79 shared codes, 64 have different quantities and 15 have equal quantities.

## PB7.1 — What fails to join

### PB7.1.1 — Row-level unmatched evidence

The upload contains 68 raw unmatched source rows, which aggregate to 64 diagnostic code/description entries and 33,386 pieces. Every row has diagnostic outcome NO_ROSTER_MATCH and reason NO_ROSTER_MATCH. The complete row-level list, including item description and balance quantity, is in:

- `.agents/outputs/plumbing-pb7-unmatched-upload18.csv`

The diagnostic aggregation is 64 unmatched entries / 33,386 pieces and 0 resolution-loss entries / 0 pieces. The CSV intentionally retains repeated source lines rather than collapsing them.

### PB7.1.2 — Grouped by upload segment

| Segment | Source rows | Source quantity | Joined | Unmatched | Join rate |
|---|---:|---:|---:|---:|---:|
| PLUMBING | 170 | 68,003 | 36,371 | 31,632 | 53.484% |
| PL | 9 | 1,789 | 214 | 1,575 | 11.962% |
| AGRI | 6 | 388 | 209 | 179 | 53.866% |
| Total | 185 | 70,180 | 36,794 | 33,386 | 52.428% |

PLUMBING accounts for 31,632 of 33,386 unmatched pieces, or 94.746%. The unmatched quantity is therefore not evenly spread across the three accepted upload segment values.

### PB7.1.3 — Do unmatched codes exist elsewhere?

The counts below are distinct unmatched code entries from the diagnostic ledger. Presence checks use the application code normalizer; the different-spelling check additionally removes hyphens, spaces, and dots for comparison. FG Stock presence uses the union of the two stored Plumbing FG uploads (#13 and #8).

| Location checked | Distinct unmatched codes | Quantity represented |
|---|---:|---:|
| September roster under a different spelling | 0 | 0 |
| Stored Plumbing FG Stock uploads | 18 | 12,799 |
| `item_master`, Plumbing segment | 3 | 211 |
| August Plumbing workbook | 0 | 0 |
| None of the above | 46 | 20,587 |

The stored FG Stock uploads are the July-labelled upload #13 and its predecessor #8; there is no September `plumbing_fg_stock` upload in the database. The 18 codes found in old FG Stock are not present in the September workbook roster under either normal or strict spelling comparison. The 46-code / 20,587-piece remainder is absent from all four checked locations.

### PB7.1.4 — Join key

The Plumbing pending parser reads the source code in this order: `Old ERP Code`, then `Item Code`, then `Item No.`. It does not list SAP’s `Old Item Code` as a code alias. SAP upload #18 contains `Old Item Code`, `Item Code`, and `Item No.`; in the inspected rows the latter two carry the same code values used by the parser.

The source colour aliases are `Colour`, `Color`, `COLOR`, and `COLUOR`. The upload contains colour columns, but its unmatched rows have no colour-based failure: the September Plumbing roster has 1,120 rows and 1,120 distinct normalized codes, so no Plumbing code has duplicate roster candidates requiring code-plus-colour resolution. A single candidate resolves by normalized code alone; only duplicate candidates would require normalized code plus colour. The `-LSBB`, `-LSTBB`, and `-LSQBB` aliases are applied before matching.

Therefore the 33,386 quantity is not explained by a colour join failure or a duplicate-code ambiguity in the September Plumbing roster. The diagnostic result for every excluded row is NO_ROSTER_MATCH.

## PB7.2 — Why the live sheet joins and the upload does not

### PB7.2.1 — Side-by-side code population

| Source | Distinct codes | Source quantity | Joined | Unmatched | Join rate |
|---|---:|---:|---:|---:|---:|
| Uploaded SAP #18 | 1,433 | 70,180 | 36,794 | 33,386 | 52.428% |
| Live capture #199 | 230 | 140,508 | 138,486 | 2,022 | 98.561% |

The overlap is 79 codes. The live source has 151 codes not in the upload, and the upload has 1,354 codes not in the live source. Among the 79 shared codes, 64 have different quantities and 15 have equal quantities. This is not one population represented with a different parser or only a different segment label; the source coverage and quantities are materially different.

### PB7.2.2 — Segment vocabularies

Uploaded SAP #18, all source rows (before the Plumbing allow-list):

| Segment | Rows | Quantity |
|---|---:|---:|
| AGRI | 6 | 388 |
| CP | 1,228 | 45,846 |
| GARDEN PIPE | 27 | 784 |
| HARDWARE | 20 | 8,130 |
| PL | 9 | 1,789 |
| PLUMBING | 170 | 68,003 |
| PT | 92 | 156 |
| PTMT | 1,769 | 7,042 |
| SANITARYWARE | 5 | 0 |
| SINK | 197 | 315 |
| TANK | 1 | 2 |
| TK | 218 | 264 |
| WATER TANK | 7 | 10 |

Live capture #199, all source rows:

| Segment | Rows | Quantity |
|---|---:|---:|
| AGRI | 10 | 1,377 |
| CPVC | 140 | 63,102 |
| SWR | 108 | 28,573 |
| UPVC | 117 | 47,456 |

The code contains a Plumbing allow-list accepting both division values (`PLUMBING`, `P`, `PL`) and material values (`CPVC`, `UPVC`, `SWR`, `AGRI`). It does not contain a mapping that converts SAP divisions to materials. The allow-list is a filter, not a taxonomy translation. The live sheet’s material vocabulary matches the material-organized workbook roster; the uploaded SAP file’s accepted rows are predominantly division-valued.

### PB7.2.3 — Which source the plan uses

`PLAN_PENDING_SOURCE` is set to `"upload"` in `artifacts/api-server/src/routes/plan.ts`. The only alternatives in the branch are `"upload"` and `"live"`. With `"upload"`, Plumbing reads the period-selected `pending_orders` upload and applies the reviewed pending exclusion policy. With `"live"`, it calls the live pending-sheet reader instead. The setting was not changed.

If the plan consumed live capture #199 instead, the observed join rate against the same September roster would be 98.561% rather than 52.428%, with 2,022 unmatched pieces. That comparison does not establish that live should replace the frozen upload: it establishes that the two source populations differ and that the source choice is materially consequential.

The standing uploaded-first/live-recompute rule therefore assumes source-role equivalence that is not present in these observed September inputs. The upload is frozen and the live sheet is point-in-time; the evidence does not show them to be two snapshots of the same population.

## PB7.3 — Drift and regression list

### PB7.3.1 — Every live capture from 1–8 September

Times below are UTC. Capture 139’s joined quantity was recomputed from its persisted parsed rows because that snapshot did not retain the nested pendingPlan reconciliation object; the other values use retained diagnostics or the same read-only recomputation.

| Capture | Captured at (UTC) | Source rows | Source | Joined | Unmatched | Resolution loss |
|---:|---|---:|---:|---:|---:|---:|
| 132 | 2026-09-01 03:36:25 | 9 | 3,830 | 3,830 | 0 | 0 |
| 139 | 2026-09-01 04:39:52 | 9 | 3,830 | 3,830 | 0 | 0 |
| 144 | 2026-09-01 04:45:32 | 9 | 3,830 | 3,830 | 0 | 0 |
| 146 | 2026-09-04 12:01:06 | 52 | 8,967 | 8,898 | 69 | 0 |
| 149 | 2026-09-04 15:25:40 | 52 | 8,967 | 8,898 | 69 | 0 |
| 152 | 2026-09-04 19:22:49 | 52 | 8,967 | 8,898 | 69 | 0 |
| 155 | 2026-09-05 01:57:21 | 52 | 8,967 | 8,898 | 69 | 0 |
| 158 | 2026-09-05 02:56:21 | 52 | 8,967 | 8,898 | 69 | 0 |
| 161 | 2026-09-05 05:26:25 | 106 | 37,037 | 36,794 | 243 | 0 |
| 164 | 2026-09-05 12:05:49 | 106 | 37,037 | 36,794 | 243 | 0 |
| 170 | 2026-09-06 05:13:31 | 106 | 37,037 | 36,794 | 243 | 0 |
| 179 | 2026-09-07 06:37:21 | 106 | 37,037 | 36,794 | 243 | 0 |
| 182 | 2026-09-07 07:17:09 | 106 | 37,037 | 36,794 | 243 | 0 |
| 191 | 2026-09-07 12:37:22 | 106 | 37,037 | 36,794 | 243 | 0 |
| 196 | 2026-09-08 05:33:26 | 375 | 140,508 | 138,486 | 2,022 | 0 |
| 199 | 2026-09-08 11:07:21 | 375 | 140,508 | 138,486 | 2,022 | 0 |

All captures use the same live source identity: `pending_order_live_sheet`, spreadsheet `1dmt6uHOdZSIT0wgNkSfuK8W8d0YO8STW51PVOAAFHvY`, tab `report`. The source population changes in steps rather than accumulating one stable exclusion set.

| Transition | Newly unmatched codes | Codes removed from prior unmatched set | Source change |
|---|---|---|---|
| 144 → 158 | A-419, C324 | none | source 3,830 → 8,967; unmatched 0 → 69 |
| 158 → 161 | A-329, A-429, CH86F, UH86F | A-419, C324 | source 8,967 → 37,037; unmatched 69 → 243 |
| 161 → 196 | 5106, 5107, 5707, 5792, 5793, A-704, C324, CH82, CH88 | A-329, A-429, CH86F, UH86F | source 37,037 → 140,508; unmatched 243 → 2,022 |
| 196 → 199 | none | none | source and unmatched set unchanged |

Between 5 September 02:56 and 05:26 UTC, the persisted source expanded from 52 to 106 rows and from 8,967 to 37,037 pieces. The unmatched codes changed rather than simply accumulating. The 8 September captures 196 and 199 are identical in source quantity, joined quantity, unmatched quantity, and unmatched code set.

### PB7.3.2 — Regression list classification

The current regression run remains 37 failures of 351: 18 golden-integrity and 19 measured/new-check failures. The classifications below identify the open investigation that each assertion overlaps; they do not claim that the assertion has the same root cause as the pending join.

| # | Failed assertion | Relation to current work |
|---:|---|---|
| 1 | Plumbing category pieces sum = grand total (delta +2) | Related to the open Plumbing piece-total conservation drift; independently of the 33,386 pending join. |
| 2 | Plumbing category KG sum = grand total (delta -1) | Related to the open Plumbing KG-total conservation drift; independently of the pending join. |
| 3 | PTMT July category Max sum = grand total | PTMT Stage I / PTMT golden-integrity investigation. |
| 4 | PTMT July category Min sum = grand total | PTMT Stage I / PTMT golden-integrity investigation. |
| 5 | PTMT August category Max sum = grand total | PTMT Stage I / PTMT golden-integrity investigation. |
| 6 | PTMT August category Min sum = grand total | PTMT Stage I / PTMT golden-integrity investigation. |
| 7 | Plumbing weekly CPVC Fitting W1–W4 sum = category pieces | Related to the open Plumbing weekly piece-conservation drift. |
| 8 | Plumbing weekly UPVC Pipe W1–W4 sum = category pieces | Related to the open Plumbing weekly piece-conservation drift. |
| 9 | Plumbing weekly AGRI Pipe W1–W4 sum = category pieces | Related to the open Plumbing weekly piece-conservation drift. |
| 10 | Plumbing weekly AGRI Fitting W1–W4 sum = category pieces | Related to the open Plumbing weekly piece-conservation drift. |
| 11 | Plumbing weekly category W1 sum = plant total | Related to the open Plumbing weekly plant-total conservation drift. |
| 12 | Plumbing weekly category W2 sum = plant total | Related to the open Plumbing weekly plant-total conservation drift. |
| 13 | Plumbing weekly category W4 sum = plant total | Related to the open Plumbing weekly plant-total conservation drift. |
| 14 | Plumbing replan SWR Pipe produced + remaining = plan | Existing Plumbing replan conservation/invariant investigation; not the PB7 pending-source join. |
| 15 | Plumbing replan AGRI Pipe produced + remaining = plan | Existing Plumbing replan conservation/invariant investigation; not the PB7 pending-source join. |
| 16 | Plumbing replan AGRI Fitting produced + remaining = plan | Existing Plumbing replan conservation/invariant investigation; not the PB7 pending-source join. |
| 17 | Plumbing replan remaining sum = grand total | Existing Plumbing replan conservation/invariant investigation. |
| 18 | Plumbing replan shortfall sum = grand total | Existing Plumbing replan conservation/invariant investigation. |
| 19 | Buffer · SWR Pipe = 1× | PB3.4/PB5 multiplier evidence and the held SWR multiplier decision. |
| 20 | Pending · unmatched quantity = evidence-backed baseline | PB6/PB7 pending-source and baseline comparison. |
| 21 | Pending · exclusion fingerprint = cited baseline | PB6/PB7 pending-source and baseline comparison. |
| 22 | Pending coverage · unmatched quantity = cited baseline | PB6/PB7 pending-source and baseline comparison. |
| 23 | PTMT plan pending upload diagnostics are present | PTMT Stage I / input-diagnostics contract. |
| 24 | PTMT uploaded pending plan-resolution diagnostics are present | PTMT Stage I / input-diagnostics contract. |
| 25 | PTMT uploaded pending source quantity identity | PTMT Stage I / input-diagnostics contract. |
| 26 | PTMT uploaded pending roster quantity identity | PTMT Stage I / input-diagnostics contract. |
| 27 | PTMT uploaded pending explicit reconciliation contract | PTMT Stage I / input-diagnostics contract. |
| 28 | PTMT uploaded pending stable detail counts | PTMT Stage I / input-diagnostics contract. |
| 29 | PTMT last-month pending plan-resolution diagnostics are present | PTMT Stage I / input-diagnostics contract. |
| 30 | PTMT last-month pending source quantity identity | PTMT Stage I / input-diagnostics contract. |
| 31 | PTMT last-month pending roster quantity identity | PTMT Stage I / input-diagnostics contract. |
| 32 | PTMT last-month pending explicit reconciliation contract | PTMT Stage I / input-diagnostics contract. |
| 33 | PTMT last-month pending stable detail counts | PTMT Stage I / input-diagnostics contract. |
| 34 | NC1 monitoring/dashboard PTMT-vs-Plumbing structural response | PTMT Stage I monitoring contract. |
| 35 | NC1b PTMT monitoring input failure is a structured 422 | PTMT Stage I monitoring error contract. |
| 36 | NC6 PTMT monitoring categories/target/produced/NRI check | PTMT Stage I monitoring contract. |
| 37 | WR suite executed; Plumbing September monitoring returned missing FG upload 422 | PB6.1/PB6.2 period and FG Stock upload gate. |

No regression assertion in this list is unrelated to an existing open investigation: the PTMT rows overlap Stage I, the Plumbing totals/weekly/replan rows overlap existing Plumbing conservation work, the SWR buffer overlaps PB3.4/PB5, the three pending baseline rows overlap PB6/PB7, and the missing FG upload row overlaps PB6.1/PB6.2. This classification does not establish a common root cause across those families.

## Work deliberately not performed

PB6.1 period-detection implementation, PB6.2 correct-stock upload, and PB6.3 scenario reruns remain deferred. No plan source setting, normalizer, exclusion policy, roster, upload, override, or plan state was changed.

## Evidence files

- `.agents/outputs/plumbing-pb7-unmatched-upload18.csv` — 68 raw unmatched upload rows with item descriptions.
- `.agents/outputs/plumbing-pb6.0-read-only-report.md` — preceding source-selection and ceiling evidence.
- `.agents/outputs/plumbing-pb5-read-only-report.md` — prior regression appendix and pending baseline evidence.
- `/tmp/logs/plumbing-regression_20260908_114546_248_997c8ff8.log` — current regression run.

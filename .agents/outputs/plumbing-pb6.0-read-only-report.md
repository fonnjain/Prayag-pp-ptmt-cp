# Plumbing PB6.0 — Read-only evidence report

Date: 8 September 2026. Scope: PB6.0. No plan build, recompute, validation endpoint, upload, code change, override change, scheduler change, deployment, or publication was performed.

## PB6.0.1 — Is the ceiling breach blocking plans?

There is no finalized September 2026 Plumbing plan_run in the development database. Therefore a normal GET /api/plan request for month 2026-09 and segment Plumbing would not return a frozen September run; it would enter the live build path. I did not call that endpoint.

The normal route calls buildPlanItems with default options. Plumbing uses PLAN_PENDING_SOURCE = upload, and the September upload selector resolves pending_orders upload #18 because it has explicit period 2026-09. The normal path does not set allowUnreviewedCurrentPending.

Upload #18: SAP_Data_Aug-26_1788610667811.xlsx, 3,749 stored rows, explicit period 2026-09. Its Plumbing filter accepts PLUMBING, P, PL, AGRI, CPVC, UPVC, and SWR. The stored file contains 170 PLUMBING rows totaling 68,003, 9 PL rows totaling 1,789, and 6 AGRI rows totaling 388: source total 70,180.

Against the current September workbook roster, upload #18 produces source 70,180; roster-joined 36,794; unmatched 33,386; resolution loss 0; unexplained residual 0. Its current exclusion fingerprint is 8faa2fbd6a8b9d329fdf859b01c0a30ed3e09ceef507565bac0c2430a6a15f12.

The Plumbing pending_current policy is unmatched <= 234, resolution loss <= 0, reviewed fingerprint 9380b02828fdb193462269298ab9c7db62e8591a9ebd436a2f97ddad203b0504. The normal plan build therefore reaches assertPendingJoinIdentity, sees both the quantity breach and fingerprint mismatch, throws PlanningInputError, and the route maps that named input failure to HTTP 422 before assembling plan items. It does not build a partial plan.

The live 2,022-unmatched figure does not bypass this normal plan guard because it is not the normal plan source. The allowUnreviewedCurrentPending option is used by validation/monitoring evidence paths; normal production construction leaves the reviewed policy enabled.

Latest live pending capture at or below the 234 ceiling: capture 158, 5 September 2026 02:56:21 UTC, source 8,967, joined 8,898, unmatched 69, resolution loss 0. This was the live Google Sheet source Pending order / report, not an uploaded file. Earlier capture 144 on 1 September had zero unmatched; the next observed capture, 161 on 5 September 05:26:25 UTC, had 243 unmatched and was already over the ceiling. Captures 196 and 199 on 8 September had 2,022 unmatched.

## PB6.0.2 — Why are there two current-pending figures?

| Figure | Source | Stored identity | Rows / filter | Segment totals | Quantity |
|---|---|---|---|---|---:|
| 70,180 | SAP uploaded pending | uploaded_files id 18; SAP_Data_Aug-26...xlsx; explicit period 2026-09 | 185 parsed rows; PLUMBING/P/PL/AGRI/CPVC/UPVC/SWR allow-list | PLUMBING 68,003 + PL 1,789 + AGRI 388 | 70,180 |
| 140,508 | Live pending report | pending_read_snapshots capture 199; Google Sheet 1dmt6uHOdZSIT0wgNkSfuK8W8d0YO8STW51PVOAAFHvY; report tab | 375 parsed rows; live report segment filter | CPVC 63,102 + UPVC 47,456 + SWR 28,573 + AGRI 1,377 | 140,508 |

The difference is 70,328 pieces. These are not two parses of one identical stored input: the uploaded SAP source has PLUMBING and PL rows and no CPVC/UPVC/SWR segment totals; the live report has CPVC/UPVC/SWR and no PLUMBING/PL totals. AGRI also differs, 1,377 live versus 388 uploaded. The live source is a separate, later/current Google Sheet capture.

The production plan consumes the uploaded SAP file (#18), not the 140,508 live capture. The live capture is persisted as independent validation evidence and is surfaced in monitoring/reconciliation paths.

## PB6.0.3 — Regression baseline

Now: 37 failures out of 351 checks, consisting of 18 golden-integrity self-sum/identity failures and 19 measured/new-check failures.

Before Stage A: no archived pre-Stage-A regression run or count was found in the workspace. The count is therefore not established; it must not be reported as zero. The 8 September run is the only retained complete regression log available for this comparison.

Failures demonstrably appearing during Stage A or Stage B: none can be attributed from the available evidence. Both Stage A and the Plumbing Stage B work were explicitly read-only: no code, uploads, source rows, overrides, normalisers, scheduler settings, or plan runs changed. Without a pre-Stage-A run, there is no before/after assertion delta from which to name a newly appearing failure. The existing 37 should be treated as the current baseline, not as a Stage A/B regression delta.

The full exact failure list from the existing log is appended to the PB5 report at .agents/outputs/plumbing-pb5-read-only-report.md. The current run included Plumbing piece/KG sum deltas, weekly/replan conservation deltas, SWR buffer drift, pending baseline/fingerprint failures, PTMT input/monitoring failures, and the missing September Plumbing FG upload check.

## Gated work not performed

PB6.1 period-detection code change was not made because it requires Nishant approval. PB6.2 correct September FG Stock upload was not uploaded. PB6.3 scenarios were not rerun because PB6.2 has not been completed. No reviewed policy was updated to match any new fingerprint.

## Source references

- Existing regression log: /tmp/logs/plumbing-regression_20260908_114546_248_997c8ff8.log
- Application plan policy and route: artifacts/api-server/src/routes/plan.ts
- Live pending source/capture persistence: artifacts/api-server/src/lib/pending-read-snapshot.ts
- Pending parsing and segment filter: artifacts/api-server/src/lib/sheets.ts

# August 2026 Plan-vs-Actual Daily-Rate Impact

Captured on 2026-08-21 by running the same live report against the parent of
`126118c` and against `126118c`, with report time fixed at
`2026-08-21T12:00:00Z`.

## What changed

Commit `126118c` changed the headline `TOTAL PLAN` from summing the retained
W1–W4 release buckets to calculating one governing plan version per working
day:

```text
TOTAL PLAN = Σ over working days d
  (version governing d.monthTotal ÷ resolved workingDays)
```

The implementation uses the version active on each governed date, includes
observed worked Sundays when the denominator is observed, and rounds the final
sum. The W1–W4 buckets were not deleted or added to the headline total:
`releaseScheduleTotal` retains their sum for the weekly-release view.

## Before and after

| Segment / figure | Before `126118c` | After `126118c` |
|---|---:|---:|
| PTMT `kpis.totalPlan` | 779,182 | 628,429 |
| PTMT `kpis.mappedProduction` | 375,040 | 375,040 |
| PTMT `kpis.totalProduction` | 614,552 | 614,552 |
| PTMT `kpis.unmappedProduction` | 239,512 | 239,512 |
| PTMT `kpis.achievementPct` | 48.13% | 59.68% |
| PTMT largest version month total | 634,587 | 634,587 |
| PTMT plan versions | 4 | 4 |
| Plumbing `kpis.totalPlan` | 1,613,470 | 2,333,148 |
| Plumbing `kpis.mappedProduction` | 497,093 | 497,093 |
| Plumbing `kpis.totalProduction` | 696,179 | 696,179 |
| Plumbing `kpis.unmappedProduction` | 199,086 | 199,086 |
| Plumbing `kpis.achievementPct` | 30.81% | 21.31% |
| Plumbing largest version month total | 2,471,428 | 2,471,428 |
| Plumbing plan versions | 4 | 4 |

The PTMT decrease is the expected removal of double-counting from rescheduled
weekly buckets. Plumbing is a distinct result: its dated version timeline
produces a larger daily-rate headline than its retained release schedule.
Production and its mapped/unmapped split are unchanged.

## Cap check

The post-change invariant is:

```text
TOTAL PLAN ≤ largest single version month total + genuinely new mid-month demand
```

| Segment | Largest version | New mid-month demand | Allowed total | After `TOTAL PLAN` | Result |
|---|---:|---:|---:|---:|---|
| PTMT | 634,587 | 16,876 | 651,463 | 628,429 | Pass |
| Plumbing | 2,471,428 | 1,871,908 | 4,343,336 | 2,333,148 | Pass |

The invariant is implemented as `TOTAL_PLAN_DAILY_RATE_CAP` in the report
invariants. It was not present in the parent commit. The earlier parent
calculation exceeded the PTMT allowed basis (`779,182 > 651,463`); the
post-change calculation does not.

## Commit scope

`126118c` changed seven files:

- `artifacts/api-server/src/lib/plan-vs-actual-engine.ts`
- `artifacts/api-server/src/lib/plan-vs-actual-excel.ts`
- `artifacts/api-server/src/lib/plan-vs-actual.test.ts`
- `artifacts/api-server/src/routes/plan.ts`
- `artifacts/ops-dashboard/src/App.tsx`
- `attached_assets/Pasted--PROMPT-Fix-TOTAL-PLAN-double-counting-rescheduled-work_1787238425083.txt`
- `screenshots/plan-vs-actual-daily-rate.jpg`

Its diffstat was **399 insertions and 29 deletions** across those seven files.
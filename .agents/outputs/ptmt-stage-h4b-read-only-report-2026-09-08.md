# PTMT Stage H4b read-only report

**Date:** 2026-09-08  
**Scope:** H4b data question only. No code, database, normalizer, roster, override, plan, scheduler, validation, deployment, or production changes were made. H2r and H4a were not started.

## H4b.1 — Where the two `3272-BC` values come from

### Current Prayag itemized source and the 6,912 value

The current itemized source is `.agents/outputs/september_prayag_plan_itemised_differences.csv`. Its `3272-BC` row reports:

| Input | Value |
|---|---:|
| Category | Waste Pipes |
| 3-month average | 5,000.00 |
| Stock | 588 |
| Current pending | 0 |
| Last-month pending / dummy | 0 |
| Prayag production required | 6,912.00 |

The candidate calculation is reproduced by the existing Waste Pipes multiplier of **1.5×**:

```text
buffer requirement = 5,000.00 × 1.5 = 7,500.00
production required = max(7,500.00 − 588 + 0 + 0, 0)
                  = 6,912.00
```

The clamp does not change this row because the pre-clamp value is positive.

### Where the 2,976 value appears

The older `.agents/outputs/round7-prayag-vs-temporary-2367-itemized.csv` row for `3272-BC` contains:

| Field | Value |
|---|---:|
| Direction | `PRAYAG_ONLY` |
| Category | `WASTE PIPE` |
| Manual average | 5,000.00 |
| Manual stock | blank |
| Manual current pending | 0 |
| Manual plan | 2,976.00 |
| App stock | 4,524 |

The arithmetic identity is:

```text
5,000.00 × 1.5 − 4,524 = 2,976.00
```

Thus the old comparison export’s `2,976` is reproducible from the 5,000 average, the 1.5 multiplier, and the **4,524 stock value shown in that export’s app-stock field**. It is not reproducible from the current Prayag itemized row, which has stock 588 and production required 6,912.

The newer itemized source explicitly records `manual_stock=588` and `prayag_production_required=6912` for the same code. The two files therefore contain different stock vintages/field provenance for `3272-BC`; the older comparison export’s 2,976 should not be treated as the current Prayag-tab calculation without resolving that source vintage.

### Current Prayag WASTE PIPE values for `3272-BC`

| 3-month average | Stock | Pending current | Dummy / last-month pending | Production required |
|---:|---:|---:|---:|---:|
| 5,000.00 | 588 | 0 | 0 | 6,912.00 |

## H4b.2 — Other held Waste Pipe candidates

The current itemized source reports all four as `Waste Pipes`, with zero clamped demand. Their raw production-required values are negative:

| Code | 3-month average | Stock | Pending current | Dummy / last-month pending | Raw production required | Clamped demand |
|---|---:|---:|---:|---:|---:|---:|
| 3274-B | 33.33 | 421 | 0 | 0 | -371.00 | 0.00 |
| 3274-BC | 0.00 | 385 | 0 | 0 | -385.00 | 0.00 |
| 3461 | 10.00 | 260 | 0 | 0 | -245.00 | 0.00 |
| 3727 | 228.00 | 1,339 | 0 | 0 | -997.00 | 0.00 |

None carries positive demand on the current Prayag itemized tab. The negative values are the unclamped residuals; the planning demand is zero after the lower clamp.

## H4b.3 — Independent Waste Pipes landing

The shared-basis calculation requested in H4b is:

```text
#2419 Waste Pipes total                         51,052.00
less current app-only Waste Pipes demand         1,667.00
shared basis                                    49,385.00
```

Using the older comparison export’s `2,976.00`:

```text
49,385.00 + 2,976.00 = 52,361.00
```

This lands exactly on the consistently clamped Prayag figure of **52,361.00**:

- Difference against clamped figure: **0.00**
- Difference against Prayag’s published raw figure of 43,070.00: **+9,291.00**

Using the current Prayag itemized value of `6,912.00`:

```text
49,385.00 + 6,912.00 = 56,297.00
```

- Difference against clamped figure: **+3,936.00**
- Difference against published raw figure: **+13,227.00**

### Finding

The exact 52,361 landing is genuine arithmetic, but it comes from subtracting the older comparison export’s 4,524 stock value from the 7,500 buffer requirement. The current Prayag itemized source identifies stock as 588 and production required as 6,912. Therefore the exact landing does **not**, by itself, establish that 2,976 is the correct current value; it identifies a source-vintage/provenance discrepancy that must be resolved before admitting `3272-BC`.

## Read-only sources

- `.agents/outputs/september_prayag_plan_itemised_differences.csv`
- `.agents/outputs/round7-prayag-vs-temporary-2367-itemized.csv`
- `.agents/outputs/stage-f1-candidate-codes.csv`
- `.agents/outputs/ptmt-stage-h1-h3-read-only-report-2026-09-08.md`

H2r and H4a remain unstarted. H4b was read-only only.

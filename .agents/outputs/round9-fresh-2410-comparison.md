# Round 9 — fresh Temporary Plan #2410 versus corrected Prayag evidence

## Provenance

- Fresh run: PTMT Temporary Plan `#2410`, September 2026, finalized on 2026-09-07.
- Run note: precedence-aware roster and source ambiguity handling are active.
- Frozen #2367 remains untouched and is retired as a category-comparison baseline.
- Prayag evidence: the corrected Round 7 itemized comparison input, restricted to the
  1,506 shared rows / 1,486 unique codes, plus the 250 app-only rows.
- Itemized output: `round9-fresh-2410-vs-prayag.csv`.

## Category result

| Measure | Fresh result |
|---|---:|
| Non-ambiguous category mismatches | **0** |
| Non-ambiguous mismatch codes | **0** |
| Source-ambiguous rows | **18** |
| Source-ambiguous identities | **18** |
| App-only rows | **250** |
| App-only identities | **218** |
| Prayag-only identities | **39** |

All 18 ambiguous identities remain `Unclassified`. Every single-category Prayag identity
matches the fresh roster category. This confirms that the precedence rule is reaching the
fresh plan; the old #2367 category discrepancy was staleness.

## Fresh roster distribution

| Category | Rows |
|---|---:|
| Cocks Standard | 2,093 |
| Cocks Premium | 601 |
| Faucets & Jetsprays & Shower | 203 |
| Accessorise | 223 |
| Cistern & Seat Cover | 201 |
| Ball Cock | 77 |
| Unclassified | 70 |
| Cabinet | 54 |
| P.V.C. Connections | 31 |
| Waste Pipes | 31 |

## Input-difference check

At code grain with a 0.1 tolerance, comparing the fresh frozen run inputs to the retained
Prayag comparison inputs produced:

- avg3: 2 codes
- stock: 11 codes
- pending last month / dummy: 39 codes
- pending current: 50 codes
- union: 80 codes

These figures are retained as measured results of this comparison. They are not forced to the
earlier expected profile because the fresh roster and pending joins changed the code-level
aggregation. The full row-level values are in the CSV.

## Negative-clamp presentation

The first-pass code-grain presentation count is 549 shared rows where Prayag's requested plan
is negative and the fresh plan is zero. This is a display/reporting measure, not a category
failure; it should not be used to reopen the category investigation.

## Positive differences with identical inputs

The apparent positive-plan differences are also explained by aggregation grain. Prayag has one
code-level row, while the app calculates and clamps each code-and-colour row before summing.
For code `123`:

| Colour | Avg3 | Stock | Dummy | Pending | Buffer | Raw pre-clamp | App plan |
|---|---:|---:|---:|---:|---:|---:|---:|
| BLUE | 20 | 74 | 0 | 0 | 30 | -44 | 0 |
| BURGUNDY | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| GREEN | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| IVORY | 12,491.67 | 3,652 | 0 | 0 | 18,737.51 | 15,085.51 | 15,085.51 |
| M GREEN | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| PINK | 180 | 155 | 0 | 0 | 270 | 115 | 115 |
| WHITE | 3,876.67 | 9,876 | 0 | 0 | 5,815.01 | -4,060.99 | 0 |

The code-level Prayag calculation is `11,095.5`; the app's per-colour total is `15,200.51`,
for a difference of `4,105.01`. The two negative colour residuals total `4,104.99`; the
remaining `0.02` is floating-point/rounding precision. The same identity holds for the
reported examples `121-O` (`614` from negative colours) and `144` (`344` from negative
colours).

Therefore these are expected clamp effects, not calculation failures. Future comparisons must
aggregate app rows to code level before comparing to Prayag, while retaining per-colour plans
for execution and audit detail.

## Conclusion

The fresh comparison answers the important question: category mismatches are zero after
excluding the 18 explicit source ambiguities. The 107 stale-Unclassified #2367 codes do not
survive as fresh category mismatches. Any future comparison should use a newly finalized
Temporary Plan rather than #2367.

## Business method finding: colour-level planning preserves production

The plan difference is not only presentation. Prayag clamps after combining all colours for a
code; the app clamps each code-colour need before summing. A surplus of IVORY therefore cannot
offset a WHITE shortfall in the app plan, because those pieces are not interchangeable for
customer fulfilment.

The comparison CSV now carries both figures for every shared code:

- `code_level_clamp`: clamp after code-level aggregation; comparable to Prayag's method.
- `colour_level_clamp`: sum of per-colour clamped plans; the app's execution basis.
- `colour_clamp_benefit`: the production preserved by respecting colour as a constraint.

On the persisted #2410 code-grain evidence, the exact input-identical positive population is
134 codes:

| Basis | Codes | Total pcs |
|---|---:|---:|
| Code-level clamp | 134 | 381,489.37 |
| Colour-level clamp | 134 | 410,822.32 |
| App-preserved production | 134 | **29,332.95** |

The broader positive method-benefit population is 148 codes and **33,464.95 pcs**. The
previous discussion referred to a 160-code review population, but that key list is not present
in the persisted #2410 artifact; the reproducible exact-input result above is intentionally
reported without inventing the missing membership. The September PDF addendum presents the
measured basis and the business conclusion for Prayag.
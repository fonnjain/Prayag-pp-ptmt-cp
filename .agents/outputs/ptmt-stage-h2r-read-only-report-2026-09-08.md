# PTMT Stage H2r report — warning-only raw-spelling guard

**Date:** 2026-09-08  
**Scope:** H2r only. Development code change; no normalizer, plan, override, finalization, scheduler, validation, deployment, or production changes were made.

## Implementation

The guard is placed at the completed-roster return point in `buildEffectivePtmtRosterWithClassifier`.

It:

- groups roster rows by the existing `normalizeCodeStrict` key;
- reports a group only when it contains at least two distinct raw code spellings;
- does not report multiple colours of one raw spelling;
- logs one warning per violating group at warning level;
- returns the same sorted roster unchanged;
- does not merge, deduplicate, drop, or throw on any row;
- does not change any normalizer and has no configuration flag.

The warning includes the strict key and, for every row, raw code, colour, category, entry path, and demand when a caller supplies a frozen-plan demand map. The normal roster construction path has no legitimate historical plan context, so its warning marks demand as unavailable rather than hard-coding a run ID. The exported collision helper accepts a #2419 demand map for reporting and tests.

A code comment records that the warning can become fatal only after the canonical-key decision resolves the affected groups.

## Verification

- API TypeScript check: passed.
- Focused rate-list tests: **13 passed, 0 failed**.
- `git diff --check`: passed.
- The guard's output is content-preserving: roster size before and after is the same, and the helper returns diagnostic data without modifying rows.

## Current live-roster values

The read-only live probe on 2026-09-08 returned:

| Measure | Value |
|---|---:|
| Roster rows before | 6,574 |
| Roster rows after | 6,574 |
| Persisted #2419 result rows | 3,584 |
| Raw-spelling collision groups in the current roster | 101 |
| Current collision groups with at least one #2419 row | 8 |
| #2419 demand across those 8 groups | 6,420.67 |

The earlier H1 report recorded 3,584 effective-roster rows and 7 raw-spelling groups carrying 6,350.67 pieces. The current live roster is therefore not the same source snapshot: the live rate-list path currently returns 1,434 rows and introduces additional raw-spelling groups. The guard reports the current roster values rather than silently applying the old seven-group inventory.

The seven H1 groups remain present and carry the previously reported **6,350.67** pieces:

| Strict key | Raw spellings | #2419 demand |
|---|---|---:|
| 1231F | `1231-F`, `1231F` | 0.00 |
| 129I | `129-I`, `129I` | 0.00 |
| 129QW | `129-QW`, `129QW` | 0.00 |
| 130C | `130-C`, `130C` | 115.00 |
| 132I | `132-I`, `132I` | 0.00 |
| 132T | `132-T`, `132T` | 6,099.67 |
| 133NEW | `133-NEW`, `133NEW` | 136.00 |

The additional current-live collision intersecting #2419 is `CNS15`, with 70.00 pieces. The complete 101-group warning payload is saved in:

`.agents/outputs/stage-h2r-current-roster-warning.json`

That file preserves every warning group and every row-level diagnostic value, including `null` demand where the code/colour has no corresponding #2419 result row.

## H2r.4 — `129-QW` category split

The current roster confirms the split:

| Raw code | Category | Classification path | #2419 demand |
|---|---|---|---:|
| `129-QW` | Cocks Premium | Prayag planning-tab evidence | 0.00 |
| `129QW` | Cocks Standard | Rate-list classification | 0.00 |

Both spellings resolve behind one loadable MRP product row. No category was changed.

Among the seven H1 groups, no other group has a category split. The current live roster has one additional split outside those seven: `CNS 15` is `Accessorise`, while `CNS-15` is `Unclassified`.

## Content-safety confirmation

No roster row was added, removed, merged, deduplicated, or category-mutated by H2r. No plan run was created or changed. The current live discrepancy versus the H1 seven-group snapshot is recorded as a source-state finding, not resolved by a filter or hard-coded exception.

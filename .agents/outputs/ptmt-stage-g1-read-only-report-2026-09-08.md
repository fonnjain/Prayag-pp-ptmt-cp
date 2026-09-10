# PTMT Stage G1 read-only report

**Date:** 2026-09-08  
**Scope:** G1 only. No normalizer, roster, database, override, plan, scheduler, validation, deployment, or production changes were made. G2 remains unstarted and requires explicit Nishant approval.

## G1.1 — Do `323-K` and `323K` merge or duplicate?

### Current key used by the roster

The PTMT roster does **not** use `sheets.normalizeCode` for its identity key. Roster construction uses the separate function in `rate-list.ts`:

```ts
export function normalizeRateListCode(value: unknown): string {
  return String(value ?? "").trim().toUpperCase().replace(/\.0$/, "");
}
```

This preserves hyphens and spaces. The `represented` set in `buildEffectivePtmtRosterWithClassifier` is checked with that key:

- Item-master loop: normalizes `row.itemCode`, then `represented.add(code)`.
- Reviewed-catalogue loop: normalizes the catalogue code, checks `represented.has(code)`, then adds it.
- MRP bridge: uses the same exact key and checks `represented.has(code)`.
- Rate-list loop: checks `represented.has(row.code)` and stores `row.code`.

The MRP lookup map is also keyed by `normalizeRateListCode`, and the rate-list map is keyed by the already-normalized exact rate-list code. Therefore `323-K` and `323K` are currently different keys.

### Values for the 323 pair

- Active reviewed catalogue / MRP-backed code: `323K`.
- Governed rate-list code: `323-K`.
- Current effective-roster source precedence can admit both:
  - `323K` through the reviewed catalogue path.
  - `323-K` through the rate-list path.
- The same shape exists for `324-K`/`324K`, `325-K`/`325K`, and `326-K`/`326K`.

**Answer:** under the current roster construction, the two spellings remain **separate roster identities** when both source rows are admitted. The code that decides this is the exact-key `represented.has(...)` test using `normalizeRateListCode`.

The persisted #2419 draft contains only the rate-list spellings, so it has one stored row for each of the four codes and does not currently count the MRP spelling a second time. The full source-precedence roster has the duplicate-key shape that G2.3 is intended to guard.

A change to `sheets.normalizeCode` alone would not reach this roster path. The roster path uses `normalizeRateListCode`; the catalogue/MRP path also has a separate `normalizeCatalogueCode`.

## G1.2 — Normalization call sites and impact of stripping hyphens/spaces

There are three production code normalizers with overlapping current behavior:

| Function | Location | Current behavior | Used by |
|---|---|---|---|
| `normalizeCode` | `lib/sheets.ts:830` | trim, uppercase, remove trailing `.0` | planning/upload/pending/actual joins and several downstream comparisons |
| `normalizeRateListCode` | `lib/rate-list.ts:95` | trim, uppercase, remove trailing `.0` | PTMT roster identity, rate-list map, MRP lookup, rate-list reconciliation |
| `normalizeCatalogueCode` | `lib/master-products.ts:430` | trim, uppercase, remove trailing `.0` | catalogue and MRP ingestion/review keys |

There are also two separate normalizers that are already stricter:

- `normalizeCodeStrict` in `lib/sheets.ts:898` already removes hyphens, spaces, and dots for production-to-plan matching.
- `plumbing-schedule-export.ts:37` has a private normalizer that removes every non-alphanumeric character.

### Shared `sheets.normalizeCode` call sites

Complete production call-site inventory:

- `lib/sheets.ts`: lines **827, 921, 1490, 1504, 1529, 1561, 1600, 1605, 1702, 1727, 1788, 1814**.
- `lib/seed.ts`: line **53**; normalized item-master code is written during seed parsing.
- `lib/plant-engine.ts`: lines **239, 337**; production lookup/category matching.
- `lib/plant-ingestion.ts`: line **362**; actual category lookup.
- `lib/corrective-engine.ts`: lines **434, 719, 774**; code and colour-key comparisons.
- `lib/plan-vs-actual-engine.ts`: lines **345, 439, 460, 1162, 1201**; plan/actual comparison and reporting lookups.
- `lib/plant-weekly-engine.ts`: lines **193, 202, 209**; weekly production lookup.
- `routes/plan.ts`: lines **181, 425, 479, 653, 682, 965, 973, 1039, 1072, 2437, 2446, 2501, 2503, 3231, 3259, 3308**; planning inputs, uploads, pending joins, category checks, stock joins, and exact item keys.
- `routes/ops.ts`: lines **774, 823, 844, 890, 938, 985, 1118, 1215**; operations workbook and production joins.
- `lib/prayag-category-evidence.ts`: lines **34 and 173** use a **private local function with the same name**, not the shared `sheets.normalizeCode`.

Test-only call site: `lib/sheets-pending.test.ts:304`.

### Impact by requested area

| Area | Actual normalizer | Would stripping hyphens/spaces change it? |
|---|---|---|
| Roster construction / already-represented test | `normalizeRateListCode` | **Not from changing `sheets.normalizeCode`; yes only if the roster key normalizer is also changed.** |
| MRP classification lookup | `normalizeRateListCode` in `rate-list.ts`; `normalizeCatalogueCode` in catalogue/MRP code | **Not from changing `sheets.normalizeCode`; both separate maps currently preserve punctuation.** |
| Rate-list join | `normalizeRateListCode` and exact `rateListByCode` keys | **Yes if this normalizer is changed; no if only `sheets.normalizeCode` changes.** |
| Prayag category evidence | private `prayag-category-evidence.ts:34` normalizer | **No from a shared `sheets.normalizeCode` change.** It would need its own change to join `323-K` and `323K`. |
| Upload parsing and item/colour key | shared `sheets.normalizeCode`, including `itemKey` | **Yes.** Code portions of pending, upload, stock, and item/colour keys would change; `normalizeColour` is separate and would not change. |
| Plan result storage | plan items retain their roster `itemCode`; snapshot rows persist that value | **New runs would receive the changed roster spelling if the roster key is changed. Existing snapshots are not rewritten.** |
| Downstream comparisons | mixed: shared `normalizeCode`, `normalizeCodeStrict`, exact `itemKey`, and stored snapshot codes | **Yes in the shared-normalizer paths; strict paths already strip punctuation; exact persisted snapshots can become stale relative to new live keys.** |

### Additional shared-normalizer risk

The proposed G2 text describes changing `normalizeCode`, but the four-code roster defect is controlled by `normalizeRateListCode` and `normalizeCatalogueCode`. A `sheets.normalizeCode`-only change would affect upload/actual/pending joins while leaving the roster duplicate shape unchanged.

## G1.3 — Persisted normalized keys

Normalized or canonicalized code values are stored, not only computed at read time:

- `item_master.item_code`: seed parsing writes `normalizeCode(itemCode)`.
- `master_products.item_code`: catalogue ingestion uses `normalizeCatalogueCode`.
- `mrp_control_rows.item_code`: MRP import uses `normalizeCatalogueCode`.
- `plan_run_inputs.item_code` and `plan_run_results.item_code`: frozen snapshots store the plan item's current code spelling.
- Uploaded source rows retain their parsed/source representation in JSON payloads; they are not a universal canonical-key store.

### Persisted rows affected by a global hyphen/space key change

Read-only counts of rows whose current stored code contains hyphens/spaces and would differ after stripping them:

| Table/scope | Rows | Distinct codes |
|---|---:|---:|
| `item_master`, PTMT | 2,606 | 1,259 |
| Active `master_products`, PTMT | 1,918 | 1,918 |
| Latest loadable PTMT MRP product rows | 1,876 | 1,876 |
| `plan_run_inputs`, runs #2410/#2419/#2420 | 8,412 | 1,457 |
| `plan_run_results`, runs #2410/#2419/#2420 | 8,412 | 1,457 |

For the four K codes specifically:

- MRP and active catalogue store the canonical spellings `323K`, `324K`, `325K`, and `326K`.
- Each of #2410, #2419, and #2420 stores four hyphenated result rows and four hyphenated input rows: **12 input rows and 12 result rows total** across the three runs.
- No `323K`/`324K`/`325K`/`326K` rows occur in those persisted plan snapshots.

The persisted runs were not altered. If a future live roster uses stripped keys, the existing frozen snapshot rows remain hyphenated and require an explicit compatibility/matching decision; they must not be rewritten implicitly.

## G1.4 — Four K codes in #2419 and authoritative MRP

### Persisted #2419 rows

| Code | Colour | Avg 3-month sale | Stock | Current pending | Last-month pending | Buffer requirement | Demand plan |
|---|---|---:|---:|---:|---:|---:|---:|
| 323-K | blank | 11,600.00 | 993 | 0 | 0 | 17,400 | 16,407 |
| 324-K | blank | 10,600.00 | 614 | 0 | 0 | 15,900 | 15,286 |
| 325-K | blank | 900.00 | 268 | 0 | 0 | 1,350 | 1,082 |
| 326-K | blank | 1,733.33 | 0 | 0 | 452 | 2,600 | 3,052 |

**Total for the four persisted rows:** **35,827 pieces** of demand plan.

### Latest loadable MRP rows

| MRP code | Division | Series | Product name | Row type | Loadable | Discontinued |
|---|---|---|---|---|---|---|
| 323K | PTMT & Plastic Fittings | P.V.C. Connections (Plain Nut Round) | P.V.C. Connection (Single Piece Packing) 18"/450mm | product | true | false |
| 324K | PTMT & Plastic Fittings | P.V.C. Connections (Plain Nut Round) | P.V.C. Connection (Single Piece Packing) 24"/600mm | product | true | false |
| 325K | PTMT & Plastic Fittings | P.V.C. Connections (Plain Nut Round) | P.V.C. Connection (Single Piece Packing) 30"/750mm | product | true | false |
| 326K | PTMT & Plastic Fittings | P.V.C. Connections (Plain Nut Round) | P.V.C. Connection (Single Piece Packing) 36"/900mm | product | true | false |

All four MRP `discontinued_from` values are null.

## G1.5 — Wider spelling shape across PTMT sources

The source inventory used for this read-only scan was:

- 1,459 PTMT item-master code identities.
- 4,442 rows from the latest governed rate-list upload snapshot.
- 2,121 rows from the current PTMT MRP series export.
- 1,506 shared Prayag evidence rows.

Hyphen/space-stripping found:

- **111 strict-key groups** with more than one raw spelling.
- **20 groups spanning more than one source.**
- **99 groups contained only within the rate-list source** but still have multiple exact rate-list spellings.
- Source-precedence reconstruction gives more than one admitted exact roster key for each of the 111 groups under the current hyphen-preserving key behavior.
- The #2419 demand carried by all cross-source groups, using exact persisted spelling, totals **42,330.34 pieces**.

### Cross-source groups

| Strict key | Raw spellings | Sources | #2419 demand by exact spelling |
|---|---|---|---:|
| 1231F | `1231-F` / `1231F` | item master, MRP, Prayag, rate list | 0.00 |
| 129I | `129-I` / `129I` | item master, MRP, Prayag, rate list | 0.00 |
| 129QW | `129-QW` / `129QW` | item master, MRP, Prayag, rate list | 0.00 |
| 130C | `130-C` / `130C` | item master, MRP, Prayag, rate list | 115.00 |
| 1322U | `132-2U` / `1322-U` | MRP, rate list | 0.00 |
| 132I | `132-I` / `132I` | item master, MRP, Prayag, rate list | 0.00 |
| 132T | `132-T` / `132T` | item master, MRP, Prayag, rate list | 6,099.67 |
| 133NEW | `133-NEW` / `133NEW` | item master, MRP, Prayag, rate list | 136.00 |
| 322K | `322-K` / `322K` | MRP, rate list | 0.00 |
| 323K | `323-K` / `323K` | MRP, rate list | 16,407.00 |
| 324K | `324-K` / `324K` | MRP, rate list | 15,286.00 |
| 325K | `325-K` / `325K` | MRP, rate list | 1,082.00 |
| 326K | `326-K` / `326K` | MRP, rate list | 3,052.00 |
| 348K | `348-K` / `348K` | MRP, rate list | 0.00 |
| 501N | `501-N` / `501N` | item master, MRP, Prayag, rate list | 0.00 |
| 501S | `501-S` / `501S` | item master, MRP, Prayag, rate list | 0.00 |
| 503N | `503-N` / `503N` | item master, MRP, Prayag, rate list | 0.00 |
| 701N | `701-N` / `701N` | item master, MRP, Prayag, rate list | 82.67 |
| CNS15 | `CNS 15` / `CNS-15` | item master, Prayag, rate list | 70.00 |
| DB02L | `DB-02 L` / `DB-02L` | MRP, Prayag, rate list | 0.00 |

The complete per-source, per-spelling inventory includes the exact #2419 demand for each raw code and is saved in:

- `.agents/outputs/stage-g1-spelling-pairs.csv`
- `.agents/outputs/stage-g1-spelling-pair-summary.csv`

The 99 rate-list-only groups are included there rather than silently omitted. They include families such as `PIS`, `PR`, `DB`, and `PD` with multiple hyphen/space spellings in the same governed source.

### Other punctuation and leading-zero variants

A broader remove-all-punctuation scan found **7 additional punctuation groups** not explained by hyphen/space stripping alone. They are rate-list-only examples involving slash or trailing full-stop punctuation:

- `DB -76 ON/OFF` / `DB-76-ON-OFF`
- `DB-93-N` / `DB-93-N.` / `DB-93N`
- `DB-68-3 IN-ON-OFF-N` / `DB-68-3IN-ON-OFF-N` / `DB-68-3IN-ON-OFF-N.`
- `DB-53-3 IN-ON-OFF-N` / `DB-53-3IN-ON-OFF-N` / `DB-53-3IN-ON-OFF-N.`
- `9392 N-N` / `9392N-N` / `9392N-N.`
- `BB-53-S` / `BB-53-S.`
- `DB-93-H-N` / `DB-93-H-N.`

The complete list is in `.agents/outputs/stage-g1-nonhyphen-pairs.csv`.

A separate leading-zero scan found **7 rate-list-only groups**:

- `PMS-091` / `PMS-91`
- `PMS-092` / `PMS-92`
- `PIF-007` / `PIF-07`
- `PIF-008` / `PIF-08`
- `BA-02S` / `BA-2S`
- `BA-05S` / `BA-5S`
- `TTS-02` / `TTS-2`

These are not part of the proposed hyphen/space-only change. They are saved in `.agents/outputs/stage-g1-leading-zero-pairs.csv`.

## Read-only outputs

- `.agents/outputs/ptmt-stage-g1-read-only-report-2026-09-08.md`
- `.agents/outputs/stage-g1-spelling-pairs.csv`
- `.agents/outputs/stage-g1-spelling-pair-summary.csv`
- `.agents/outputs/stage-g1-nonhyphen-pairs.csv`
- `.agents/outputs/stage-g1-leading-zero-pairs.csv`

G2 was not started.

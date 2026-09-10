# Round 8 — corrected interpretation of the frozen #2367 comparison

The earlier Round 8 narrative incorrectly combined two separate populations. It is retired as
a category-comparison baseline.

## Provenance

- Frozen run: PTMT Temporary Plan `#2367`, September 2026, finalized.
- Live category source: the precedence-aware `getEffectivePtmtRoster()`.
- Comparison population: the persisted Round 7 #2367 shared/app-only scope.
- Shared population: 1,506 rows / 1,486 unique codes.
- App-only population: 250 rows / 218 unique codes.

## Corrected finding

The frozen #2367 rows contain **107 distinct codes stored as `Unclassified`**. After the
precedence rule was loaded by the current roster:

- 105 resolve to `Cocks Standard`;
- 2 resolve to `Accessorise`;
- all 107 have Prayag category evidence;
- none are missing evidence.

Those 107 are a **staleness artefact** of #2367, not 107 live category failures. The current
roster is working; the correct next step is a fresh Temporary Plan.

The separate source-evidence review found exactly 18 identities under multiple Prayag
categories. They remain `Unclassified` and are `AMBIGUOUS_IN_SOURCE`:

`123-FH`, `123-HN`, `124-FH`, `126-SQ`, `130-RN`, `1322-HN`, `1375-SP`,
`146-B`, `146-BO`, `146-HB`, `147-HQ`, `147-RQ`, `148-B`, `148-BO`,
`148-HB`, `186`, `1861`, and `202`.

There is **no real 89-code unexplained remainder**. It was produced by conflating the stale
107-code #2367 population with the independent 18-code ambiguity inventory.

The authoritative follow-up is captured in
`.agents/outputs/round9-fresh-2410-comparison.md` and its itemized CSV.
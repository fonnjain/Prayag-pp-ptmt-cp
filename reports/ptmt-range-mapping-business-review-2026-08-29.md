# PTMT range mapping business review

**Date:** 2026-08-29  
**Status:** HOLD — do not run a PTMT plan using the proposed range mapping until Prayag confirms the category/capacity interpretation.

## July reconciliation

The supplied `LAST MONTH PENDING ORDERS JULY 2026.xlsx` source still reconciles exactly:

| Measure | Pieces |
|---|---:|
| Source | **168,695** |
| Joined | **160,501** |
| Unmatched | **8,194** |
| Unmatched codes | **33** |

The mapping changes category allocation only. It does not change the source, joined, or unmatched totals.

## Three explicit category states

The numbers below are not interchangeable. **State B is the current live state used by the app today.**

| State | Cocks Standard | Unclassified |
|---|---:|---:|
| **A · Before MRP — 58-row RANGE NAME proposal** | 639 codes / 49,228 pcs | 0 pcs |
| **B · Current — MRP precedence, crosswalk not applied** | 64 codes / 1,437 pcs | 4,911 codes / 70,196 pcs |
| **C · Projected — after the 9 crosswalk rows** | ~34,000 pcs | ~17,600 pcs |

State C is a projection, not an applied change. The rest of this review labels the evidence by state so that proposal, current, and projected balances cannot be read as one category table.

## State B — Current live state

The app currently applies **MRP precedence**, but the nine-row crosswalk has **not** been applied. The current balance relevant to this review is:

- **Cocks Standard:** 64 codes / **1,437 July pieces**
- **Unclassified:** 4,911 codes / **70,196 July pieces**

This is the state the review should lead with. The State A Accessorise utilisation warning below does **not** describe today’s live classification.

## State A — Before MRP: 58-row RANGE NAME proposal

The following table is the **proposal-only** category balance from the 58-row RANGE NAME mapping. It is not the current app state:

| Category | Effective codes | July demand |
|---|---:|---:|
| Cocks Standard | 639 | 49,228 |
| Cocks Premium | 604 | 2,407 |
| Faucets & Jetsprays & Shower | 107 | 11,303 |
| Accessorise | 199 | **73,699** |
| Ball Cock | 64 | 11,698 |
| Cistern & Seat Cover | 48 | 11,034 |
| Cabinet | 22 | 1,132 |
| **Governed total** | **1,683** | **160,501** |

In this proposal, Unclassified retains 3,005 effective codes but **0 July pieces**. Cocks Standard had zero codes in the old rate-list range classifier; the proposal gives it 639 effective-roster codes. Its stated capacity is **19,201 pieces/day**, or **556,829 pieces/month**, against 49,228 July pieces (**9% utilised**).

**Proposal-only warning:** Accessorise carries **73,699 July pieces (45.9%)** in State A. At the stated **2,594 pieces/day**, or **75,226 pieces/month**, that is approximately **98% utilised**, leaving almost no headroom. This warning belongs to State A and must not be presented as the current State B utilisation.

## State A — Proposal multiplier impact

In State A, the raw July total is unchanged, but the proposed mapping moves previously Unclassified demand into governed categories:

| Measure | Before | After | Change |
|---|---:|---:|---:|
| Raw July demand | 160,501 | 160,501 | 0 |
| Governed-category demand | 93,448 | 160,501 | **+67,053** |
| Multiplier-adjusted demand | 135,800.1 | 236,379.6 | **+100,579.5 (+74.1%)** |

The entire multiplier-adjusted increase lands in Accessorise in this proposal split: its demand rises from 6,646 to 73,699 and receives the 1.5x multiplier. This is the mechanism that would raise a plan under State A, but it places the increase in the category with almost no measured headroom. It is not a description of State B.

## State B — Current MRP precedence and roster collisions

The current PTMT roster contains **14** multi-category item-and-colour identities; the previously handled `186` identity is no longer a collision and there is no fifteenth current identity.

The authoritative MRP identifies nine of the 14 source-level collisions for the crosswalk, but those rows are not yet applied. **Eight** would resolve through `Standard (New Handle)` or `Standard (Old Handle)` → **Cocks Standard**. Those are the same Standard ranges carrying **32,693 pieces** in the crosswalk, so applying the nine high-confidence crosswalk rows would resolve most of this ambiguity in one change.

The remaining five are not an additional business question:

- `123-FH / IVORY` — `Helix`
- `124-FH / IVORY` — `Helix`
- `146-HB / WHITE` — `Helix`
- `148-HB / WHITE` — `Helix`
- `1375-SP / IVORY` — `Diamond`

These four Helix identities and one Diamond identity are already within the 11 ranges awaiting Prayag’s answer to the same premium-versus-standard question. Until that answer is recorded, they remain **Unclassified with no buffer multiplier**. This is safer than applying a multiplier to an ambiguous source classification.

The underlying source rows remain visible even where MRP produces one effective category. Do not deduplicate those rows or make the rendering key more unique: the source-level disagreement is evidence that must remain reviewable.

## State C — Projected after the 9 crosswalk rows

If the nine identified crosswalk rows are applied, the projected balance is approximately:

- **Cocks Standard:** **~34,000 July pieces**
- **Unclassified:** **~17,600 July pieces**

This projection is useful for evaluating the effect of the crosswalk, but it is not the current live state and must not be used as evidence that the app has already changed classification.

## CONNECTION decision required

The supplied 58-row proposal maps:

**`CONNECTION` → `Accessorise`**

The rate list contains **35 CONNECTION codes**. In the selected July source, only six carry demand:

| Code | July pieces |
|---|---:|
| 321 | 48 |
| 324 | 29,630 |
| 325 | 7,441 |
| 326 | 8,670 |
| 323-K | 5,530 |
| 324-K | 11,911 |
| **CONNECTION total** | **63,230** |

The previously cited **67,215** included seven Waste Pipe codes as well; it is not the CONNECTION-only figure.

Prayag should decide between:

1. PVC connections belong in another category with more capacity; or
2. Accessorise is the correct category, but its historical capacity is understated because these items were absent from prior plans or were not attributed to Accessorise.

Until that business decision is recorded, this proposed mapping is evidence for review only and must not be used to run a PTMT plan.
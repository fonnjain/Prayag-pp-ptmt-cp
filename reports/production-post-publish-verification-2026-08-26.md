# Post-publish production verification

Verified on 2026-08-26 against the public production API at `https://prayag-pp.com`.

## Build identity and migration timing

| Check | Value |
|---|---|
| `git rev-parse origin/main` (after refreshing the remote-tracking ref) | `5956d390bb9eda6e21d60a7f7adda32a49cfcb77` |
| Deployed `/api/healthz` `commitSha` | `5956d390bb9eda6e21d60a7f7adda32a49cfcb77` |
| Code identity match | **Yes** |
| API database | `ep-orange-tree-aj9n6w8a.c-3.us-east-2.aws.neon.tech` |

The local `origin/main` ref was stale at `e347c3633dc049f31c9c215de1b273751d510ba5`
until it was refreshed. The authoritative remote branch and the deployed SHA both
reported `5956d390bb9eda6e21d60a7f7adda32a49cfcb77`.

Migration 036 was applied at **16:41:47 IST**, before this publish. Therefore,
production data was canonicalised while the pre-publish production code was not.
That temporary schema/code divergence was benign here: canonical data remains
readable by the non-canonicalising code. It is recorded because the migration
and code did not become live at the same point in time.

## July pending reconciliation against production

The production `LAST MONTH PENDING ORDERS JULY 2026.xlsx` upload totals
**168,695** pieces.

The preserving merged-roster calculation against production currently returns:

| Result | Expected | Production |
|---|---:|---:|
| Source | 168,695 | 168,695 |
| Matched | 150,445 | 150,140 |
| Unmatched | 18,250 | 18,555 |

The exact **305-piece** difference is `DB-02L / WHITE`. The live catalogue identifies
it as `Ball Cock+Ball (ISI)` in the reviewed division
`Ceramic Sanitaryware | PTMT & Plastic Fittings`, which the deployed code maps to
PTMT. However, the production `master_products` row still has `segment = NULL`;
the catalogue mapping has not yet been reflected in that production row. This is
why production is 305 pieces short of the expected merged-roster result.

For reference, production also reports:

- catalogue-only match: 137,043 matched / 31,652 unmatched;
- item-master colour-aware match: 90,879 matched / 77,816 unmatched;
- preserving union of the active PTMT catalogue codes and PTMT item-master
  code/colour identities: 150,140 matched / 18,555 unmatched.

No production data was modified during this verification.

## Production verifier classification

The verifier was run explicitly with `API_BASE=https://prayag-pp.com`, using the
published API and its production database. It completed with **473 assertions**:

| Classification | Result |
|---|---|
| Measured | 379 assertions: 375 passed, 4 failed |
| Quarantined | 94 golden-backed assertions; the 18 golden-integrity failures remain outside measured regressions |
| Pre-existing | 4 measured assertion failures, representing 3 underlying conditions |
| New | **0** |

The four pre-existing measured failures were:

1. Plumbing unmatched pending: 2,277 versus the 1,938 baseline.
2. The same 2,277-versus-1,938 drift surfaced by the new pending-coverage check.
3. PTMT current live pending: 6,390 versus the 7,993 reference.
4. One historical monitoring snapshot has a null captured commit SHA.

The 18 golden-integrity failures are the existing self-sum/identity problems:
they invalidate dependent golden comparisons and remain quarantined as intended.
No new measured failure was attributable to this publish.

## Catalogue review of multiplier-sensitive identities

All nine codes are present in the live catalogue:

| Code | Catalogue name | Catalogue category |
|---|---|---|
| `123-FH` | Bib Cock Fancy (Foam Flow) with Flange | PTMT Taps |
| `124-FH` | Bib Cock Long Body 15mm (Foam Flow) with Flange | PTMT Taps |
| `130-RN` | Pillar Cock Fancy 15mm (Foam Flow) with Flange | PTMT Taps |
| `1322-HN` | Sink Cock Swan Neck (W/M) Small Spout Foam Flow with Flange | PTMT Taps |
| `1375-SP` | Wall Mixer Foam Flow L Bend With Flange | Diamond |
| `146-HB` | Concealed Stop Cock 15mm with Brass Body | PTMT Taps |
| `147-HQ` | Pillar Cock Swan Neck Foam Flow Square Spout with Flange | PTMT Taps |
| `147-RQ` | Pillar Cock Swan Neck Square Spout Foam Flow with Flange | PTMT Taps |
| `148-HB` | Concealed Stop Cock 20mm with Brass Body | PTMT Taps |

The catalogue confirms the products and their PTMT division, but it does not
distinguish `Cocks Premium` from `Cocks Standard`. It therefore does not settle
the multiplier choice. One grouped business question remains appropriate:

> For `123-FH`, `124-FH`, `130-RN`, `1322-HN`, `1375-SP`, `147-HQ`, and
> `147-RQ`, are the `-FH`, `-HN`, `-HQ`, and `-RQ` variants Premium or Standard
> lines? For `146-HB` and `148-HB`, should the concealed stop-cock variants be
> treated as Premium, Standard, Accessorise, or remain explicitly multi-category?
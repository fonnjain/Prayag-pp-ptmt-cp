---
name: Authoritative MRP controls
description: Governance rule for MRP-derived PTMT identity, categories, and planning release.
---

The authoritative MRP workbook is the identity and series source for PTMT. MRP series outrank inferred RANGE NAME or rate-list categories; unsupported or disputed series remain visible holds rather than receiving a speculative buffer. `DB-02L` is treated as a cistern/seat-cover family item, not Accessorise.

**Why:** the MRP includes product identity, effective dates, colour-price availability, discontinued state, and classifications that earlier planning sources can omit or misclassify. Releasing a plan before resolving disputed capacity families can turn a source disagreement into an executable commitment.

**How to apply:** preserve the workbook and supporting series evidence as an auditable import, keep discontinued products with confirmed demand but no speculative buffer, and hold PTMT Production Plans until the business approves disputed category/capacity treatment. A Temporary Plan is a demand snapshot and may pass this MRP gate, but it must still pass all independent source/reconciliation guards. Plumbing planning is independent of this PTMT hold.

Exact reviewed series mappings take precedence over division fallback, including when the authoritative row carries a mixed division; exact pending-review series still remain held.

**Why:** otherwise an approved series can appear in the review report while its actual item rows remain Unclassified, producing a silent mismatch between governance evidence and planning categories.

**How to apply:** resolve the normalized exact-series decision before division-specific inference, then require the resulting category to be an executable model category before assigning a buffer.

The reviewed PTMT projection can differ from the raw source's governed-series count when PTMT-containing mixed divisions remain outside the approved segment mapping; that difference must be explained rather than hidden.

**Why:** temporary snapshots are useful for reviewing demand while approval is pending, but allowing them must never be confused with releasing executable production. Mixed-division admission changes product ownership and capacity responsibility.

**How to apply:** report raw source counts and reviewed-segment counts separately, and keep unmapped mixed-division rows visible for explicit business review.

July coverage metrics have different denominators: MRP control coverage uses the union of loadable MRP and rate-list keys, while the rate-list reconciliation uses the stricter effective planning-roster join.

**Why:** comparing those values as if they were one join makes valid MRP-only demand look like an unexplained loss.

**How to apply:** label broad source-key coverage and effective-roster coverage separately, and reconcile their difference through the unmatched code ledger before judging plannability.
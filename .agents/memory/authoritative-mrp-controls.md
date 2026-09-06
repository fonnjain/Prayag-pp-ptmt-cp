---
name: Authoritative MRP controls
description: Governance rule for MRP-derived PTMT identity, categories, and planning release.
---

The authoritative MRP workbook is the identity, series, and discontinuation source for PTMT. When an MRP series maps to a category, MRP wins; when a present series is unresolved, the rate list may classify what the plant actually makes. Unsupported or disputed series remain visible holds rather than receiving a speculative buffer. `DB-02L` is treated as a cistern/seat-cover family item, not Accessorise.

**Why:** the MRP includes product identity, effective dates, colour-price availability, discontinued state, and classifications that earlier planning sources can omit or misclassify. Releasing a plan before resolving disputed capacity families can turn a source disagreement into an executable commitment.

**How to apply:** preserve the workbook and supporting series evidence as an auditable import, keep discontinued products with confirmed demand but no speculative buffer, and hold PTMT Production Plans until the business approves disputed category/capacity treatment. A Temporary Plan is a demand snapshot and may pass this MRP gate, but it must still pass all independent source/reconciliation guards. Plumbing planning is independent of this PTMT hold.

Exact reviewed series mappings take precedence over division fallback, including when the authoritative row carries a mixed division; exact pending-review premium series still remain held even when the rate list suggests a category.

**Why:** otherwise an approved series can appear in the review report while its actual item rows remain Unclassified, producing a silent mismatch between governance evidence and planning categories.

**How to apply:** resolve the normalized exact-series decision before division-specific inference. Preserve explicit MRP-held categories, fall back unresolved non-premium series to the rate-list category, and require the resulting category to be executable before assigning a buffer.

Prayag’s PTMT working sheet uses Series for finish/collection labels and RANGE NAME for product families. The named premium finishes are not single-category series: the present rows for Cobra, Helix, Quadra, Roman, Diamond, and Flora span multiple governed categories, so they cannot be approved as one series-level mapping. Erosa, Crystal, and Astra remain pending review. Luxor and Glory are the approved exception: authoritative MRP product descriptions for their 121/124/144 rows match the already governed standard-cock families, so both series resolve to Cocks Standard.

**Why:** assigning one category to a finish that contains standard cocks, premium cocks, and faucet families would misclassify product-level demand even when every individual range name is recognizable.

**How to apply:** use RANGE NAME for a future product-level crosswalk, but keep a series-level business escalation whenever one finish spans more than one category or has no product-level evidence. Preserve the explicit Luxor/Glory Cocks Standard decision; leave newly observed series such as Ultra (Royal), Lagoona, Novo (Black), Showers & Accessories (Peach), and plain Quadra Unclassified until reviewed.

The reviewed PTMT projection can differ from the raw source's governed-series count when PTMT-containing mixed divisions remain outside the approved segment mapping; that difference must be explained rather than hidden.

**Why:** temporary snapshots are useful for reviewing demand while approval is pending, but allowing them must never be confused with releasing executable production. Mixed-division admission changes product ownership and capacity responsibility.

**How to apply:** report raw source counts and reviewed-segment counts separately, and keep unmapped mixed-division rows visible for explicit business review.

July coverage metrics have different denominators: MRP control coverage uses the union of loadable MRP and rate-list keys, while the rate-list reconciliation uses the stricter effective planning-roster join.

**Why:** comparing those values as if they were one join makes valid MRP-only demand look like an unexplained loss.

**How to apply:** label broad source-key coverage and effective-roster coverage separately, and reconcile their difference through the unmatched code ledger before judging plannability.

The effective PTMT roster may promote an MRP-only identity only for an explicitly approved product-family exception; the current exception is Luxor/Glory. Do not promote every loadable MRP row, because unresolved finish families would become executable demand without an approved category or capacity treatment.

**Why:** MRP can contain valid product identities that are absent from the planning workbook and rate list, but broad promotion would change roster scope and silently release held demand.

**How to apply:** keep the bridge narrowly keyed to the approved series decision, preserve all other MRP-only demand in the exclusion ledger, and require a new business review before expanding the bridge.
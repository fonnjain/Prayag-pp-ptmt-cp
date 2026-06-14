---
name: Sanity-check model provenance
description: Why batch-level sanity_model/tier/downgraded exist and how the PDF footer resolves provenance.
---

# Sanity-check model provenance (footer must never show "n/a")

The data-sanity PDF footer must always name the model ACTUALLY used (deep, or
fast after a downgrade). The trap: provenance was read only from
`validation_findings` rows, so a clean `ok` verdict with ZERO findings left the
footer with nothing to read and it rendered "n/a".

Rule:
- `import_batches` carries `sanity_model` / `sanity_tier` / `sanity_downgraded`,
  set on every sanity run from the model the Anthropic call REPORTS using (after
  any deep→fast fallback), not the model originally requested.
- Footer/`getLatestSanity` resolves provenance as: first finding's model/tier →
  batch column → final default. Model's final default is `"unknown"`; tier's is
  `"n/a"` (matches the spec's footer code `tier || 'n/a'` — intentional, leave it).
- `downgraded` is read at batch level and shown as a " (downgraded)" marker.

**Why:** spec PROVENANCE GUARANTEE — the footer is the audit trail for which
tier judged the data; a zero-findings clean pass still ran on the deep model and
must say so.

**How to apply:** any new sanity persistence path must set the batch-level
provenance columns, and any consumer (PDF, API) must use the finding→batch→default
fallback rather than trusting per-finding rows to exist.

# validation_findings.source value (known, accepted divergence)

The schema documents `source` as 'deterministic'|'claude_sanity'. The
implementation instead stores the affected-source label (Layer A = "layerA";
Layer B = Claude's comma-separated affected sources, or "layerB"). This is
deliberate and SAFE: the frontend never displays the finding `source` field
(it renders type/severity/message/evidence/fix only), and layer provenance is
already recoverable from `model` (null = deterministic, set = claude). Do not
"fix" this to the literal enum without also relocating the affected-source label
into the message, or that information is lost.

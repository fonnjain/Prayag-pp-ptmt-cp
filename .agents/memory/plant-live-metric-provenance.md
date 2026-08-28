---
name: Plant live metric provenance
description: Live dashboard ratios must be derived from explicit production and ideal-basis fields at the API boundary.
---

Live dashboard ratios are display-only upstream values. The dashboard proxy must preserve `rejection_pct` exactly as returned and expose the source counts plus `total_count_basis` for diagnosis; it must not recompute a ratio with a different denominator. Every consumer must label net as rejects ÷ good output and gross as rejects ÷ total manufactured.

**Why:** PTMT currently reports reject ÷ total production while PIPE currently reports reject ÷ good output because PIPE's `total_count` equals `good_count`. Recomputing at the proxy would mask the upstream defect and leave other consumers wrong.

**How to apply:** Capture representative PTMT and PIPE payloads before changing arithmetic. Fix the calculation in Prayag-Plant-MC-Analysis, then keep this repo's live route as a transparent pass-through and test that it preserves upstream values.
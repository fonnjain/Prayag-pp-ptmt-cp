---
name: Nullable plan buffers
description: Unresolved classifications must remain NULL through calculation, persistence, read projections, and corrective calculations.
---

Unresolved or unapproved product classifications are demand-only: their buffer requirement must stay NULL and must never regain a category fallback multiplier.

**Why:** A nullable calculator result can still be coerced into a database default of zero or revived by a corrective fallback of one, making unresolved demand appear reviewed.

**How to apply:** When changing plan schemas or migrations, remove both NOT NULL and legacy defaults; preserve NULL in API/export projections and treat a NULL source buffer as zero-buffer demand-only in downstream numeric calculations.
---
name: Unit boundary guard
description: The Plumbing cascade unit assertion must catch per-piece values copied into total kg without rejecting legitimate light products.
---

The cascade boundary should assert the concrete handoff when source provenance is available: `totalKg` must equal rounded `maxProduction × kgPerPiece`. Do not infer validity from a historical kg/piece range; live BOMs can contain lighter products.

**Why:** Range-based implied-unit checks rejected legitimate low-weight rows, including live products below 0.04 kg/piece. Comparing the two explicitly named values catches a per-piece-as-total substitution without rejecting those products.

**How to apply:** Carry `kgPerPiece` alongside `totalKg` into the cascade when available; skip the assertion only for no-BOM or provenance-free paths, and keep errors explicit about expected `totalKg`. Test both valid light rows and deliberate substitutions.
---
name: Plumbing plan run casing
description: Both POST and GET /plan/runs normalise segment casing via RECOGNISED_SEGMENTS map; raw typo no longer silently returns [] or 0 items. DB stores "Plumbing" / "PTMT" (canonical).
---

## Rule
`POST /plan/runs` and `GET /plan/runs` both normalise segment casing through a `RECOGNISED_SEGMENTS` map (`{ ptmt: "PTMT", plumbing: "Plumbing" }`). Any incoming value that lowercases to "ptmt" or "plumbing" is accepted. `GET /plan` also normalises internally.

**Why:** Previously `GET /plan/runs` used an exact `eq()` on the raw string — a casing typo silently returned `[]`, which callers misread as "no runs found". `POST /plan/runs` passed the raw segment to `buildPlanItems()` without normalisation, silently producing 0-item runs for "PLUMBING". Both are now fixed. The DB continues to store the canonical cased values ("Plumbing", "PTMT").

**How to apply:** Any API call creating or filtering plan runs still needs the canonical segment string in direct DB queries (Drizzle `eq()` is case-sensitive). Use `"Plumbing"` and `"PTMT"` in all DB-layer code; let the route-layer normalization handle user-facing input.

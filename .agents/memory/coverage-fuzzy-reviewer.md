---
name: Fuzzy coverage reviewer (advisory layer)
description: Design rules and gotchas for the advisory Drive-vs-config coverage reviewer; what must stay isolated from the deep-sanity gate.
---

# Advisory FUZZY coverage reviewer

A second, ADVISORY layer on top of the deep-model content-sanity gate. It scans
Drive (DRIVE_ACTUAL) → reconciles vs configured sources (deterministic COVERAGE +
bounded UNACCOUNTED_RAW) → a FAST-model pass returns stale_or_partial / drift /
unaccounted_files / looks_complete / notes. Persisted to `coverage_runs`.

## Hard isolation rules (do not violate)
- STRICTLY advisory: never auto-add a source, never change the deep-sanity
  verdict or the plan gate. Adding a source is human-only via add-source endpoint.
- Coverage must NEVER block or slow the data pull. In the pull handler it runs
  fire-and-forget AFTER `res.json(...)` (`void runCoverageReview(...)`); in the
  scheduler it is awaited (no client waiting).
- `runCoverageReview` wraps everything in try/catch and swallows all failures
  (Drive down, model error, depleted credits). A failure leaves `coverage_runs`
  empty and the UI shows "No coverage review yet" — the core pull/gate is intact.

## Unaccounted discovery = RANK, never hard-drop
**Why:** an earlier keyword filter (RELEVANCE_KEYWORDS) as a hard gate could
silently exclude atypically-named real sources, breaking the "full coverage"
objective. **How to apply:** keyword relevance only RANKS (relevant first, then
most-recent); the cap (MAX_UNACCOUNTED) fills leftover slots with recent
non-matching files, and the deterministic `unaccounted_total` is reported in the
manifest so any tail beyond the cap is visible, never hidden.

## Prompt-size gotcha
The 272KB prompt blowup came from dumping all ~850 Drive files into
`manifest.drive_actual`. Fix = manifest carries only `drive_actual_count`
(+ unaccounted_total/shown); the file list goes ONLY through the bounded
UNACCOUNTED_RAW slice. Keep it that way — never re-add the full drive list to the
manifest.

## Fast-model JSON fragility
The fast model truncates at the token cap when evidence fields are verbose →
malformed JSON. Mitigations stack: a BREVITY rule in the system prompt, coverage
call uses maxTokens:8000 (optional override on callClaude), a 2-attempt retry,
and `extractJSON` hardening (trailing-comma strip + `closeTruncatedJSON` salvage
that cuts to the last complete element and closes open brackets).

## Drive scan cost
listDriveActual is ~95-99s for ~850 files and identical across divisions →
10-min in-process TTL `driveCache` shared by manual pull + both scheduled syncs.
Only non-empty scans are cached.

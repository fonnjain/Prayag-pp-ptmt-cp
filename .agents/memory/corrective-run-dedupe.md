---
name: Corrective run duplicate guard
description: How duplicate corrective runs are prevented and the float-precision pitfall behind it
---

Persisting a corrective run computes a SHA-256 fingerprint of the FULL persisted content (run fields + all item rows + weekStats + warnings, items sorted by category::code::colour) and, inside a transaction serialized by `pg_advisory_xact_lock(hashtext('corrective:<segment>:<month>'))`, reuses the latest run for that segment+month when its `fingerprint` matches instead of inserting.

**Why:** planning tables store numerics as Postgres `real` (single precision, ~7 sig. digits) — strict `===` between a stored value and a freshly-computed double never matches on large totals (e.g. 2,446,812.6 → 2.4468125e+06). Quantize with `Math.fround()` before hashing/comparing. Also, a plain read-then-insert guard races under concurrent scheduler/UI requests; the advisory lock makes dedupe atomic.

**How to apply:** any future "skip if identical to last row" guard on `real`-typed tables must quantize floats (Math.fround) and serialize via an advisory lock or unique constraint. Legacy rows have NULL fingerprint and are never reused.

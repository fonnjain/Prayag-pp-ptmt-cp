---
name: MRP monitoring error contract
description: Structured API behavior when PTMT monitoring reaches the authoritative MRP approval hold
---

PTMT planning held by authoritative MRP controls must surface as `PTMT_MRP_APPROVAL_REQUIRED` with HTTP 422 and the explanatory message. Monitoring and weekly-summary consumers should use the same structured condition as plan creation rather than returning a generic 500.

**Why:** The MRP hold is an expected named business condition, not an infrastructure failure; returning 500 created browser console noise and made the UI treat a known approval dependency as a server crash.

**How to apply:** When a monitoring computation propagates the PTMT MRP gate, preserve the named code, message, segment, and month in the response. Keep unexpected computation failures as 500s.
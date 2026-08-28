---
name: GCE publish promotion failures
description: How to distinguish a successful artifact build from a failed VM promotion when Replit emits no container logs.
---

## Rule

Treat a GCE publish that reaches image push and then stalls at “Waiting for deployment to be ready” as a promotion/startup-probe problem, not a compilation problem. Confirm the exact production run command locally, then retry before changing application code when the current bundle binds and returns the configured health response.

**Why:** Replit can report a failed build after the VM is created without attaching application runtime logs. In that case the last successful build continues serving the production URL, and changing source code based only on the failed status risks introducing a real regression.

**How to apply:** Inspect the failed build tail, check the artifact `production.run` and startup path, validate a fresh production bundle on an unused local port, and use deployment status to confirm whether the failed attempt was promoted or the previous build remains active.
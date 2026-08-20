---
name: Build commit provenance
description: Why production health checks must receive commit metadata during bundling.
---

Production deployment artifacts do not contain the repository's `.git` directory, so runtime `git rev-parse HEAD` cannot reliably identify the deployed source. Inject the commit SHA during the bundle build and retain the runtime git lookup only as a development fallback. When publishing through the GitHub Git Data API, the created commit object can have a different SHA from the local commit, so build only after the remote branch has advanced and verify the injected SHA against `origin/main`.

**Why:** A successful deployment can otherwise report `(unknown)`, making it impossible to prove which source revision is live.

**How to apply:** Any bundled service exposing build identity should define its commit metadata during the build step, then verify the emitted artifact contains that value and fail the production build if the SHA is not the remote branch tip.
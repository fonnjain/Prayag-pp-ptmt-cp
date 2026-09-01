---
name: Build commit provenance
description: Why production health checks must receive commit metadata during bundling.
---

Production deployment artifacts do not contain the repository's `.git` directory, so runtime `git rev-parse HEAD` cannot reliably identify the deployed source. Inject the commit SHA during the bundle build and retain the runtime git lookup only as a development fallback. When publishing through the GitHub Git Data API, or when Replit creates a publish snapshot, the deployment commit can have a different SHA from the local commit, so production must query the pushed remote branch and verify that SHA against `origin/main` instead of trusting an injected publish-snapshot value. A local "Published your App" marker does not update GitHub by itself; verify the intended source is on `origin/main` before asking for another publish. Publish checkouts may be shallow and omit the remote commit object, so a successful `git ls-remote` equality check must be authoritative; only require `git cat-file` when the remote lookup is unavailable. Identical commit subjects do not establish identity: compare full SHAs, trees, and ancestry when local and remote histories appear to disagree. Publishing builds the committed Git tree, so an uncommitted source fix is not included in a publish attempt.

**Why:** A successful deployment can otherwise report `(unknown)`, making it impossible to prove which source revision is live.

**How to apply:** Any bundled service exposing build identity should define its commit metadata during the build step, query `git ls-remote origin refs/heads/main` in production, then verify the emitted artifact contains that value and fail the production build if it is not the remote branch tip. Do not require the publish checkout to contain the remote object locally when the remote tip itself was successfully verified. Commit and rebuild after source changes before asking the user to publish again.

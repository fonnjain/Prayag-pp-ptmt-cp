---
name: GitHub integration write throttle
description: GitHub REST reads work through the connected proxy, but repeated Git Data API writes can receive Cloudflare HTML 403 responses.
---

The connected GitHub integration may allow a few authenticated blob/tree writes and then return an HTML Cloudflare 403 even while `/rate_limit` and repository reads succeed.

**Why:** The failure is a proxy/WAF boundary, not necessarily an expired authorization or GitHub API quota problem; retrying or reauthorizing blindly can waste time.

**How to apply:** Keep the local commit intact, verify the remote ref before reporting success, and do not claim a push completed when the final ref update was not accepted. The GraphQL `createCommitOnBranch` fallback can publish file content as newly-created commits, but it cannot preserve exact local SHA ancestry when workspace and remote histories diverge; verify every requested SHA exists remotely and is an ancestor before calling that an exact push.

When exact commit identity matters, a connector snapshot is only a content synchronization fallback. It may produce a valid new `main` tip while the original local commits remain absent from GitHub, so republishing can be content-correct but provenance-incorrect.

**Why:** A workspace branch can have a complete local chain containing the requested MRP and startup commits while `origin/main` points at a different root. Recreating the tree through GraphQL does not recreate those commit objects or their parent graph.

**How to apply:** After any fallback snapshot, compare `GET /commits/{sha}` and an actual ancestor walk against the requested SHAs. If they are absent, report the provenance gap and use a real Git receive-pack push or an authorized repository-side history migration before relying on build identity.
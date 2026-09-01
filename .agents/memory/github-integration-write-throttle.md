---
name: GitHub integration write throttle
description: GitHub REST reads work through the connected proxy, but repeated Git Data API writes can receive Cloudflare HTML 403 responses.
---

The connected GitHub integration may allow a few authenticated blob/tree writes and then return an HTML Cloudflare 403 even while `/rate_limit` and repository reads succeed.

**Why:** The failure is a proxy/WAF boundary, not necessarily an expired authorization or GitHub API quota problem; retrying or reauthorizing blindly can waste time.

**How to apply:** Keep the local commit intact, verify the remote ref before reporting success, and do not claim a push completed when the final ref update was not accepted.
---
name: Regression verifier authentication
description: The regression CLI needs credentials for an existing admin account; bootstrap configuration and legacy auth rows may not match browser login.
---

The regression verifier must receive a valid admin email/password pair through its environment. Browser login authenticates the bcrypt-backed `users` table; legacy scrypt-backed `app_users` rows are not accepted by that route. The dedicated regression pair is synchronized into `users` only in the Replit workflow environment, so a missing row or a legacy hash cannot block the suite at login.

**Why:** The API and verifier can be healthy while the regression workflow stops at login, making the failure unrelated to the code under test. This workspace's validation workflow runs with `NODE_ENV=production`, so NODE_ENV is not a safe way to identify a published deployment.

**How to apply:** Keep the dedicated regression email/password opt-in synchronized as a bcrypt admin in `users` when `REPLIT_MODE=workflow`. Do not weaken route protection or silently switch the verifier to the legacy auth table; distinguish an auth 401 from the API's startup/readiness 503 and projection/cache 503 responses.
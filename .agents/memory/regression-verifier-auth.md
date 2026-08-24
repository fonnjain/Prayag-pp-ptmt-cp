---
name: Regression verifier authentication
description: The regression CLI needs credentials for an existing admin account; bootstrap configuration and legacy auth rows may not match browser login.
---

The regression verifier must receive a valid existing admin email/password pair through its environment. Browser login currently authenticates the bcrypt-backed `users` table; legacy scrypt-backed `app_users` rows are not accepted by that route. A bootstrap password is used during initial account provisioning and may not authenticate accounts that already exist, so a 401 can prevent the suite from reaching its checks.

**Why:** The API and verifier can be healthy while the regression workflow stops at login, making the failure unrelated to the code under test.

**How to apply:** Verify the supplied password against an account in the active browser-login table. Treat a remaining authentication failure as a test-environment/account-provisioning blocker; do not weaken route protection or silently switch the verifier to the legacy auth table.
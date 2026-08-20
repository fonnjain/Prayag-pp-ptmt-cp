---
name: Bundle freshness CI check
description: Regression suite section 0a asserts dist/index.cjs was built after the last git commit touching api-server/src.
---

## Rule
The verify script (`scripts/src/verify-plumbing-plan.ts`) runs a stale-bundle check as its first section ("Bundle freshness", section 0a) before any API calls. It:
1. Checks that `artifacts/api-server/dist/index.cjs` exists.
2. Gets the last git commit timestamp for `artifacts/api-server/src/` via `git log --format="%ct" -1 -- <srcDir>`.
3. Compares it to `statSync(bundlePath).mtimeMs`.
4. Fails (and sets `anyFail = true`) if the bundle mtime is older than the source commit.

**Why:** Three rounds of review were spent verifying numbers that were never live because the production bundle had not been rebuilt. The check surfaces this before any other assertion can pass.

**Deployed-commit gate:** `GET /api/healthz` now returns `dbHostname` (DB under test, not the runner's LOCAL DATABASE_URL) and `commitSha` (git HEAD at module load via `lib/buildInfo.ts`). The suite header prints both; proposed Task #97 will add a hard check comparing `healthz.commitSha` against the last local commit to `artifacts/api-server/src/` when `API_BASE.includes(".replit.app")`. Until that check exists, always verify `Deployed commit` in the header after publishing.

**Truncation origin:** The plan.ts and verify-plumbing-plan.ts file truncations that reached GitHub originated in commit `f0c3606` ("corrective export header/table total fix"), not the later `c47c5b0` or `aa56cfb` which only inherited the truncated state. A "typecheck the pushed commit" CI gate would have caught this at the commit that deleted the lines, not at a downstream inheritor. The fix was re-pushing the full working copies in commit `2f5ac4e` using `readFile` (1 MB budget) + utf-8 blob encoding rather than base64 shell output (which is capped at ~61 KB per file).

**How to apply:** After any commit to `artifacts/api-server/src/`, run `cd artifacts/api-server && node esbuild.build.mjs` before running the suite or triggering a deploy. The suite will fail fast on "Bundle freshness" if you forget.

**ESM note:** The script uses `tsx` (ESM). `__dirname` is not defined; use `fileURLToPath(import.meta.url)` instead. Imports at top of file: `child_process.execSync`, `fs.statSync`, `path.resolve`, `url.fileURLToPath`.

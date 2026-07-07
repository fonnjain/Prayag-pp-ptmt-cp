---
name: Prod API build command
description: The artifact.toml production build step for the API service must NOT use pnpm — it takes ~32s in production, causing all healthchecks to fail before the server starts.
---

## Rule

In `artifacts/production-planning/.replit-artifact/artifact.toml`, the API service's production build must use direct esbuild, not pnpm:

```toml
[services.production]
build = [ "sh", "-c", "cd artifacts/api-server && node esbuild.build.mjs" ]
run = "node artifacts/api-server/dist/index.js"
```

**Why:** In the production container, `pnpm --filter @workspace/api-server run build` takes ~32 seconds for pnpm startup overhead alone. During those 32 seconds, nothing listens on port 8080. Replit's deployment healthchecker probes `/api` and gets connection-refused, which it reports as 500. The app eventually recovers (esbuild itself is <1s) but the deployment is flagged as failing. Direct `node esbuild.build.mjs` completes in <1 second — the server binds before the first probe fires.

**How to apply:** Any time the API service's artifact.toml production config is regenerated or reset, restore this build command. The run command `node artifacts/api-server/dist/index.js` is correct and was already set.

---
name: api-server zod dependency
description: zod is not in the pnpm workspace catalog; must be added explicitly to api-server; logger is a named export.
---

# api-server runtime dependencies

## zod

`zod` is NOT listed in `pnpm-workspace.yaml`'s catalog. If you need `z.object(...)` in any api-server route or service, install it explicitly:

```
pnpm --filter @workspace/api-server add zod
```

Do not import it as a catalog dep — it will resolve to `undefined` at build time.

**Why:** The catalog only pins packages that are used as dev/build tools across the workspace. Runtime-only server deps (zod for route body validation) are not catalogued.

## logger

The logger export in `artifacts/api-server/src/lib/logger.ts` is a **named export**, not a default:

```ts
// CORRECT
import { logger } from "../lib/logger";

// WRONG — TS2613 "no default export"
import logger from "../lib/logger";
```

**Why:** The logger module exports a named `logger` singleton plus `pinoHttp`. Using a default import compiles away and crashes at runtime in generated ESM.

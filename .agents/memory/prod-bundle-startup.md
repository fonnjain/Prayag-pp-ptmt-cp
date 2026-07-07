---
name: Production API bundle & startup
description: Rules for keeping the api-server startup fast in production — CJS bundle, external package strategy, lazy loading
---

## Rule
The api-server MUST be built as a CJS bundle (`format: "cjs"`, output `dist/index.cjs`) with all npm packages bundled inline except `puppeteer`, `exceljs`, `pg-native`, and `*.node`. `NODE_ENV=production` must be set in artifact.toml services.env.

## Why
- `package.json` has `"type": "module"` — `node dist/index.js` treats the file as ESM where `require` is `undefined`. esbuild's `__require` shim throws `Dynamic require of "X" not supported` immediately on startup.
- The `.cjs` extension is always loaded as CommonJS regardless of `"type": "module"`.
- pnpm's virtual store (symlinks) requires 100+ disk `stat()` calls per package. Production disk is ~10x slower than local: each external package adds seconds. With pino + pino-http + thread-stream + exceljs all external, startup was 21s.
- Bundling pino/pino-http inline is safe **only** when `NODE_ENV=production` is set — this prevents the `pino({ transport: { target: "pino-pretty" } })` code path from running, which is the only code that spawns a `new Worker("lib/worker.js")` and would crash.
- `exceljs` cannot be bundled (its worker file path breaks) but must be lazy-loaded (`require("exceljs")` inside the function body, not top-level import) so it doesn't add to startup time.

## How to apply
- esbuild.build.mjs: `format: "cjs"`, `outfile: "dist/index.cjs"`, `external: ["puppeteer", "exceljs", "pg-native", "*.node"]`
- artifact.toml: run = `node artifacts/api-server/dist/index.cjs`, services.env includes `NODE_ENV = "production"`
- Any file that `import ExcelJS from "exceljs"` at module level: change to `import type ExcelJS from "exceljs"` + `const ExcelJS = require("exceljs") as typeof import("exceljs").default` inside the function
- `import.meta.url` / `fileURLToPath` usage: not available in CJS bundles; use `process.cwd()` candidates instead
- Test locally as: `NODE_ENV=production node artifacts/api-server/dist/index.cjs` — must show "api-server listening" within 2s
- DO NOT test with `import('./dist/index.cjs')` from a CJS script — that hides the `require` availability difference

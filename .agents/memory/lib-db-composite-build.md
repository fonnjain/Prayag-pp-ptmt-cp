---
name: lib/db composite build
description: lib/db uses TypeScript composite builds; stale dist/ declarations cause "property does not exist" errors in the api-server even when the source schema is correct. Must rebuild after any schema change.
---

## Rule
After any change to `lib/db/src/schema/*.ts`, run `cd lib/db && npx tsc -p tsconfig.json` to regenerate the `dist/schema/*.d.ts` declarations. The `api-server` TypeScript compilation reads these compiled declarations (not the source), because `lib/db` is a composite project. The stale `.d.ts` files will not reflect schema additions, causing errors like `'pinned' does not exist on type`.

**Why:** `lib/db/tsconfig.json` sets `"composite": true, "emitDeclarationOnly": true`. TypeScript project references prefer pre-built `.d.ts` from `dist/` over re-reading source. Task agents that edit schema files but forget to rebuild declarations leave a broken state that only manifests when the api-server TypeScript check runs.

**How to apply:**
- When `tsc --noEmit` on the api-server reports a schema column as missing even though `lib/db/src/schema/` has the column, the lib/db declarations are stale — run `cd lib/db && npx tsc -p tsconfig.json`.
- The `lib/db/dist/` folder is gitignored, so task agents can't commit the rebuilt declarations — main agent must always rebuild after merging schema-touching task branches.
- After rebuilding, re-run `pnpm --filter @workspace/api-server exec tsc --noEmit` to confirm clean.
- Then rebuild the bundle: `pnpm --filter @workspace/api-server run build`.

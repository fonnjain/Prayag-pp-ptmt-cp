#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push
# Rebuild the API bundle so the bundle-freshness CI check passes on the next
# regression run. Must run after any commit that touches artifacts/api-server/src.
cd artifacts/api-server && node esbuild.build.mjs

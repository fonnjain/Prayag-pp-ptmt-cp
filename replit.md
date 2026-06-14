# Prayag Production Planning

A mobile-friendly production-planning web app for two divisions (PTMT and CP). It turns sales/orders/production/stock data into a buffer-based monthly production plan, with a user-driven buffer multiplier, a two-layer data sanity check, Excel export, and AI-written PDF reports.

## Run & Operate

- `pnpm --filter @workspace/production-planning run dev` — run the frontend (Vite)
- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm --filter @workspace/production-planning run typecheck` — typecheck the frontend
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + wouter + TanStack Query + Tailwind (artifacts/production-planning)
- API: Express 5 (artifacts/api-server) — not yet built; deferred
- DB: PostgreSQL + Drizzle ORM (lib/db) — not yet built; deferred
- API codegen: Orval (from OpenAPI spec)

## Build status

- **Frontend: built** with a clean mock-data layer (`src/lib/types.ts`, `src/lib/mock-data.ts`, `src/lib/data-provider.tsx`). All screens are interactive against in-memory mock data.
- **Backend: deferred** at the user's request. The real Google Sheets pull, deterministic engine, two-layer sanity check, Excel export, AI reports, legacy import, and auth/roles are not yet implemented. The data-provider hooks are the seam where real API calls will replace mock data.

## Where things live

- Frontend pages: `artifacts/production-planning/src/pages/` (dashboard, plan, data, reports, settings, legacy, login)
- Global chrome (sidebar, division/month/role selectors): `artifacts/production-planning/src/components/layout.tsx`
- Mock data seam: `artifacts/production-planning/src/lib/data-provider.tsx`
- Spec source of truth (for the deferred backend): `attached_assets/REPLIT_BUILD_1781425633468.md`, `attached_assets/PP_schema_1781425633468.sql`

## Architecture decisions

- The buffer multiplier is ALWAYS user input (single, MIN/MAX pair, or per-category overrides) — never a hard-coded literal. This is a hard product rule.
- The planning engine must be pure deterministic arithmetic (no AI in the data path); AI is used only for the data sanity check and report narrative.
- Frontend is built mock-first behind a data-provider so the backend can be added without reworking screens.

## Integrations

- Google Sheets connection added (read-only) but not yet authorized by the user (`proposeIntegration` not yet called). Needed for the data pull.
- Anthropic AI integration setup returned `awaiting_phone_verification` — the user must complete phone verification before AI sanity-check / reports will work.

## User preferences

- App must be fully mobile-friendly (phone-usable), including the dense data grids — hard requirement.
- API/backend can be built later; frontend-first is acceptable.

## Gotchas

- wouter catch-all: use a pathless `<Route component={...} />` for the fallback, NOT `<Route path="/:rest*" .../>`. The `/:rest*` pattern does not match the root path `/`, which renders a blank page with no console error.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

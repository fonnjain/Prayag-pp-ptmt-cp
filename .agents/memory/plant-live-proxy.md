---
name: Plant-live proxy & API-key enforcement
description: How the prayag-plant.com data-api proxy is scoped and which routes require managed API keys
---

- Upstream `prayag-plant.com/data-api/v1` historically uses `X-API-Key` = `PRAYAG_PLANT_API_KEY` and exposes `/health`, `/periods`, `/plants`, `/summary`, `/records`; summary/records accept `period`, `plant`, `segment`, `machine`.
- Our proxy mirrors these under `/api/plant-live/*`. `/records` (raw row-level data with provenance) REQUIRES a managed API key via `Authorization: Bearer` — the first and so far only route wired to `validateApiKey()` from the api-keys route. Plants/periods/summary stay open like the rest of the internal API.
- **Why:** code review flagged that an open `/records` proxy turns the upstream credential into a public data feed; aggregate endpoints were judged acceptable (pre-existing pattern, dashboards consume them).
- **How to apply:** any new proxy route returning raw upstream rows should reuse the `requireApiKey` middleware in plant-live.ts; upstream fetches use a 20s AbortSignal timeout.
- OpenAPI must document 503 (key unconfigured) and 401 (records) or the generated clients can't model them.
- As of 2026-08-19, the upstream redirects API-key requests to `/login`. The summary proxy must use manual redirects and surface `UPSTREAM_AUTH_REDIRECT` rather than follow HTML; the dashboard offers retryable recovery copy.
- **Why:** a followed sign-in redirect becomes a misleading 200 HTML response and previously left the live machine card looking empty/loading.
- **How to apply:** the upstream owner must restore a service-authenticated API route or provide a valid separate service credential before live metrics resume; never expose that credential to the browser.

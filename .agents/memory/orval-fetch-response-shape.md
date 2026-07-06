---
name: orval fetch-client response shape mismatch
description: Why generated react-query hook data types look wrapped in {data,status,headers} but must be cast, not accessed via .data
---

The workspace's orval config (`lib/api-spec/orval.config.ts`) generates the `api-client-react` hooks with `client: "react-query"`, `httpClient: "fetch"`, and a custom mutator (`customFetch`). Orval's fetch-client codegen assumes the mutator resolves to `{data, status, headers}` and types each hook's `data` field accordingly (e.g. `getFooResponse200 & { headers: Headers }`).

The actual `customFetch` in `lib/api-client-react/src/custom-fetch.ts` returns the raw parsed JSON body directly (not wrapped). So at runtime `data` genuinely has the shape of the OpenAPI schema (e.g. `dashboard.plant`, `dashboard.categories`), but TypeScript's generated types disagree and fail with `TS2339: Property 'x' does not exist on type '... & { headers: Headers }'`.

**Why:** This is a pre-existing repo-wide mismatch between orval's fetch-client assumptions and the custom mutator's actual behavior — not something introduced per-feature. Runtime behavior is correct; only the generated types are wrong.

**How to apply:** Do not try to access `.data` on hook results, and do not "fix" the mutator to wrap responses (that would break every other consumer). Instead, follow the established convention already used in `production-planning` (e.g. `summary.tsx`): destructure the hook's `data` under a different local name and cast it to the real schema type, e.g.:

```ts
const { data: dashboardRaw, isLoading } = useGetMonitoringDashboard({ month });
const dashboard = dashboardRaw as unknown as MonitoringDashboard;
```

Apply this cast pattern consistently to every page/component consuming a generated query hook whose response is a non-primitive schema object, and run `pnpm --filter @workspace/<artifact> run typecheck` afterward to confirm all `TS2339`/`TS2345` type errors introduced by the mismatch are gone.

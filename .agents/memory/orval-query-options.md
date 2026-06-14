---
name: orval query hook options typing
description: Why passing only { query: { enabled } } to generated react-query hooks fails typecheck, and the accepted workaround.
---

# Orval-generated query hooks require queryKey in the options type

The generated react-query hooks in `lib/api-client-react/src/generated/api.ts`
type their second argument's `query` field as a **full** `UseQueryOptions`,
where `queryKey` is required. Passing just `{ query: { enabled } }` fails
typecheck with TS2741 ("Property 'queryKey' is missing").

At runtime the hook injects its own `queryKey` (via `getGetXQueryOptions`), so
you must NOT actually supply one. The accepted workaround is a tiny local helper
that casts to `any`:

```ts
const enabledOpt = (on: boolean): any => ({ query: { enabled: on } });
```

**Why:** TanStack v5 made `queryKey` required in `UseQueryOptions` and this
orval config does not wrap the param in `Omit<..., 'queryKey'>`. Casting the
option (not the data) keeps `TData` inference correct since the return type does
not depend on the options argument.

**How to apply:** Use `enabledOpt(...)` (or an equivalent cast) anywhere you only
want to toggle `enabled`/gating on a generated query hook. Don't hand-build a
queryKey just to satisfy the type — the hook overrides it.

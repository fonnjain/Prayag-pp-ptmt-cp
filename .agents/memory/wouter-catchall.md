---
name: wouter catch-all route
description: How to write a fallback/catch-all route in wouter so it matches the root path
---

# wouter catch-all route

In wouter, write a fallback/catch-all route as a **pathless** `<Route component={Fallback} />` (or `<Route>...</Route>`), placed last inside a `<Switch>`.

**Do NOT use** `<Route path="/:rest*" component={...} />` as a catch-all.

**Why:** the `/:rest*` pattern does not match the root path `/`. The symptom is a blank page with **no console error and no runtime overlay** — the Switch finds no matching route and renders nothing, so the whole subtree (including any layout) is silently absent. This wasted a long debugging loop because typecheck passes and there is no error to grep for.

**How to apply:** any time a wouter `<Switch>` needs a "match everything else" branch (e.g. an auth gate wrapping protected routes, or a NotFound), use a pathless `<Route>`. If a protected-routes wrapper renders blank only at `/` but inner pages work when navigated to, suspect a `:rest*`-style outer catch-all.

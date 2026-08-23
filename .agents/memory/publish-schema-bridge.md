---
name: Publish schema bridge
description: Safe staging pattern for Replit Publish diffs that add discriminator columns and replace primary keys while production still has legacy tables.
---

## Rule

When Publish introspection plans a composite primary-key constraint before adding its new discriminator column, do not apply that diff. Temporarily make development match production's existing key shape while retaining the new columns, and keep any production-only legacy table present in development. Publish the additive columns first; let the already-checked-in app-start data migrations transfer legacy rows and replace keys in dependency order.

**Why:** Publish computes its own development-to-production schema diff rather than replaying checked-in SQL migrations. Its planner can emit an invalid constraint-before-column order, and dropping a legacy table can bypass the data-copy step entirely. `ON CONFLICT DO NOTHING` makes an unverified copy especially dangerous because a drop can succeed after inserting zero rows.

**How to apply:** Before staging, verify the development tables have no duplicate rows under the temporary old key. Confirm the generated diff contains only the additive discriminator columns, with no legacy-table drop or primary-key add. Record the legacy destination row count before the app-start migration, then verify it afterward and confirm that each database's `_migrations` table tracks the migration independently.
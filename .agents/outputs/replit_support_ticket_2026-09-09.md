# Replit deployment support ticket — 2026-09-09

## Summary

The published deployment remains healthy but continues to serve the previous
application build. The requested build for commit `b921cb3e74958181c7bc391a0e121a0e4c1831de`
did not produce any deployment build record.

## Deployment values

- Deployment URL: https://prayag-pp.com
- Deployment type: `vm`
- `isDeployed`: `true`
- `hasSuccessfulBuild`: `true`
- Commit currently served:
  `5fbbbc7917e6c3360ecba851128f344c1399e60b`
- Commit that will not publish:
  `b921cb3e74958181c7bc391a0e121a0e4c1831de`

## Publish attempts

Two publish attempts were confirmed through the workspace publishing flow.
The deployment service did not expose attempt-specific timestamps for either
attempt. Neither attempt produced a build record for `b921…`.

Deployment logs contain only these generic process-start events:

```text
[2026-09-09T07:18:10.532Z INFO] starting artifact processes for monorepo deployment
[2026-09-09T07:18:10.635Z INFO] starting artifact processes count=1
```

There is no build entry for `b921…`: no timestamp, no success, no failure, and
no build error to investigate.

## Migration and health evidence

The production database applied these three migrations:

```text
060_unmapped_plan_provenance.sql — 2026-09-09T07:18:35.712Z
061_corrective_supersession.sql — 2026-09-09T07:18:35.804Z
062_plan_run_supersessions.sql — 2026-09-09T07:18:35.877Z
```

The migration step ran and applied three migrations at 07:18:35, while the
application build did not advance. Something in the deploy path executed; the
build did not.

After waiting 180 seconds, production health returned exactly:

```json
{"status":"ok","dbHostname":"ep-orange-tree-aj9n6w8a.c-3.us-east-2.aws.neon.tech","commitSha":"5fbbbc7917e6c3360ecba851128f344c1399e60b"}
```

The project intentionally uses an external Neon database. `DATABASE_URL` must
not be removed. No `External database detected — Remove `DATABASE_URL` banner
appeared during this occurrence.

The running `5fbb…` build does not reference the table or columns added by
migrations 060–062.

No prior `replit_support_ticket.md` file exists in the workspace.

## Requested investigation

Please investigate why the migration step executes successfully while no
application build is dispatched for the requested commit, and why the healthy
deployment continues serving the prior commit.

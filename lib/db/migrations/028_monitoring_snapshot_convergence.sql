-- Converge the legacy PTMT-only monitoring freeze table into the existing
-- segment-keyed, provenance-rich month snapshot table. Keep the transfer
-- idempotent so deployments can be retried safely.
INSERT INTO plant_month_snapshots (
  month,
  segment,
  payload_json,
  source_plan_versions_json,
  closed_at,
  captured_at,
  captured_commit_sha,
  backfilled,
  plan_status,
  plan_status_reason,
  plan_evidence_json
)
SELECT
  legacy.month,
  'PTMT',
  jsonb_build_object(
    'kind', 'plant_monitoring',
    'actualsJson', legacy.actuals_json,
    'targetsJson', legacy.targets_json,
    'bundleJson', legacy.bundle_json,
    'weeklyJson', legacy.weekly_json,
    'sourceInfoJson', legacy.source_info_json
  ),
  COALESCE(legacy.source_info_json -> 'planVersionTimeline', '[]'::jsonb),
  legacy.captured_at,
  legacy.captured_at,
  NULL,
  TRUE,
  'monitoring',
  'Migrated from plant_monitoring_snapshots',
  legacy.source_info_json
FROM plant_monitoring_snapshots AS legacy
ON CONFLICT (month, segment) DO NOTHING;

DROP TABLE IF EXISTS plant_monitoring_snapshots;
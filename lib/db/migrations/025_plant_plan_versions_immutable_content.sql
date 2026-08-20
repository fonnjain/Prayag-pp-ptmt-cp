-- Issued plan-version targets are historical evidence for frozen monitoring
-- reports. Content must be append-only: a corrected schedule can adjust its
-- effective date/label before it is frozen, but it cannot rewrite the original
-- item-level W1–W4 allocation. If a source row is removed, restoration fails
-- closed (explicitly unavailable) rather than substituting another source.
CREATE OR REPLACE FUNCTION prevent_plant_plan_version_content_rewrite()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.month IS DISTINCT FROM OLD.month
    OR NEW.segment IS DISTINCT FROM OLD.segment
    OR NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.source_id IS DISTINCT FROM OLD.source_id
    OR NEW.targets_json IS DISTINCT FROM OLD.targets_json
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'issued plant plan version content is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS plant_plan_versions_content_immutable ON plant_plan_versions;
CREATE TRIGGER plant_plan_versions_content_immutable
BEFORE UPDATE ON plant_plan_versions
FOR EACH ROW
EXECUTE FUNCTION prevent_plant_plan_version_content_rewrite();
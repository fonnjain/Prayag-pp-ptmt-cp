-- Protect specific corrective runs from accidental deletion (e.g. regression-suite golden runs).
-- A pinned run is rejected by DELETE /api/corrective/runs/:id with a 409 response.
-- Ops can pin/unpin via PATCH /api/corrective/runs/:id/pin.
ALTER TABLE corrective_plan_runs
  ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE;

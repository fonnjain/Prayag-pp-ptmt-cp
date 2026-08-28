ALTER TABLE plan_schedule_results
  ADD COLUMN IF NOT EXISTS downtime_hours_lost REAL NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS downtime_machine_days REAL NOT NULL DEFAULT 0;
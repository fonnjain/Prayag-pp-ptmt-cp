-- Add machine_hrs to plant_plan_items
-- Stores the Machine Hrs value from the consolidated plan "5. Item Assignment" sheet.
-- Legacy FORMAT A uploads will have machine_hrs = 0 (default).
ALTER TABLE plant_plan_items ADD COLUMN IF NOT EXISTS machine_hrs REAL NOT NULL DEFAULT 0;

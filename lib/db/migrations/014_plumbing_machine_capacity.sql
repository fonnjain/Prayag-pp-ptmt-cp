CREATE TABLE IF NOT EXISTS plumbing_machine_capacity (
  id          SERIAL PRIMARY KEY,
  segment     TEXT    NOT NULL DEFAULT 'Plumbing',
  pool        TEXT    NOT NULL,
  machine_id  TEXT    NOT NULL,
  label       TEXT,
  shifts_per_day   REAL    NOT NULL DEFAULT 2,
  hours_per_shift  REAL    NOT NULL DEFAULT 10,
  working_days     INTEGER NOT NULL DEFAULT 25,
  rates            JSONB   NOT NULL DEFAULT '{}',
  locked_out       BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (segment, machine_id)
);

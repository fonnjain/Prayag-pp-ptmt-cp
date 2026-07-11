CREATE TABLE IF NOT EXISTS weekly_release_bands (
  id SERIAL PRIMARY KEY,
  category_name TEXT NOT NULL UNIQUE,
  w1_upper REAL NOT NULL,
  w2_upper REAL NOT NULL,
  w3_upper REAL NOT NULL,
  w4_upper REAL NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

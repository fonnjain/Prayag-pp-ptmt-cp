CREATE TABLE IF NOT EXISTS "seasonality_runs" (
  "id" serial PRIMARY KEY NOT NULL,
  "month" text NOT NULL,
  "segment" text NOT NULL,
  "engine_kind" text NOT NULL,
  "status" text NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "details" jsonb DEFAULT '{}'::jsonb NOT NULL,
  CONSTRAINT "seasonality_runs_month_segment_engine_unique" UNIQUE("month","segment","engine_kind")
);
import assert from "node:assert/strict";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

const SEGMENT_SCOPED_TABLES = [
  "plant_configs",
  "plant_ingestion_cache",
  "plant_source_configs",
  "monitoring_config",
] as const;

test("segment-scoped operational tables keep composite month/segment primary keys", async () => {
  const result = await db.execute(sql`
    SELECT
      c.relname AS table_name,
      json_agg(att.attname ORDER BY key_columns.ordinality) AS key_columns
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS key_columns(attnum, ordinality) ON true
    JOIN pg_attribute att ON att.attrelid = c.oid AND att.attnum = key_columns.attnum
    WHERE n.nspname = 'public'
      AND c.relname IN ('plant_configs', 'plant_ingestion_cache', 'plant_source_configs', 'monitoring_config')
      AND con.contype = 'p'
    GROUP BY c.relname
    ORDER BY c.relname
  `);

  const primaryKeys = new Map(
    result.rows.map((row) => [
      String(row.table_name),
      (typeof row.key_columns === "string"
        ? JSON.parse(row.key_columns)
        : row.key_columns) as string[],
    ]),
  );

  for (const tableName of SEGMENT_SCOPED_TABLES) {
    assert.deepEqual(
      primaryKeys.get(tableName),
      ["month", "segment"],
      `${tableName} must retain PRIMARY KEY (month, segment)`,
    );
  }
});

test("retired month-only monitoring snapshot table is absent", async () => {
  const result = await db.execute(sql`
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'plant_monitoring_snapshots'
  `);

  assert.equal(
    result.rowCount,
    0,
    "plant_monitoring_snapshots must not be recreated in development",
  );
});
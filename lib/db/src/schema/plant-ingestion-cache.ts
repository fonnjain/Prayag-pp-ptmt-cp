import { pgTable, text, jsonb, timestamp, primaryKey } from "drizzle-orm/pg-core";

export const plantIngestionCacheTable = pgTable("plant_ingestion_cache", {
  month: text("month").notNull(),
  segment: text("segment").notNull().default("PTMT"),
  snapshotDate: text("snapshot_date").notNull().default(""),
  rawActualsJson: jsonb("raw_actuals_json").notNull().default([]),
  cachedAt: timestamp("cached_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.month, table.segment] })]);

export type PlantIngestionCache = typeof plantIngestionCacheTable.$inferSelect;

import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

export const plantIngestionCacheTable = pgTable("plant_ingestion_cache", {
  month: text("month").primaryKey(),
  snapshotDate: text("snapshot_date").notNull().default(""),
  rawActualsJson: jsonb("raw_actuals_json").notNull().default([]),
  cachedAt: timestamp("cached_at", { withTimezone: true }).defaultNow().notNull(),
});

export type PlantIngestionCache = typeof plantIngestionCacheTable.$inferSelect;

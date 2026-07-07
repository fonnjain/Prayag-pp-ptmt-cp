import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const plantSourceConfigsTable = pgTable("plant_source_configs", {
  month: text("month").primaryKey(),
  fileId: text("file_id").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type PlantSourceConfig = typeof plantSourceConfigsTable.$inferSelect;

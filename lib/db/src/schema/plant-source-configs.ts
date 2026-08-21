import { pgTable, text, timestamp, primaryKey } from "drizzle-orm/pg-core";

export const plantSourceConfigsTable = pgTable("plant_source_configs", {
  month: text("month").notNull(),
  segment: text("segment").notNull().default("PTMT"),
  fileId: text("file_id").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.month, table.segment] })]);

export type PlantSourceConfig = typeof plantSourceConfigsTable.$inferSelect;

import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const syncSourcesTable = pgTable("sync_sources", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull().default("idle"),
  message: text("message"),
  rows: jsonb("rows").$type<Record<string, unknown>[]>(),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
});

export const insertSyncSourceSchema = createInsertSchema(syncSourcesTable);
export type InsertSyncSource = z.infer<typeof insertSyncSourceSchema>;
export type SyncSource = typeof syncSourcesTable.$inferSelect;

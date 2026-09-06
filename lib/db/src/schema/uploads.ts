import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const uploadedFilesTable = pgTable("uploaded_files", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  filename: text("filename").notNull(),
  period: text("period"),
  rowCount: integer("row_count").notNull().default(0),
  rows: jsonb("rows").notNull().$type<Record<string, unknown>[]>(),
  sourceMetadata: jsonb("source_metadata").$type<Record<string, unknown> | null>(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUploadedFileSchema = createInsertSchema(uploadedFilesTable).omit({
  id: true,
  uploadedAt: true,
});
export type InsertUploadedFile = z.infer<typeof insertUploadedFileSchema>;
export type UploadedFile = typeof uploadedFilesTable.$inferSelect;

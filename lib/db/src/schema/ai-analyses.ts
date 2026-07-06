import { pgTable, serial, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const aiAnalysesTable = pgTable("ai_analyses", {
  id: serial("id").primaryKey(),
  month: text("month").notNull(),
  snapshotDate: text("snapshot_date"),
  depth: text("depth").notNull().default("standard"),
  model: text("model").notNull(),
  packetHash: text("packet_hash").notNull(),
  packetJson: jsonb("packet_json").notNull(),
  resultJson: jsonb("result_json"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAiAnalysisSchema = createInsertSchema(aiAnalysesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAiAnalysis = z.infer<typeof insertAiAnalysisSchema>;
export type AiAnalysis = typeof aiAnalysesTable.$inferSelect;

export const aiAnalysisMessagesTable = pgTable("ai_analysis_messages", {
  id: serial("id").primaryKey(),
  analysisId: integer("analysis_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAiAnalysisMessageSchema = createInsertSchema(aiAnalysisMessagesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAiAnalysisMessage = z.infer<typeof insertAiAnalysisMessageSchema>;
export type AiAnalysisMessage = typeof aiAnalysisMessagesTable.$inferSelect;

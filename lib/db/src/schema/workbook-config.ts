import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const workbookConfigTable = pgTable("workbook_config", {
  id: text("id").primaryKey(),
  division: text("division").notNull(),
  month: text("month").notNull(),
  workbookId: text("workbook_id").notNull(),
  label: text("label").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type WorkbookConfig = typeof workbookConfigTable.$inferSelect;
export type InsertWorkbookConfig = typeof workbookConfigTable.$inferInsert;

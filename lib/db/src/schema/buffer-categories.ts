import { pgTable, serial, text, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const bufferCategoriesTable = pgTable("buffer_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  multiplier: real("multiplier").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertBufferCategorySchema = createInsertSchema(bufferCategoriesTable).omit({
  id: true,
  updatedAt: true,
});
export type InsertBufferCategory = z.infer<typeof insertBufferCategorySchema>;
export type BufferCategory = typeof bufferCategoriesTable.$inferSelect;

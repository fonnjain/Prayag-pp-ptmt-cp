import { pgTable, serial, text, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const itemMasterTable = pgTable(
  "item_master",
  {
    id: serial("id").primaryKey(),
    segment: text("segment").notNull().default("PTMT"),
    category: text("category").notNull(),
    itemCode: text("item_code").notNull(),
    colour: text("colour").notNull(),
    classificationStatus: text("classification_status").notNull().default("classified"),
    classificationSource: text("classification_source"),
    classificationNote: text("classification_note"),
  },
  (table) => [unique().on(table.itemCode, table.colour, table.category)],
);

export const insertItemMasterSchema = createInsertSchema(itemMasterTable).omit({
  id: true,
});
export type InsertItemMaster = z.infer<typeof insertItemMasterSchema>;
export type ItemMaster = typeof itemMasterTable.$inferSelect;

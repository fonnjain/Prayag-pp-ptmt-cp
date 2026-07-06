import { pgTable, serial, text, numeric, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const itemWeightsTable = pgTable(
  "item_weights",
  {
    id: serial("id").primaryKey(),
    itemCode: text("item_code").notNull(),
    colour: text("colour").notNull().default(""),
    weightKg: numeric("weight_kg", { precision: 12, scale: 4 }),
  },
  (table) => [unique().on(table.itemCode, table.colour)],
);

export const insertItemWeightSchema = createInsertSchema(itemWeightsTable).omit({
  id: true,
});
export type InsertItemWeight = z.infer<typeof insertItemWeightSchema>;
export type ItemWeight = typeof itemWeightsTable.$inferSelect;

import { pgTable, serial, text, numeric, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const idealHoursOverridesTable = pgTable(
  "ideal_hours_overrides",
  {
    id: serial("id").primaryKey(),
    machineId: text("machine_id").notNull(),
    month: text("month").notNull(),
    hours: numeric("hours", { precision: 12, scale: 2 }).notNull(),
  },
  (table) => [unique().on(table.machineId, table.month)],
);

export const insertIdealHoursOverrideSchema = createInsertSchema(idealHoursOverridesTable).omit({
  id: true,
});
export type InsertIdealHoursOverride = z.infer<typeof insertIdealHoursOverrideSchema>;
export type IdealHoursOverride = typeof idealHoursOverridesTable.$inferSelect;

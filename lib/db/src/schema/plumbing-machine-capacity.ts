import { pgTable, serial, text, real, integer, boolean, jsonb, unique } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

export const plumbingMachineCapacityTable = pgTable(
  "plumbing_machine_capacity",
  {
    id:             serial("id").primaryKey(),
    segment:        text("segment").notNull().default("Plumbing"),
    pool:           text("pool").notNull(),
    machineId:      text("machine_id").notNull(),
    label:          text("label"),
    shiftsPerDay:   real("shifts_per_day").notNull().default(2),
    hoursPerShift:  real("hours_per_shift").notNull().default(10),
    workingDays:    integer("working_days").notNull().default(25),
    rates:          jsonb("rates").$type<Record<string, number>>().notNull().default({}),
    lockedOut:      boolean("locked_out").notNull().default(false),
  },
  (t) => ({
    segMachineUniq: unique("pmcap_seg_machine_uniq").on(t.segment, t.machineId),
  }),
);

export const insertPlumbingMachineCapacitySchema = createInsertSchema(plumbingMachineCapacityTable).omit({ id: true });
export const selectPlumbingMachineCapacitySchema = createSelectSchema(plumbingMachineCapacityTable);

export type PlumbingMachineCapacity = typeof plumbingMachineCapacityTable.$inferSelect;
export type InsertPlumbingMachineCapacity = typeof plumbingMachineCapacityTable.$inferInsert;

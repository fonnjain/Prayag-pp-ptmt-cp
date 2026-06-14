import {
  pgTable,
  bigserial,
  text,
  numeric,
  date,
  unique,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const production = pgTable(
  "production",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    prodDate: date("prod_date").notNull(),
    itemCode: text("item_code").notNull(),
    colour: text("colour").default(""),
    qty: numeric("qty"),
    subGroup: text("sub_group"),
    grp: text("grp"),
    month: text("month"),
    division: text("division").notNull(),
  },
  (t) => [
    unique("production_uq").on(t.prodDate, t.itemCode, t.colour, t.division),
    index("ix_prod_lookup").on(t.division, t.itemCode, t.colour, t.prodDate),
    check("production_division_chk", sql`${t.division} in ('PTMT','CP')`),
  ],
);

export type Production = typeof production.$inferSelect;
export type InsertProduction = typeof production.$inferInsert;

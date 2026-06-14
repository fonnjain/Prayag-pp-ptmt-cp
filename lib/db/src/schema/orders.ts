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

export const orders = pgTable(
  "orders",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    docNo: text("doc_no"),
    orderDate: date("order_date"),
    customer: text("customer"),
    location: text("location"),
    itemCode: text("item_code").notNull(),
    itemName: text("item_name"),
    colour: text("colour").default(""),
    unit: text("unit"),
    qty: numeric("qty"),
    rate: numeric("rate"),
    taxableValue: numeric("taxable_value"),
    month: text("month"),
    division: text("division").notNull(),
  },
  (t) => [
    unique("orders_uq").on(t.docNo, t.itemCode, t.colour, t.division),
    index("ix_orders_lookup").on(t.division, t.itemCode, t.colour, t.month),
    check("orders_division_chk", sql`${t.division} in ('PTMT','CP')`),
  ],
);

export type Order = typeof orders.$inferSelect;
export type InsertOrder = typeof orders.$inferInsert;

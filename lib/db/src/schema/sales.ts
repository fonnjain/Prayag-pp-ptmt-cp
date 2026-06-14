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

export const sales = pgTable(
  "sales",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    invoiceNo: text("invoice_no"),
    saleDate: date("sale_date"),
    itemCode: text("item_code").notNull(),
    colour: text("colour").default(""),
    qty: numeric("qty"),
    rate: numeric("rate"),
    amount: numeric("amount"),
    customer: text("customer"),
    grp: text("grp"),
    station: text("station"),
    state: text("state"),
    month: text("month"),
    division: text("division").notNull(),
  },
  (t) => [
    unique("sales_uq").on(t.invoiceNo, t.itemCode, t.colour, t.division),
    index("ix_sales_lookup").on(t.division, t.itemCode, t.colour, t.saleDate),
    check("sales_division_chk", sql`${t.division} in ('PTMT','CP')`),
  ],
);

export type Sale = typeof sales.$inferSelect;
export type InsertSale = typeof sales.$inferInsert;

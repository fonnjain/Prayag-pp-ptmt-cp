import {
  pgTable,
  bigserial,
  text,
  numeric,
  date,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const stockOpening = pgTable(
  "stock_opening",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    itemCode: text("item_code").notNull(),
    colour: text("colour").default(""),
    qty: numeric("qty"),
    center: text("center"),
    asOn: date("as_on").notNull(),
    division: text("division").notNull(),
  },
  (t) => [
    unique("stock_opening_uq").on(t.itemCode, t.colour, t.asOn, t.division),
    check("stock_division_chk", sql`${t.division} in ('PTMT','CP')`),
  ],
);

export type StockOpening = typeof stockOpening.$inferSelect;
export type InsertStockOpening = typeof stockOpening.$inferInsert;

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

export const pendingOrders = pgTable(
  "pending_orders",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    itemCode: text("item_code").notNull(),
    colour: text("colour").default(""),
    qty: numeric("qty"),
    amount: numeric("amount"),
    period: text("period").notNull(),
    planMonth: date("plan_month").notNull(),
    division: text("division").notNull(),
  },
  (t) => [
    unique("pending_orders_uq").on(
      t.itemCode,
      t.colour,
      t.period,
      t.planMonth,
      t.division,
    ),
    check("pending_period_chk", sql`${t.period} in ('current','last_month')`),
    check("pending_division_chk", sql`${t.division} in ('PTMT','CP')`),
  ],
);

export type PendingOrder = typeof pendingOrders.$inferSelect;
export type InsertPendingOrder = typeof pendingOrders.$inferInsert;

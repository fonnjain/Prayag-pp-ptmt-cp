import {
  pgTable,
  bigserial,
  text,
  numeric,
  boolean,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const items = pgTable(
  "items",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    itemCode: text("item_code").notNull(),
    division: text("division").notNull(),
    name: text("name"),
    model: text("model"),
    grp: text("grp"),
    type: text("type"),
    category: text("category"),
    unit: text("unit"),
    altUnit: text("alt_unit"),
    materialCenter: text("material_center"),
    mrp: numeric("mrp"),
    saleRate: numeric("sale_rate"),
    hsn: text("hsn"),
    gst: text("gst"),
    active: boolean("active").default(true),
  },
  (t) => [
    unique("items_code_division_uq").on(t.itemCode, t.division),
    check("items_division_chk", sql`${t.division} in ('PTMT','CP')`),
  ],
);

export type Item = typeof items.$inferSelect;
export type InsertItem = typeof items.$inferInsert;

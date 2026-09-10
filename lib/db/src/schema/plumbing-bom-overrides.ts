import { pgTable, serial, text, numeric, timestamp, unique } from "drizzle-orm/pg-core";

export const plumbingBomOverridesTable = pgTable(
  "plumbing_bom_overrides",
  {
    id: serial("id").primaryKey(),
    itemCode: text("item_code").notNull(),
    kgPerPiece: numeric("weight_kg_per_piece", { precision: 12, scale: 6 }).notNull(),
    category: text("category").notNull(),
    piecesRecovered: numeric("pieces_recovered", { precision: 14, scale: 2 }).notNull().default("0"),
    source: text("source").notNull(),
    sourceLastModified: text("source_last_modified").notNull(),
    seededOn: text("seeded_on").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.itemCode)],
);

export type PlumbingBomOverride = typeof plumbingBomOverridesTable.$inferSelect;
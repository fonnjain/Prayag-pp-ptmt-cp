import { pgTable, serial, text, integer, timestamp, jsonb, boolean, unique, index } from "drizzle-orm/pg-core";

export const mrpControlSourcesTable = pgTable(
  "mrp_control_sources",
  {
    id: serial("id").primaryKey(),
    sourceFilename: text("source_filename").notNull(),
    sourceSha256: text("source_sha256").notNull(),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
    productRowCount: integer("product_row_count").notNull().default(0),
    discontinuedRowCount: integer("discontinued_row_count").notNull().default(0),
    excludedRowCount: integer("excluded_row_count").notNull().default(0),
    seriesValueCount: integer("series_value_count").notNull().default(0),
    planningApproved: boolean("planning_approved").notNull().default(false),
    holdReason: text("hold_reason"),
    validationStatus: text("validation_status").notNull().default("valid"),
  },
  (table) => [unique().on(table.sourceSha256)],
);

export const mrpControlRowsTable = pgTable(
  "mrp_control_rows",
  {
    id: serial("id").primaryKey(),
    sourceId: integer("source_id").notNull(),
    rowType: text("row_type").notNull(),
    sourceRow: integer("source_row").notNull(),
    itemCode: text("item_code").notNull(),
    division: text("division").notNull().default(""),
    series: text("series").notNull().default(""),
    productName: text("product_name"),
    size: text("size"),
    mrp: text("mrp"),
    effectiveDate: text("effective_date"),
    previousMrp: text("previous_mrp"),
    colourPrices: jsonb("colour_prices").$type<Record<string, number | null>>().notNull().default({}),
    discontinued: boolean("discontinued").notNull().default(false),
    discontinuedFrom: text("discontinued_from"),
    segment: text("segment"),
    planningCategory: text("planning_category"),
    classificationStatus: text("classification_status").notNull().default("hold"),
    isLoadable: boolean("is_loadable").notNull().default(true),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    unique().on(table.sourceId, table.rowType, table.sourceRow),
    index("mrp_control_rows_source_item_idx").on(table.sourceId, table.itemCode),
    index("mrp_control_rows_source_segment_idx").on(table.sourceId, table.segment),
  ],
);

export const mrpSeriesValuesTable = pgTable(
  "mrp_series_values",
  {
    id: serial("id").primaryKey(),
    sourceId: integer("source_id").notNull(),
    series: text("series").notNull(),
    codeCount: integer("code_count").notNull().default(0),
    sampleCodes: text("sample_codes"),
  },
  (table) => [unique().on(table.sourceId, table.series)],
);

export type MrpControlSource = typeof mrpControlSourcesTable.$inferSelect;
export type MrpControlRow = typeof mrpControlRowsTable.$inferSelect;
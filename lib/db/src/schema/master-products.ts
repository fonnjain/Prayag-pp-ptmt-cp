import { pgTable, serial, text, boolean, timestamp, index, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * A source-controlled catalogue copy. This is deliberately separate from
 * item_master: catalogue coverage can be reviewed before it becomes a plan
 * roster.
 */
export const masterProductsTable = pgTable(
  "master_products",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull().default("competition-analysis"),
    sourceProductId: text("source_product_id"),
    itemCode: text("item_code").notNull(),
    productName: text("product_name"),
    division: text("division").notNull(),
    segment: text("segment"),
    category: text("category"),
    planningCategory: text("planning_category"),
    uom: text("uom"),
    isActive: boolean("is_active").notNull().default(true),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.source, table.itemCode),
    index("master_products_division_idx").on(table.division),
    index("master_products_segment_idx").on(table.segment),
    index("master_products_active_idx").on(table.isActive),
  ],
);

/**
 * Reviewed many-to-one category mappings. Empty by design until the category
 * vocabulary has been reviewed by the catalogue owner.
 */
export const masterProductCategoryMappingsTable = pgTable(
  "master_product_category_mappings",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull().default("competition-analysis"),
    division: text("division").notNull(),
    rawCategory: text("raw_category").notNull().default(""),
    segment: text("segment").notNull(),
    planningCategory: text("planning_category").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.source, table.division, table.rawCategory),
    index("master_product_category_mappings_division_idx").on(table.division),
  ],
);

export const productClassificationAuditTable = pgTable(
  "product_classification_audit",
  {
    id: serial("id").primaryKey(),
    segment: text("segment").notNull(),
    itemCode: text("item_code").notNull(),
    colour: text("colour").notNull().default(""),
    previousCategory: text("previous_category"),
    previousStatus: text("previous_status"),
    newCategory: text("new_category").notNull(),
    newStatus: text("new_status").notNull(),
    reason: text("reason").notNull(),
    changedBy: text("changed_by").notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("product_classification_audit_product_idx").on(table.segment, table.itemCode, table.colour),
    index("product_classification_audit_changed_at_idx").on(table.changedAt),
  ],
);

export const insertMasterProductSchema = createInsertSchema(masterProductsTable).omit({ id: true });
export const insertMasterProductCategoryMappingSchema = createInsertSchema(
  masterProductCategoryMappingsTable,
).omit({ id: true, updatedAt: true });

export type MasterProduct = typeof masterProductsTable.$inferSelect;
export type InsertMasterProduct = z.infer<typeof insertMasterProductSchema>;
export type MasterProductCategoryMapping = typeof masterProductCategoryMappingsTable.$inferSelect;
export type InsertMasterProductCategoryMapping = z.infer<
  typeof insertMasterProductCategoryMappingSchema
>;
export type ProductClassificationAudit = typeof productClassificationAuditTable.$inferSelect;
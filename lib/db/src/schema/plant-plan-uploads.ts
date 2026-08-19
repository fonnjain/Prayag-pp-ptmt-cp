import { pgTable, serial, text, integer, real, jsonb, timestamp } from "drizzle-orm/pg-core";

export const plantPlanUploadsTable = pgTable("plant_plan_uploads", {
  id:          serial("id").primaryKey(),
  month:       text("month").notNull(),
  segment:     text("segment").notNull().default("Plumbing"),
  effectiveFrom: text("effective_from"),
  filename:    text("filename").notNull(),
  itemCount:   integer("item_count").notNull().default(0),
  summaryJson: jsonb("summary_json"),
  uploadedAt:  timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const plantPlanItemsTable = pgTable("plant_plan_items", {
  id:           serial("id").primaryKey(),
  uploadId:     integer("upload_id").notNull().references(() => plantPlanUploadsTable.id, { onDelete: "cascade" }),
  itemType:     text("item_type").notNull(),
  itemCode:     text("item_code").notNull(),
  material:     text("material").notNull(),
  requestedPcs: real("requested_pcs").notNull().default(0),
  feasiblePcs:  real("feasible_pcs").notNull().default(0),
  shortfallPcs: real("shortfall_pcs").notNull().default(0),
  requestedKg:  real("requested_kg").notNull().default(0),
  feasibleKg:   real("feasible_kg").notNull().default(0),
  shortfallKg:  real("shortfall_kg").notNull().default(0),
  machines:     text("machines"),
  machineHrs:   real("machine_hrs").notNull().default(0),
  note:         text("note"),
});

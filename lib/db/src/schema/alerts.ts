import {
  pgTable,
  serial,
  text,
  real,
  integer,
  timestamp,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const alertThresholdsTable = pgTable(
  "alert_thresholds",
  {
    code: text("code").notNull(),
    segment: text("segment").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    value: real("value").notNull(),
    defaultValue: real("default_value").notNull(),
    unit: text("unit").notNull(),
    scope: text("scope").notNull().default("segment"),
    observedMin: real("observed_min"),
    observedMax: real("observed_max"),
    wouldFireCount: integer("would_fire_count").notNull().default(0),
    updatedBy: text("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.code, table.segment] }),
  ],
);

export const alertRecordsTable = pgTable(
  "alert_records",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull(),
    segment: text("segment").notNull(),
    month: text("month").notNull(),
    severity: text("severity").notNull(),
    state: text("state").notNull(),
    title: text("title").notNull(),
    action: text("action").notNull(),
    message: text("message").notNull(),
    value: real("value"),
    threshold: real("threshold"),
    difference: real("difference"),
    quantity: real("quantity").notNull().default(0),
    details: jsonb("details").notNull().$type<Record<string, unknown>>().default({}),
    sourceLinks: jsonb("source_links").notNull().$type<Array<{ label: string; href: string }>>().default([]),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true }).notNull().defaultNow(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgedBy: text("acknowledged_by"),
    mutedUntil: timestamp("muted_until", { withTimezone: true }),
    muteReason: text("mute_reason"),
    suppressedReason: text("suppressed_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("alert_records_identity_idx").on(table.code, table.segment, table.month),
    index("alert_records_segment_month_idx").on(table.segment, table.month),
  ],
);

export const alertEventsTable = pgTable(
  "alert_events",
  {
    id: serial("id").primaryKey(),
    alertId: integer("alert_id").notNull().references(() => alertRecordsTable.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    segment: text("segment").notNull(),
    month: text("month").notNull(),
    state: text("state").notNull(),
    value: real("value"),
    threshold: real("threshold"),
    difference: real("difference"),
    quantity: real("quantity").notNull().default(0),
    message: text("message").notNull(),
    details: jsonb("details").notNull().$type<Record<string, unknown>>().default({}),
    sourceLinks: jsonb("source_links").notNull().$type<Array<{ label: string; href: string }>>().default([]),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    actor: text("actor"),
    action: text("action").notNull().default("evaluated"),
  },
  (table) => [
    index("alert_events_segment_month_idx").on(table.segment, table.month),
    index("alert_events_occurred_at_idx").on(table.occurredAt),
  ],
);

export const insertAlertThresholdSchema = createInsertSchema(alertThresholdsTable);
export type InsertAlertThreshold = z.infer<typeof insertAlertThresholdSchema>;
export type AlertThreshold = typeof alertThresholdsTable.$inferSelect;
export type AlertRecord = typeof alertRecordsTable.$inferSelect;
export type AlertEvent = typeof alertEventsTable.$inferSelect;
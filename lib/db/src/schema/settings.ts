import {
  pgTable,
  bigserial,
  text,
  numeric,
  date,
  integer,
  boolean,
  unique,
} from "drizzle-orm/pg-core";

// Multiplier is a VARIABLE. These are only DEFAULT suggestions; the value
// actually used is whatever the planner entered, stored on plan_runs.
export const bufferDefaults = pgTable(
  "buffer_defaults",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    division: text("division").notNull(),
    category: text("category"),
    scenario: text("scenario"),
    planMonth: date("plan_month"),
    multiplier: numeric("multiplier"),
    includeCurrentPending: boolean("include_current_pending").default(true),
    floor0: boolean("floor0").default(true),
  },
  (t) => [
    unique("buffer_defaults_uq").on(
      t.division,
      t.category,
      t.scenario,
      t.planMonth,
    ),
  ],
);

export const calendarSettings = pgTable(
  "calendar_settings",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    division: text("division").notNull(),
    planMonth: date("plan_month").notNull(),
    workingDays: integer("working_days").default(26),
    last3From: date("last3_from"),
    last3To: date("last3_to"),
    lastMonth: text("last_month"),
    stockAsOn: date("stock_as_on"),
  },
  (t) => [unique("calendar_settings_uq").on(t.division, t.planMonth)],
);

export type BufferDefault = typeof bufferDefaults.$inferSelect;
export type CalendarSetting = typeof calendarSettings.$inferSelect;
export type InsertCalendarSetting = typeof calendarSettings.$inferInsert;

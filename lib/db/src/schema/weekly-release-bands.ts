import { pgTable, serial, text, real, timestamp } from "drizzle-orm/pg-core";

export const weeklyReleaseBandsTable = pgTable("weekly_release_bands", {
  id: serial("id").primaryKey(),
  segment: text("segment").notNull().default("PTMT"),
  categoryName: text("category_name").notNull().unique(),
  w1Upper: real("w1_upper").notNull(),
  w2Upper: real("w2_upper").notNull(),
  w3Upper: real("w3_upper").notNull(),
  w4Upper: real("w4_upper").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type WeeklyReleaseBand = typeof weeklyReleaseBandsTable.$inferSelect;

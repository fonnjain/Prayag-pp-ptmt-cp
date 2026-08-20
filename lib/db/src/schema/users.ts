import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
  id:                 serial("id").primaryKey(),
  email:              text("email").notNull().unique(),
  passwordHash:       text("password_hash").notNull(),
  role:               text("role").notNull().default("user"),
  isActive:           boolean("is_active").notNull().default(true),
  mustChangePassword: boolean("must_change_password").notNull().default(true),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type User          = typeof usersTable.$inferSelect;
export type InsertUser    = typeof usersTable.$inferInsert;

/** Safe subset to attach to requests and return from the API (no password hash). */
export type SafeUser = Omit<User, "passwordHash">;

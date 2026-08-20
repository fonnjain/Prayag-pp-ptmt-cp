import { pgTable, serial, bigint, integer, text, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

export const appUsersTable = pgTable(
  "app_users",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull().default("user"),
    isActive: boolean("is_active").notNull().default(true),
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    emailUnique: uniqueIndex("app_users_email_unique").on(table.email),
  }),
);

export const authSessionsTable = pgTable(
  "auth_sessions",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    tokenHash: text("token_hash").notNull(),
    userId: integer("user_id").notNull().references(() => appUsersTable.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tokenUnique: uniqueIndex("auth_sessions_token_unique").on(table.tokenHash),
    userIndex: index("auth_sessions_user_idx").on(table.userId),
    expiryIndex: index("auth_sessions_expiry_idx").on(table.expiresAt),
  }),
);

export type AppUser = typeof appUsersTable.$inferSelect;
export type AuthSession = typeof authSessionsTable.$inferSelect;
import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const userActivitySessionsTable = pgTable(
  "user_activity_sessions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    app: text("app").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    activeSeconds: integer("active_seconds").notNull().default(0),
    idleSeconds: integer("idle_seconds").notNull().default(0),
    lastRoute: text("last_route"),
  },
  (table) => ({
    userStartedIdx: index("user_activity_sessions_user_started_idx").on(table.userId, table.startedAt),
    appStartedIdx: index("user_activity_sessions_app_started_idx").on(table.app, table.startedAt),
  }),
);

export const userActivityEventsTable = pgTable(
  "user_activity_events",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id").notNull().references(() => userActivitySessionsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    app: text("app").notNull(),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    route: text("route"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userOccurredIdx: index("user_activity_events_user_occurred_idx").on(table.userId, table.occurredAt),
    sessionOccurredIdx: index("user_activity_events_session_occurred_idx").on(table.sessionId, table.occurredAt),
  }),
);

export type UserActivitySession = typeof userActivitySessionsTable.$inferSelect;
export type UserActivityEvent = typeof userActivityEventsTable.$inferSelect;
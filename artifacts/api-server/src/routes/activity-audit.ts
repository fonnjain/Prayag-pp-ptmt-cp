import { Router, type IRouter, type Request } from "express";
import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import {
  db,
  userActivityEventsTable,
  userActivitySessionsTable,
  usersTable,
} from "@workspace/db";
import { loadSession, requireAdmin, requireSession } from "./session-middleware";
import { launchBrowser } from "../lib/browser";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const REPORT_TIME_ZONE = "Asia/Kolkata";
const MAX_HEARTBEAT_SECONDS = 300;
const ALLOWED_APPS = new Set(["ops-dashboard", "production-planning", "production-monitoring"]);
const ALLOWED_EVENT_KINDS = new Set(["page", "action"]);
const ALLOWED_ACTIONS = new Set([
  "signed_in",
  "signed_out",
  "password_changed",
  "user_created",
  "user_deleted",
  "user_role_changed",
  "password_reset",
  "export_started",
  "plan_created",
  "plan_published",
  "upload_started",
  "upload_completed",
]);

export interface ActivityAuditReport {
  filters: {
    userId: number | null;
    userEmail: string | null;
    startDate: string;
    endDate: string;
    timeZone: string;
  };
  generatedAt: string;
  totals: {
    sessions: number;
    activeSeconds: number;
    idleSeconds: number;
    pageViews: number;
    actions: number;
  };
  daily: Array<{
    date: string;
    userEmail: string;
    app: string;
    sessions: number;
    activeSeconds: number;
    idleSeconds: number;
    pageViews: number;
    actions: number;
  }>;
  sessions: Array<{
    id: number;
    userEmail: string;
    app: string;
    startedAt: string;
    lastSeenAt: string;
    endedAt: string | null;
    activeSeconds: number;
    idleSeconds: number;
    lastRoute: string | null;
  }>;
  pages: Array<{ app: string; route: string; count: number }>;
  actions: Array<{ app: string; name: string; count: number }>;
  timeline: Array<{
    id: number;
    userEmail: string;
    app: string;
    kind: string;
    name: string;
    route: string | null;
    occurredAt: string;
  }>;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatIstDate(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day;
}

function istDateStart(value: string): Date {
  return new Date(`${value}T00:00:00.000+05:30`);
}

function istDateEndExclusive(value: string): Date {
  const start = istDateStart(value);
  start.setUTCDate(start.getUTCDate() + 1);
  return start;
}

function defaultDateRange(): { startDate: string; endDate: string } {
  const endDate = formatIstDate(new Date());
  const start = new Date(istDateStart(endDate));
  start.setUTCDate(start.getUTCDate() - 29);
  return { startDate: formatIstDate(start), endDate };
}

function parseReportFilters(req: Request): {
  userId: number | null;
  startDate: string;
  endDate: string;
  start: Date;
  endExclusive: Date;
} | { error: string } {
  const defaults = defaultDateRange();
  const startDate = String(req.query.startDate ?? defaults.startDate);
  const endDate = String(req.query.endDate ?? defaults.endDate);
  if (!isValidDateString(startDate) || !isValidDateString(endDate)) {
    return { error: "startDate and endDate must be valid YYYY-MM-DD dates" };
  }
  if (endDate < startDate) {
    return { error: "endDate must be on or after startDate" };
  }

  const rawUserId = String(req.query.userId ?? "");
  const userId = rawUserId === "" || rawUserId === "all" ? null : Number(rawUserId);
  if (userId !== null && (!Number.isInteger(userId) || userId < 1)) {
    return { error: "userId must be a positive integer or all" };
  }

  return {
    userId,
    startDate,
    endDate,
    start: istDateStart(startDate),
    endExclusive: istDateEndExclusive(endDate),
  };
}

function validateApp(value: unknown): string | null {
  return typeof value === "string" && ALLOWED_APPS.has(value) ? value : null;
}

async function findOwnedSession(userId: number, rawSessionId: unknown) {
  const sessionId = Number(rawSessionId);
  if (!Number.isInteger(sessionId) || sessionId < 1) return null;
  const [session] = await db
    .select()
    .from(userActivitySessionsTable)
    .where(and(eq(userActivitySessionsTable.id, sessionId), eq(userActivitySessionsTable.userId, userId)))
    .limit(1);
  return session ?? null;
}

async function touchSession(
  userId: number,
  rawSessionId: unknown,
  route: string | null,
  visible: boolean,
  active: boolean,
  endSession: boolean,
): Promise<boolean> {
  const session = await findOwnedSession(userId, rawSessionId);
  if (!session || session.endedAt) return false;
  const elapsed = Math.max(0, Math.min(
    MAX_HEARTBEAT_SECONDS,
    Math.round((Date.now() - session.lastSeenAt.getTime()) / 1000),
  ));
  const activeDelta = visible && active ? elapsed : 0;
  const idleDelta = visible && active ? 0 : elapsed;
  await db.update(userActivitySessionsTable)
    .set({
      lastSeenAt: new Date(),
      lastRoute: route,
      endedAt: endSession ? new Date() : null,
      activeSeconds: sql`${userActivitySessionsTable.activeSeconds} + ${activeDelta}`,
      idleSeconds: sql`${userActivitySessionsTable.idleSeconds} + ${idleDelta}`,
    })
    .where(eq(userActivitySessionsTable.id, session.id));
  return true;
}

async function buildActivityReport(req: Request): Promise<ActivityAuditReport | { error: string; status: number }> {
  const parsed = parseReportFilters(req);
  if ("error" in parsed) return { error: parsed.error, status: 400 };

  const userCondition = parsed.userId === null ? undefined : eq(usersTable.id, parsed.userId);
  const sessionConditions = [
    lt(userActivitySessionsTable.startedAt, parsed.endExclusive),
    or(
      gte(userActivitySessionsTable.lastSeenAt, parsed.start),
      gte(userActivitySessionsTable.endedAt, parsed.start),
      isNull(userActivitySessionsTable.endedAt),
    ),
  ];
  if (userCondition) sessionConditions.push(userCondition);

  const sessions = await db
    .select({
      id: userActivitySessionsTable.id,
      userId: usersTable.id,
      userEmail: usersTable.email,
      app: userActivitySessionsTable.app,
      startedAt: userActivitySessionsTable.startedAt,
      lastSeenAt: userActivitySessionsTable.lastSeenAt,
      endedAt: userActivitySessionsTable.endedAt,
      activeSeconds: userActivitySessionsTable.activeSeconds,
      idleSeconds: userActivitySessionsTable.idleSeconds,
      lastRoute: userActivitySessionsTable.lastRoute,
    })
    .from(userActivitySessionsTable)
    .innerJoin(usersTable, eq(usersTable.id, userActivitySessionsTable.userId))
    .where(and(...sessionConditions))
    .orderBy(desc(userActivitySessionsTable.startedAt));

  const eventConditions = [
    gte(userActivityEventsTable.occurredAt, parsed.start),
    lt(userActivityEventsTable.occurredAt, parsed.endExclusive),
  ];
  if (parsed.userId !== null) eventConditions.push(eq(userActivityEventsTable.userId, parsed.userId));
  const events = await db
    .select({
      id: userActivityEventsTable.id,
      userEmail: usersTable.email,
      app: userActivityEventsTable.app,
      kind: userActivityEventsTable.kind,
      name: userActivityEventsTable.name,
      route: userActivityEventsTable.route,
      occurredAt: userActivityEventsTable.occurredAt,
    })
    .from(userActivityEventsTable)
    .innerJoin(usersTable, eq(usersTable.id, userActivityEventsTable.userId))
    .where(and(...eventConditions))
    .orderBy(desc(userActivityEventsTable.occurredAt))
    .limit(1000);

  const selectedUser = parsed.userId === null ? null : (await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, parsed.userId))
    .limit(1))[0];
  if (parsed.userId !== null && !selectedUser) return { error: "User not found", status: 404 };

  const dailyMap = new Map<string, ActivityAuditReport["daily"][number]>();
  for (const session of sessions) {
    const key = `${formatIstDate(session.startedAt)}|${session.userEmail}|${session.app}`;
    const current = dailyMap.get(key) ?? {
      date: formatIstDate(session.startedAt),
      userEmail: session.userEmail,
      app: session.app,
      sessions: 0,
      activeSeconds: 0,
      idleSeconds: 0,
      pageViews: 0,
      actions: 0,
    };
    current.sessions += 1;
    current.activeSeconds += session.activeSeconds;
    current.idleSeconds += session.idleSeconds;
    dailyMap.set(key, current);
  }
  for (const event of events) {
    const key = `${formatIstDate(event.occurredAt)}|${event.userEmail}|${event.app}`;
    const current = dailyMap.get(key) ?? {
      date: formatIstDate(event.occurredAt),
      userEmail: event.userEmail,
      app: event.app,
      sessions: 0,
      activeSeconds: 0,
      idleSeconds: 0,
      pageViews: 0,
      actions: 0,
    };
    if (event.kind === "page") current.pageViews += 1;
    if (event.kind === "action") current.actions += 1;
    dailyMap.set(key, current);
  }

  const pagesMap = new Map<string, ActivityAuditReport["pages"][number]>();
  const actionsMap = new Map<string, ActivityAuditReport["actions"][number]>();
  for (const event of events) {
    if (event.kind === "page") {
      const key = `${event.app}|${event.route ?? event.name}`;
      const current = pagesMap.get(key) ?? { app: event.app, route: event.route ?? event.name, count: 0 };
      current.count += 1;
      pagesMap.set(key, current);
    } else {
      const key = `${event.app}|${event.name}`;
      const current = actionsMap.get(key) ?? { app: event.app, name: event.name, count: 0 };
      current.count += 1;
      actionsMap.set(key, current);
    }
  }

  return {
    filters: {
      userId: parsed.userId,
      userEmail: selectedUser?.email ?? null,
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      timeZone: REPORT_TIME_ZONE,
    },
    generatedAt: new Date().toISOString(),
    totals: {
      sessions: sessions.length,
      activeSeconds: sessions.reduce((sum, row) => sum + row.activeSeconds, 0),
      idleSeconds: sessions.reduce((sum, row) => sum + row.idleSeconds, 0),
      pageViews: events.filter((event) => event.kind === "page").length,
      actions: events.filter((event) => event.kind === "action").length,
    },
    daily: [...dailyMap.values()].sort((a, b) => `${b.date}|${b.userEmail}|${b.app}`.localeCompare(`${a.date}|${a.userEmail}|${a.app}`)),
    sessions: sessions.map((session) => ({
      id: session.id,
      userEmail: session.userEmail,
      app: session.app,
      startedAt: session.startedAt.toISOString(),
      lastSeenAt: session.lastSeenAt.toISOString(),
      endedAt: session.endedAt?.toISOString() ?? null,
      activeSeconds: session.activeSeconds,
      idleSeconds: session.idleSeconds,
      lastRoute: session.lastRoute,
    })),
    pages: [...pagesMap.values()].sort((a, b) => b.count - a.count),
    actions: [...actionsMap.values()].sort((a, b) => b.count - a.count),
    timeline: events.map((event) => ({
      id: event.id,
      userEmail: event.userEmail,
      app: event.app,
      kind: event.kind,
      name: event.name,
      route: event.route,
      occurredAt: event.occurredAt.toISOString(),
    })),
  };
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

async function generateActivityPdf(report: ActivityAuditReport): Promise<Buffer> {
  const dailyRows = report.daily.map((row) =>
    `<tr><td>${escapeHtml(row.date)}</td><td>${escapeHtml(row.userEmail)}</td><td>${escapeHtml(row.app)}</td><td>${row.sessions}</td><td>${formatDuration(row.activeSeconds)}</td><td>${formatDuration(row.idleSeconds)}</td><td>${row.pageViews}</td><td>${row.actions}</td></tr>`,
  ).join("");
  const timelineRows = report.timeline.slice(0, 250).map((row) =>
    `<tr><td>${escapeHtml(new Date(row.occurredAt).toLocaleString("en-IN", { timeZone: REPORT_TIME_ZONE }))}</td><td>${escapeHtml(row.userEmail)}</td><td>${escapeHtml(row.app)}</td><td>${escapeHtml(row.kind)}</td><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.route ?? "—")}</td></tr>`,
  ).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:Arial,sans-serif;color:#172033;font-size:10px}h1{font-size:20px;margin:0 0 4px}h2{font-size:14px;margin:22px 0 6px}.muted{color:#667085}
    .cards{display:flex;gap:8px;margin:16px 0}.card{border:1px solid #d9dee8;padding:8px;min-width:90px}.value{font-size:16px;font-weight:bold;display:block;margin-top:3px}
    table{border-collapse:collapse;width:100%;margin-top:6px}th,td{border:1px solid #d9dee8;padding:4px;text-align:left}th{background:#f2f4f7}
  </style></head><body>
    <h1>User Activity Audit</h1>
    <div class="muted">${escapeHtml(report.filters.userEmail ?? "All users")} · ${escapeHtml(report.filters.startDate)} to ${escapeHtml(report.filters.endDate)} (${REPORT_TIME_ZONE})</div>
    <div class="cards">
      <div class="card">Sessions<span class="value">${report.totals.sessions}</span></div>
      <div class="card">Active time<span class="value">${formatDuration(report.totals.activeSeconds)}</span></div>
      <div class="card">Idle time<span class="value">${formatDuration(report.totals.idleSeconds)}</span></div>
      <div class="card">Page views<span class="value">${report.totals.pageViews}</span></div>
      <div class="card">Actions<span class="value">${report.totals.actions}</span></div>
    </div>
    <h2>Daily summary</h2><table><thead><tr><th>Date</th><th>User</th><th>App</th><th>Sessions</th><th>Active</th><th>Idle</th><th>Pages</th><th>Actions</th></tr></thead><tbody>${dailyRows || "<tr><td colspan='8'>No activity recorded</td></tr>"}</tbody></table>
    <h2>Timeline</h2><table><thead><tr><th>Time</th><th>User</th><th>App</th><th>Type</th><th>Event</th><th>Route</th></tr></thead><tbody>${timelineRows || "<tr><td colspan='6'>No events recorded</td></tr>"}</tbody></table>
  </body></html>`;
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 120_000 });
    return Buffer.from(await page.pdf({
      format: "A4",
      landscape: true,
      printBackground: true,
      timeout: 120_000,
      margin: { top: "10mm", bottom: "10mm", left: "8mm", right: "8mm" },
    }));
  } finally {
    await browser.close();
  }
}

router.post("/auth/activity/session", loadSession, requireSession, async (req, res): Promise<void> => {
  const app = validateApp(req.body?.app);
  if (!app) {
    res.status(400).json({ error: "Unsupported app" });
    return;
  }
  const route = typeof req.body?.route === "string" ? req.body.route.slice(0, 500) : null;
  const [session] = await db.insert(userActivitySessionsTable).values({
    userId: req.sessionUser!.id,
    app,
    lastRoute: route,
  }).returning({ id: userActivitySessionsTable.id });
  res.status(201).json({ sessionId: session.id });
});

router.post("/auth/activity/heartbeat", loadSession, requireSession, async (req, res): Promise<void> => {
  const route = typeof req.body?.route === "string" ? req.body.route.slice(0, 500) : null;
  const updated = await touchSession(
    req.sessionUser!.id,
    req.body?.sessionId,
    route,
    req.body?.visible !== false,
    req.body?.active === true,
    false,
  );
  if (!updated) {
    res.status(404).json({ error: "Activity session not found" });
    return;
  }
  res.status(204).end();
});

router.post("/auth/activity/event", loadSession, requireSession, async (req, res): Promise<void> => {
  const kind = typeof req.body?.kind === "string" ? req.body.kind : "";
  const name = typeof req.body?.name === "string" ? req.body.name.slice(0, 120) : "";
  const route = typeof req.body?.route === "string" ? req.body.route.slice(0, 500) : null;
  const session = await findOwnedSession(req.sessionUser!.id, req.body?.sessionId);
  if (!session || session.endedAt || !ALLOWED_EVENT_KINDS.has(kind)) {
    res.status(400).json({ error: "Invalid activity event" });
    return;
  }
  if (!name || (kind === "action" && !ALLOWED_ACTIONS.has(name))) {
    res.status(400).json({ error: "Invalid activity event name" });
    return;
  }
  await db.insert(userActivityEventsTable).values({
    sessionId: session.id,
    userId: req.sessionUser!.id,
    app: session.app,
    kind,
    name,
    route,
  });
  res.status(204).end();
});

router.post("/auth/activity/end", loadSession, requireSession, async (req, res): Promise<void> => {
  const updated = await touchSession(
    req.sessionUser!.id,
    req.body?.sessionId,
    typeof req.body?.route === "string" ? req.body.route.slice(0, 500) : null,
    req.body?.visible !== false,
    req.body?.active === true,
    true,
  );
  if (!updated) {
    res.status(404).json({ error: "Activity session not found" });
    return;
  }
  res.status(204).end();
});

router.get("/auth/activity/report", loadSession, requireAdmin, async (req, res): Promise<void> => {
  try {
    const report = await buildActivityReport(req);
    if ("error" in report) {
      res.status(report.status).json({ error: report.error });
      return;
    }
    res.json(report);
  } catch (err) {
    logger.error({ err }, "activity audit report failed");
    res.status(500).json({ error: "Failed to load activity audit" });
  }
});

router.get("/auth/activity/report.pdf", loadSession, requireAdmin, async (req, res): Promise<void> => {
  try {
    const report = await buildActivityReport(req);
    if ("error" in report) {
      res.status(report.status).json({ error: report.error });
      return;
    }
    const pdf = await generateActivityPdf(report);
    const suffix = report.filters.userEmail ? report.filters.userEmail.split("@")[0] : "all-users";
    const filename = `user-activity-${suffix}-${report.filters.startDate}-to-${report.filters.endDate}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(pdf);
  } catch (err) {
    logger.error({ err }, "activity audit PDF failed");
    res.status(500).json({ error: "Failed to generate activity audit PDF" });
  }
});

export default router;
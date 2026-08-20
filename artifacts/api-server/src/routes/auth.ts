/**
 * Auth routes — login, logout, current-user, change-password, and Admin-only
 * user-management CRUD. Password values never appear in logs or API responses.
 *
 * POST  /auth/login
 * POST  /auth/logout
 * GET   /auth/me
 * POST  /auth/change-password
 * GET   /auth/users                (admin)
 * POST  /auth/users                (admin)
 * DELETE /auth/users/:id           (admin)
 * PATCH /auth/users/:id/role       (admin)
 * POST  /auth/users/:id/reset-password (admin)
 */
import { Router, type IRouter }              from "express";
import { randomBytes }                        from "node:crypto";
import bcrypt                                 from "bcryptjs";
import { db }                                 from "@workspace/db";
import { usersTable, userSessionsTable }      from "@workspace/db";
import { eq, and, ne, count }                 from "drizzle-orm";
import {
  loadSession, requireSession, requireAdmin,
  SESSION_COOKIE, SESSION_DURATION_MS, hashToken,
}                                             from "./session-middleware";
import { logger }                             from "../lib/logger";

const router: IRouter = Router();

const BCRYPT_ROUNDS = 12;

// Precomputed bcrypt cost-12 hash used for constant-time dummy comparisons when
// the requested email is unknown or inactive.  The comparison runs real cost-12
// work (~270 ms) so response timing cannot distinguish a missing account from a
// wrong-password attempt.  Generated with: bcrypt.hashSync("__dummy_password__", 12)
const DUMMY_HASH = "$2b$12$XojMhegw9tyDyQdduby9A.xqu0r4M0nPW.ui22ejAYn.kYUK2gObi";

// ── Login rate-limiter (in-memory, per normalized email) ──────────────────────
// Tracks failed sign-in attempts to block credential-guessing without revealing
// whether an email address exists.
//
// Only the normalized email is used as the rate-limit key — NOT the client IP.
// An IP-based key would be bypassable by rotating the X-Forwarded-For header
// unless the deployment topology is tightly controlled and the proxy trust
// chain is fully verified.  The per-email key cannot be spoofed: an attacker
// must supply the exact email they are targeting, so 5 failures lock that one
// account for the window regardless of how many different source IPs are used.
const LOGIN_MAX_FAILURES = 5;           // failures allowed before lockout
const LOGIN_WINDOW_MS    = 15 * 60 * 1000; // 15-minute sliding window

interface AttemptRecord {
  count:       number;
  windowStart: number;
}

const loginAttempts = new Map<string, AttemptRecord>();

/** Return remaining lockout seconds (0 = not locked). */
function lockoutSecsRemaining(key: string): number {
  const rec = loginAttempts.get(key);
  if (!rec) return 0;
  const age = Date.now() - rec.windowStart;
  if (age > LOGIN_WINDOW_MS) {
    loginAttempts.delete(key);
    return 0;
  }
  if (rec.count < LOGIN_MAX_FAILURES) return 0;
  return Math.ceil((LOGIN_WINDOW_MS - age) / 1000);
}

function recordFailure(key: string): void {
  const now = Date.now();
  const rec = loginAttempts.get(key);
  if (!rec || now - rec.windowStart > LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, windowStart: now });
  } else {
    rec.count++;
  }
}

function clearAttempts(key: string): void {
  loginAttempts.delete(key);
}

/**
 * Exposed only for test isolation — clears all attempt counters.
 * Never call this in production code.
 */
export function _resetLoginAttempts(): void {
  loginAttempts.clear();
}

// Periodically evict expired windows so the Map doesn't grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [k, rec] of loginAttempts) {
    if (now - rec.windowStart > LOGIN_WINDOW_MS) loginAttempts.delete(k);
  }
}, LOGIN_WINDOW_MS).unref();

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env["NODE_ENV"] === "production",
    path: "/",
    maxAge, // milliseconds for res.cookie
  };
}

function safeUser(u: { id: number; email: string; role: string; isActive: boolean; mustChangePassword: boolean; createdAt: Date; updatedAt: Date }) {
  return {
    id:                 u.id,
    email:              u.email,
    role:               u.role,
    isActive:           u.isActive,
    mustChangePassword: u.mustChangePassword,
    createdAt:          u.createdAt,
    updatedAt:          u.updatedAt,
  };
}

async function countAdmins(): Promise<number> {
  const rows = await db.select({ c: count() }).from(usersTable).where(
    and(eq(usersTable.role, "admin"), eq(usersTable.isActive, true)),
  );
  return Number(rows[0]?.c ?? 0);
}

// ── POST /auth/login ──────────────────────────────────────────────────────────
router.post("/auth/login", async (req, res): Promise<void> => {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    res.status(400).json({ error: "email and password are required" });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const emailKey = `email:${normalizedEmail}`;

  // ── Atomic admission + pre-counting ────────────────────────────────────────
  // Check and then immediately increment the counter — both synchronously,
  // before any `await`.  In JavaScript's single-threaded event loop, no other
  // request handler can run between these two lines, so concurrent requests
  // each advance the count before the first async yield.  This prevents a
  // parallel batch from all seeing count < MAX at the same moment and all
  // slipping through for a password-verification attempt.
  const lockSecs = lockoutSecsRemaining(emailKey);
  if (lockSecs > 0) {
    logger.warn({ limiterKey: "email" }, "Login blocked by rate-limiter");
    res.status(429).json({
      error:          "Too many failed sign-in attempts. Please try again later.",
      retryAfterSecs: lockSecs,
    });
    return;
  }
  // Reserve an attempt slot before yielding to async work.
  recordFailure(emailKey);

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, normalizedEmail))
    .limit(1);

  if (!user || !user.isActive) {
    // Constant-time response: run real cost-12 bcrypt work so response timing
    // cannot distinguish an unknown/inactive account from a wrong password.
    // Counter was already pre-incremented above — no second recordFailure needed.
    await bcrypt.compare(password, DUMMY_HASH);
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const passwordOk = await bcrypt.compare(password, user.passwordHash);
  if (!passwordOk) {
    // Counter was already pre-incremented; just log and return.
    logger.warn({ userId: user.id }, "Failed login attempt");
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  // Successful login — clear the failure counter.
  clearAttempts(emailKey);

  // Create session
  const token     = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  await db.insert(userSessionsTable).values({ userId: user.id, tokenHash, expiresAt });

  res.cookie(SESSION_COOKIE, token, cookieOptions(SESSION_DURATION_MS));
  req.log.info({ userId: user.id }, "User logged in");
  res.json(safeUser(user));
});

// ── POST /auth/logout ─────────────────────────────────────────────────────────
router.post("/auth/logout", loadSession, async (req, res): Promise<void> => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token && typeof token === "string") {
    try {
      await db
        .delete(userSessionsTable)
        .where(eq(userSessionsTable.tokenHash, hashToken(token)));
    } catch (err) {
      logger.error({ err }, "Session deletion failed on logout");
    }
  }
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.status(204).end();
});

// ── GET /auth/me ──────────────────────────────────────────────────────────────
router.get("/auth/me", loadSession, requireSession, (req, res): void => {
  res.json(safeUser(req.sessionUser!));
});

// ── POST /auth/change-password ────────────────────────────────────────────────
router.post("/auth/change-password", loadSession, requireSession, async (req, res): Promise<void> => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
    res.status(400).json({ error: "currentPassword and newPassword are required" });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ error: "New password must be at least 8 characters" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.sessionUser!.id))
    .limit(1);

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await db.update(usersTable)
    .set({ passwordHash, mustChangePassword: false })
    .where(eq(usersTable.id, user.id));

  req.log.info({ userId: user.id }, "Password changed");
  res.status(204).end();
});

// ── GET /auth/users (admin) ───────────────────────────────────────────────────
router.get("/auth/users", loadSession, requireAdmin, async (_req, res): Promise<void> => {
  const users = await db
    .select({
      id:                 usersTable.id,
      email:              usersTable.email,
      role:               usersTable.role,
      isActive:           usersTable.isActive,
      mustChangePassword: usersTable.mustChangePassword,
      createdAt:          usersTable.createdAt,
      updatedAt:          usersTable.updatedAt,
    })
    .from(usersTable)
    .orderBy(usersTable.createdAt);
  res.json(users);
});

// ── POST /auth/users (admin) ──────────────────────────────────────────────────
router.post("/auth/users", loadSession, requireAdmin, async (req, res): Promise<void> => {
  const { email, password, role } = req.body ?? {};
  if (typeof email !== "string" || !email) {
    res.status(400).json({ error: "email is required" });
    return;
  }
  if (typeof password !== "string" || password.length < 8) {
    res.status(400).json({ error: "password must be at least 8 characters" });
    return;
  }
  const resolvedRole = role === "admin" ? "admin" : "user";

  const existing = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email.trim().toLowerCase()))
    .limit(1);
  if (existing.length > 0) {
    res.status(409).json({ error: "A user with that email already exists" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const [created] = await db.insert(usersTable).values({
    email: email.trim().toLowerCase(),
    passwordHash,
    role: resolvedRole,
    isActive: true,
    mustChangePassword: true,
  }).returning({
    id:                 usersTable.id,
    email:              usersTable.email,
    role:               usersTable.role,
    isActive:           usersTable.isActive,
    mustChangePassword: usersTable.mustChangePassword,
    createdAt:          usersTable.createdAt,
    updatedAt:          usersTable.updatedAt,
  });

  req.log.info({ userId: created.id, role: resolvedRole }, "User created by admin");
  res.status(201).json(created);
});

// ── DELETE /auth/users/:id (admin) ────────────────────────────────────────────
router.delete("/auth/users/:id", loadSession, requireAdmin, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId ?? "", 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  // Prevent removing the last admin
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (user.role === "admin") {
    const remaining = await countAdmins();
    if (remaining <= 1) {
      res.status(409).json({ error: "Cannot remove the last admin account", code: "LAST_ADMIN" });
      return;
    }
  }

  await db.delete(usersTable).where(eq(usersTable.id, id));
  req.log.info({ targetUserId: id }, "User deleted by admin");
  res.status(204).end();
});

// ── PATCH /auth/users/:id/role (admin) ───────────────────────────────────────
router.patch("/auth/users/:id/role", loadSession, requireAdmin, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId ?? "", 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  const { role } = req.body ?? {};
  if (role !== "admin" && role !== "user") {
    res.status(400).json({ error: "role must be 'admin' or 'user'" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // Prevent demoting the last admin
  if (user.role === "admin" && role === "user") {
    const otherAdmins = await db
      .select({ c: count() })
      .from(usersTable)
      .where(and(eq(usersTable.role, "admin"), eq(usersTable.isActive, true), ne(usersTable.id, id)));
    if (Number(otherAdmins[0]?.c ?? 0) === 0) {
      res.status(409).json({ error: "Cannot demote the last admin account", code: "LAST_ADMIN" });
      return;
    }
  }

  const [updated] = await db.update(usersTable)
    .set({ role })
    .where(eq(usersTable.id, id))
    .returning({
      id:                 usersTable.id,
      email:              usersTable.email,
      role:               usersTable.role,
      isActive:           usersTable.isActive,
      mustChangePassword: usersTable.mustChangePassword,
      createdAt:          usersTable.createdAt,
      updatedAt:          usersTable.updatedAt,
    });

  req.log.info({ targetUserId: id, newRole: role }, "User role changed by admin");
  res.json(updated);
});

// ── POST /auth/users/:id/reset-password (admin) ───────────────────────────────
router.post("/auth/users/:id/reset-password", loadSession, requireAdmin, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId ?? "", 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  const { newPassword } = req.body ?? {};
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    res.status(400).json({ error: "newPassword must be at least 8 characters" });
    return;
  }

  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, id)).limit(1);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await db.update(usersTable)
    .set({ passwordHash, mustChangePassword: true })
    .where(eq(usersTable.id, id));

  // Invalidate all existing sessions for this user so they're forced to log in with the new password
  await db.delete(userSessionsTable).where(eq(userSessionsTable.userId, id));

  req.log.info({ targetUserId: id }, "Password reset by admin");
  res.status(204).end();
});

export default router;

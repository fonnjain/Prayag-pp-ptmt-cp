/**
 * Session middleware for browser-based password authentication.
 *
 * loadSession: reads the HTTP-only session cookie, looks up the hashed token in
 * the database, and attaches the user to req.sessionUser. Runs globally so any
 * route can check authentication without an extra DB round-trip.
 *
 * requireSession: rejects unauthenticated requests with 401.
 * requireAdmin:   rejects non-admin requests with 403.
 *
 * Machine-to-machine routes (plant-live, corrective PATCH) use the separate
 * requireApiKey middleware and are unaffected by these.
 */
import type { Request, Response, NextFunction } from "express";
import { createHash }                           from "node:crypto";
import { db }                                   from "@workspace/db";
import { userSessionsTable, usersTable }        from "@workspace/db";
import { eq, and, gt }                          from "drizzle-orm";
import { logger }                               from "../lib/logger";
import type { SafeUser }                        from "@workspace/db";

export const SESSION_COOKIE      = "prayag_session";
export const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Extend Express Request type project-wide.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      sessionUser?: SafeUser;
    }
  }
}

export async function loadSession(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token || typeof token !== "string") {
    next();
    return;
  }

  try {
    const tokenHash = hashToken(token);
    const now       = new Date();

    const rows = await db
      .select({
        id:                 usersTable.id,
        email:              usersTable.email,
        role:               usersTable.role,
        isActive:           usersTable.isActive,
        mustChangePassword: usersTable.mustChangePassword,
        createdAt:          usersTable.createdAt,
        updatedAt:          usersTable.updatedAt,
      })
      .from(userSessionsTable)
      .innerJoin(usersTable, eq(userSessionsTable.userId, usersTable.id))
      .where(
        and(
          eq(userSessionsTable.tokenHash, tokenHash),
          gt(userSessionsTable.expiresAt, now),
          eq(usersTable.isActive, true),
        ),
      )
      .limit(1);

    if (rows[0]) {
      req.sessionUser = rows[0];
    }
  } catch (err) {
    logger.error({ err }, "Session lookup failed");
  }

  next();
}

export function requireSession(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.sessionUser) {
    res.status(401).json({ error: "Authentication required", code: "UNAUTHENTICATED" });
    return;
  }
  next();
}

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.sessionUser) {
    res.status(401).json({ error: "Authentication required", code: "UNAUTHENTICATED" });
    return;
  }
  if (req.sessionUser.role !== "admin") {
    res.status(403).json({ error: "Admin access required", code: "FORBIDDEN" });
    return;
  }
  next();
}

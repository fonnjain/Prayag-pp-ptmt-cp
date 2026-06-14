import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { eq, and, gt } from "drizzle-orm";
import { db, users, sessions, type User } from "@workspace/db";
import { HttpError } from "./http";

const COOKIE = "pp_session";
const SESSION_DAYS = 30;

export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const dk = scryptSync(plain, salt, 64);
  return `scrypt$${salt.toString("hex")}$${dk.toString("hex")}`;
}

export function verifyPassword(stored: string, plain: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1]!, "hex");
  const expected = Buffer.from(parts[2]!, "hex");
  const actual = scryptSync(plain, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function createSession(userId: number): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ token, userId, expiresAt });
  return token;
}

export async function destroySession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.token, token));
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE, { path: "/" });
}

export function getCookieToken(req: Request): string | null {
  const raw = (req as Request & { cookies?: Record<string, string> }).cookies;
  return raw?.[COOKIE] ?? null;
}

export async function resolveUser(req: Request): Promise<User | null> {
  const token = getCookieToken(req);
  if (!token) return null;
  const rows = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0]?.user ?? null;
}

export type AuthedRequest = Request & { user?: User };

// Login is temporarily disabled: every request is treated as this admin user so
// the app is fully usable without signing in. To re-enable auth, delete
// AUTH_DISABLED / BYPASS_USER and restore the resolveUser-only body below.
const AUTH_DISABLED = true;
const BYPASS_USER: User = {
  id: 1,
  email: "admin@prayag.test",
  name: "Admin",
  role: "admin",
  passwordHash: null,
  createdAt: new Date(),
} as User;

export async function attachUser(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (AUTH_DISABLED) {
      (req as AuthedRequest).user = BYPASS_USER;
      next();
      return;
    }
    (req as AuthedRequest).user = (await resolveUser(req)) ?? undefined;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (!(req as AuthedRequest).user) {
    throw new HttpError(401, "Not authenticated");
  }
  next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = (req as AuthedRequest).user;
    if (!user) throw new HttpError(401, "Not authenticated");
    if (!roles.includes(user.role ?? "")) {
      throw new HttpError(403, "Insufficient permissions");
    }
    next();
  };
}

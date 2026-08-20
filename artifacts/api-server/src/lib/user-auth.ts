import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { and, eq, gt } from "drizzle-orm";
import { db, appUsersTable, authSessionsTable, type AppUser } from "@workspace/db";

function deriveKey(password: string, salt: Buffer, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, length, { N: 16_384, r: 8, p: 1 }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey as Buffer);
    });
  });
}
export const SESSION_COOKIE = "prayag_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const BOOTSTRAP_ADMIN_EMAILS = [
  "preeti.chauhan@prayagindia.com",
  "deepakj@prayagindia.com",
  "ceo@prayagindia.com",
] as const;

export type PublicUser = {
  id: number;
  email: string;
  role: "admin" | "user";
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: Date;
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidRole(role: string): role is "admin" | "user" {
  return role === "admin" || role === "user";
}

export function toPublicUser(user: AppUser): PublicUser {
  const role = isValidRole(user.role) ? user.role : "user";
  return {
    id: user.id,
    email: user.email,
    role,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt,
  };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = await deriveKey(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [, saltHex, hashHex] = encoded.split("$");
  if (!saltHex || !hashHex || !/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(hashHex)) {
    return false;
  }
  try {
    const expected = Buffer.from(hashHex, "hex");
    const actual = await deriveKey(password, Buffer.from(saltHex, "hex"), expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function parseCookieHeader(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").flatMap((part) => {
      const [rawName, ...rawValue] = part.trim().split("=");
      if (!rawName || rawValue.length === 0) return [];
      return [[rawName, decodeURIComponent(rawValue.join("="))]];
    }),
  );
}

function setSessionCookie(res: Response, token: string, maxAgeSeconds: number): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`,
  );
}

export function clearSessionCookie(res: Response): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
  );
}

export async function createSession(userId: number, res: Response): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(authSessionsTable).values({
    tokenHash: hashSessionToken(token),
    userId,
    expiresAt,
  });
  setSessionCookie(res, token, Math.floor(SESSION_TTL_MS / 1000));
}

export async function destroySession(req: Request, res: Response): Promise<void> {
  const token = parseCookieHeader(req.get("cookie"))[SESSION_COOKIE];
  if (token) {
    await db.delete(authSessionsTable).where(eq(authSessionsTable.tokenHash, hashSessionToken(token)));
  }
  clearSessionCookie(res);
}

export async function getUserForRequest(req: Request): Promise<AppUser | null> {
  const token = parseCookieHeader(req.get("cookie"))[SESSION_COOKIE];
  if (!token) return null;
  const [result] = await db
    .select({ user: appUsersTable })
    .from(authSessionsTable)
    .innerJoin(appUsersTable, eq(authSessionsTable.userId, appUsersTable.id))
    .where(
      and(
        eq(authSessionsTable.tokenHash, hashSessionToken(token)),
        gt(authSessionsTable.expiresAt, new Date()),
        eq(appUsersTable.isActive, true),
      ),
    )
    .limit(1);
  return result?.user ?? null;
}

export async function seedBootstrapAdmins(): Promise<void> {
  const bootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!bootstrapPassword) {
    return;
  }
  if (bootstrapPassword.length < 8) {
    throw new Error("BOOTSTRAP_ADMIN_PASSWORD must be at least 8 characters");
  }

  const passwordHash = await hashPassword(bootstrapPassword);
  let inserted = 0;
  for (const email of BOOTSTRAP_ADMIN_EMAILS) {
    const result = await db
      .insert(appUsersTable)
      .values({
        email,
        passwordHash,
        role: "admin",
        isActive: true,
      })
      .onConflictDoNothing({ target: appUsersTable.email })
      .returning({ id: appUsersTable.id });
    if (result.length > 0) inserted++;
    await db
      .update(appUsersTable)
      .set({ role: "admin", isActive: true, updatedAt: new Date() })
      .where(eq(appUsersTable.email, email));
  }
  if (inserted > 0) {
    const { logger } = await import("./logger");
    logger.info({ inserted }, "Seeded bootstrap admin accounts");
  }
}
import { Router } from "express";
import { db, appUsersTable, authSessionsTable } from "@workspace/db";
import { asc, count, eq } from "drizzle-orm";
import { hashPassword, normalizeEmail, toPublicUser } from "../lib/user-auth";
import { requireAdmin } from "./user-auth-middleware";

const router = Router();
router.use("/users", requireAdmin);

function validPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 200;
}

function validRole(value: unknown): value is "admin" | "user" {
  return value === "admin" || value === "user";
}

router.get("/users", async (_req, res): Promise<void> => {
  try {
    const users = await db.select().from(appUsersTable).orderBy(asc(appUsersTable.email));
    res.json({ users: users.map(toPublicUser) });
  } catch {
    res.status(500).json({ error: "Unable to load users" });
  }
});

router.post("/users", async (req, res): Promise<void> => {
  const body = req.body as Record<string, unknown> | undefined;
  const email = typeof body?.email === "string" ? normalizeEmail(body.email) : "";
  const password = body?.password;
  const role = body?.role ?? "user";
  if (!email || !email.includes("@") || !validPassword(password) || !validRole(role)) {
    res.status(400).json({ error: "Email, password, and a valid role are required" });
    return;
  }
  try {
    const [user] = await db
      .insert(appUsersTable)
      .values({ email, passwordHash: await hashPassword(password), role })
      .returning();
    res.status(201).json({ user: toPublicUser(user) });
  } catch (err) {
    const duplicate = err instanceof Error && /unique|duplicate/i.test(err.message);
    res.status(duplicate ? 409 : 500).json({ error: duplicate ? "A user with that email already exists" : "Unable to create user" });
  }
});

router.patch("/users/:id", async (req, res): Promise<void> => {
  const id = Number.parseInt(req.params.id, 10);
  const role = (req.body as Record<string, unknown> | undefined)?.role;
  if (!Number.isInteger(id) || !validRole(role)) {
    res.status(400).json({ error: "A valid user id and role are required" });
    return;
  }
  try {
    const [target] = await db.select().from(appUsersTable).where(eq(appUsersTable.id, id)).limit(1);
    if (!target) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (target.role === "admin" && role === "user") {
      const [{ total }] = await db.select({ total: count() }).from(appUsersTable).where(eq(appUsersTable.role, "admin"));
      if (Number(total) <= 1) {
        res.status(409).json({ error: "The last administrator cannot be demoted" });
        return;
      }
    }
    const [updated] = await db
      .update(appUsersTable)
      .set({ role, updatedAt: new Date() })
      .where(eq(appUsersTable.id, id))
      .returning();
    res.json({ user: toPublicUser(updated) });
  } catch {
    res.status(500).json({ error: "Unable to update user role" });
  }
});

router.post("/users/:id/reset-password", async (req, res): Promise<void> => {
  const id = Number.parseInt(req.params.id, 10);
  const password = (req.body as Record<string, unknown> | undefined)?.password;
  if (!Number.isInteger(id) || !validPassword(password)) {
    res.status(400).json({ error: "A valid user id and password are required" });
    return;
  }
  try {
    const [updated] = await db
      .update(appUsersTable)
      .set({ passwordHash: await hashPassword(password), mustChangePassword: true, updatedAt: new Date() })
      .where(eq(appUsersTable.id, id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    await db.delete(authSessionsTable).where(eq(authSessionsTable.userId, id));
    res.json({ user: toPublicUser(updated) });
  } catch {
    res.status(500).json({ error: "Unable to reset password" });
  }
});

router.delete("/users/:id", async (req, res): Promise<void> => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "A valid user id is required" });
    return;
  }
  if (id === req.appUser?.id) {
    res.status(409).json({ error: "You cannot delete your own account" });
    return;
  }
  try {
    const [target] = await db.select().from(appUsersTable).where(eq(appUsersTable.id, id)).limit(1);
    if (!target) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (target.role === "admin") {
      const [{ total }] = await db.select({ total: count() }).from(appUsersTable).where(eq(appUsersTable.role, "admin"));
      if (Number(total) <= 1) {
        res.status(409).json({ error: "The last administrator cannot be deleted" });
        return;
      }
    }
    await db.delete(appUsersTable).where(eq(appUsersTable.id, id));
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Unable to delete user" });
  }
});

export default router;
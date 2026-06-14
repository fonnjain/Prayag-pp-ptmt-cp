import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, users } from "@workspace/db";
import { LoginBody } from "@workspace/api-zod";
import {
  verifyPassword,
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  getCookieToken,
  type AuthedRequest,
} from "../lib/auth";
import { asyncHandler, HttpError } from "../lib/http";

const router: IRouter = Router();

function userView(u: { id: number; email: string | null; name: string | null; role: string | null }) {
  return { id: u.id, email: u.email, name: u.name, role: u.role ?? "viewer" };
}

router.post(
  "/auth/login",
  asyncHandler(async (req, res) => {
    const body = LoginBody.parse(req.body);
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.email, body.email))
      .limit(1);
    const user = rows[0];
    if (!user || !user.passwordHash || !verifyPassword(user.passwordHash, body.password)) {
      throw new HttpError(401, "Invalid email or password");
    }
    const token = await createSession(user.id);
    setSessionCookie(res, token);
    res.json(userView(user));
  }),
);

router.post(
  "/auth/logout",
  asyncHandler(async (req, res) => {
    const token = getCookieToken(req);
    if (token) await destroySession(token);
    clearSessionCookie(res);
    res.json({ ok: true });
  }),
);

router.get("/auth/me", (req, res) => {
  const user = (req as AuthedRequest).user;
  if (!user) throw new HttpError(401, "Not authenticated");
  res.json(userView(user));
});

export default router;

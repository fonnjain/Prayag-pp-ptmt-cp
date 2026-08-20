import type { NextFunction, Request, Response } from "express";
import { getUserForRequest, toPublicUser, type PublicUser } from "../lib/user-auth";

declare global {
  namespace Express {
    interface Request {
      appUser?: PublicUser;
    }
  }
}

export async function loadAppUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await getUserForRequest(req);
    req.appUser = user ? toPublicUser(user) : undefined;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAppUser(req: Request, res: Response, next: NextFunction): void {
  if (!req.appUser) {
    res.status(401).json({ error: "Authentication required", code: "AUTH_REQUIRED" });
    return;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.appUser) {
    res.status(401).json({ error: "Authentication required", code: "AUTH_REQUIRED" });
    return;
  }
  if (req.appUser.role !== "admin") {
    res.status(403).json({ error: "Administrator access required", code: "ADMIN_REQUIRED" });
    return;
  }
  next();
}
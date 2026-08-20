/**
 * Seeds the initial Admin accounts declared in INITIAL_ADMIN_EMAILS.
 * The shared bootstrap password is read from BOOTSTRAP_ADMIN_PASSWORD at
 * startup and is NEVER logged or returned from any API endpoint.
 *
 * Seeding is idempotent: existing accounts are skipped, so this function is
 * safe to call on every startup.
 */
import bcrypt      from "bcryptjs";
import { db }      from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq }      from "drizzle-orm";
import { logger }  from "./logger";

const BCRYPT_ROUNDS = 12;

export async function seedBootstrapAdmins(): Promise<void> {
  const emailsEnv = process.env["INITIAL_ADMIN_EMAILS"];
  const password  = process.env["BOOTSTRAP_ADMIN_PASSWORD"];

  if (!emailsEnv || !password) {
    logger.info("Bootstrap seeding skipped: INITIAL_ADMIN_EMAILS or BOOTSTRAP_ADMIN_PASSWORD not set");
    return;
  }

  const emails = emailsEnv
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (emails.length === 0) return;

  // Hash once, reuse for all seeded accounts (safe: same password, same hash).
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  for (const email of emails) {
    const existing = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);

    if (existing.length > 0) {
      logger.info({ email }, "Bootstrap admin already exists; skipping");
      continue;
    }

    await db.insert(usersTable).values({
      email,
      passwordHash,
      role: "admin",
      isActive: true,
      mustChangePassword: true,
    });
    // Log email only — never the password or hash.
    logger.info({ email }, "Bootstrap admin account created");
  }
}

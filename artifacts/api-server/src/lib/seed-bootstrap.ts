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
  } else {
    const emails = emailsEnv
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    if (emails.length > 0) {
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
  }

  // The regression verifier deliberately uses its own credential pair. Keep
  // that dedicated account in the bcrypt-backed users table used by browser
  // auth; the legacy app_users table stores scrypt hashes and is not consulted
  // by the active login route. Restrict this to the Replit validation workflow
  // so a test credential cannot provision an account in a published deployment.
  const regressionEmail = process.env["REGRESSION_AUTH_EMAIL"]?.trim().toLowerCase();
  const regressionPassword = process.env["REGRESSION_AUTH_PASSWORD"];
  if (process.env["REPLIT_MODE"] !== "workflow" || !regressionEmail || !regressionPassword) {
    return;
  }
  if (regressionPassword.length < 8) {
    throw new Error("REGRESSION_AUTH_PASSWORD must be at least 8 characters");
  }

  const passwordHash = await bcrypt.hash(regressionPassword, BCRYPT_ROUNDS);
  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, regressionEmail))
    .limit(1);

  if (existing) {
    await db.update(usersTable)
      .set({
        passwordHash,
        role: "admin",
        isActive: true,
        mustChangePassword: false,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, existing.id));
    logger.info({ email: regressionEmail }, "Regression verifier account synchronized");
  } else {
    await db.insert(usersTable).values({
      email: regressionEmail,
      passwordHash,
      role: "admin",
      isActive: true,
      mustChangePassword: false,
    });
    logger.info({ email: regressionEmail }, "Regression verifier account created");
  }
}

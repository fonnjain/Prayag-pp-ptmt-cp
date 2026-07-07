import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findMigrationsDir(): string {
  const candidates = [
    path.resolve(__dirname, "../../../../lib/db/migrations"),
    path.resolve(process.cwd(), "../../lib/db/migrations"),
    path.resolve(process.cwd(), "lib/db/migrations"),
  ];
  for (const candidate of candidates) {
    try {
      readdirSync(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error(`migrations directory not found. Tried: ${candidates.join(", ")}`);
}

export async function runMigrations(): Promise<void> {
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `));

  const migrationsDir = findMigrationsDir();
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const rows = await db.execute(
      sql`SELECT 1 FROM _migrations WHERE filename = ${file}`,
    );
    if (rows.rowCount && rows.rowCount > 0) continue;

    const migrationSql = readFileSync(path.join(migrationsDir, file), "utf-8");
    await db.execute(sql.raw(migrationSql));
    await db.execute(
      sql`INSERT INTO _migrations (filename) VALUES (${file})`,
    );
    logger.info({ file }, "Applied migration");
  }
}

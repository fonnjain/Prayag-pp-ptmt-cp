import { createApp } from "./app";
import { logger } from "./lib/logger";
import { ensureSeedData } from "./lib/seed";
import { runMigrations } from "./lib/runMigrations";
import { ensureBrowser } from "./lib/ensureBrowser";

const port = Number(process.env.PORT ?? 8080);

async function main(): Promise<void> {
  const app = createApp();

  // Bind the port immediately — GET /api touches no DB and responds 200 right away.
  // Healthchecks pass from the very first probe regardless of what happens below.
  await new Promise<void>((resolve) => {
    app.listen(port, "0.0.0.0", () => {
      logger.info({ port }, "api-server listening");
      resolve();
    });
  });

  // Run migrations + seeding in the background, non-fatally.
  // Any failure is logged; the server stays alive so healthchecks keep passing.
  // DB-backed routes will start working once this completes.
  (async () => {
    try {
      await runMigrations();
      await ensureSeedData();
      logger.info("Database ready");
    } catch (err) {
      logger.error({ err }, "Migrations/seeding failed — server continues; DB-backed routes may error until fixed");
    }

    // Chrome install — non-blocking, non-fatal. PDF generation works once done.
    try {
      await ensureBrowser();
    } catch (err) {
      logger.warn({ err }, "Browser setup failed — PDF generation unavailable");
    }
  })();
}

main().catch((err) => {
  // Only app.listen() is awaited in main() — if that fails, exit.
  logger.error({ err }, "Failed to bind port — exiting");
  process.exit(1);
});

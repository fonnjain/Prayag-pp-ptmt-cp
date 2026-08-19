import { createApp } from "./app";
import { logger } from "./lib/logger";
import { ensureSeedData } from "./lib/seed";
import { runMigrations } from "./lib/runMigrations";
import { startSyncScheduler } from "./routes/sync";
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

    // Install Chrome for PDF export (non-blocking; runs in background).
    ensureBrowser().catch((err) => logger.error({ err }, "ensureBrowser failed"));

    // Start auto-sync scheduler after DB is ready.
    // Pulls Daily Production + Order Book hourly during IST work hours.
    startSyncScheduler();

    // Warm the active PTMT monitoring payload before the first browser visit.
    // Bundle and weekly endpoints share this one result, so the Control Board
    // can render from memory rather than waiting for a cold Sheets/plan rebuild.
    const month = new Date().toISOString().slice(0, 7);
    import("./routes/plant")
      .then(({ getPlantMonitoringCached }) => getPlantMonitoringCached(month))
      .then(() => logger.info({ month }, "Plant monitoring startup pre-warm complete"))
      .catch((err) => logger.warn({ err, month }, "Plant monitoring startup pre-warm failed"));
  })();
}

main().catch((err) => {
  // Only app.listen() is awaited in main() — if that fails, exit.
  logger.error({ err }, "Failed to bind port — exiting");
  process.exit(1);
});

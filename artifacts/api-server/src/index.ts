import { createApp, setDatabaseReady } from "./app";
import { logger } from "./lib/logger";
import { ensureSeedData } from "./lib/seed";
import { seedBootstrapAdmins } from "./lib/seed-bootstrap";
import { runMigrations } from "./lib/runMigrations";
import { startSyncScheduler } from "./routes/sync";
import { ensureBrowser } from "./lib/ensureBrowser";

const port = Number(process.env.PORT ?? 8080);
const INITIAL_DB_RETRY_DELAY_MS = 5_000;
const MAX_DB_RETRY_DELAY_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function bootstrapDatabase(): Promise<void> {
  let attempt = 0;
  let retryDelayMs = INITIAL_DB_RETRY_DELAY_MS;

  while (true) {
    attempt++;
    try {
      await runMigrations();
      await ensureSeedData();
      await seedBootstrapAdmins();
      setDatabaseReady(true);
      logger.info({ attempt }, "Database ready");
      return;
    } catch (err) {
      setDatabaseReady(false);
      logger.error(
        { err, attempt, retryDelayMs },
        "Migrations/seeding failed — retrying while the database is unavailable",
      );
      await sleep(retryDelayMs);
      retryDelayMs = Math.min(retryDelayMs * 2, MAX_DB_RETRY_DELAY_MS);
    }
  }
}

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

  // Run migrations + seeding in the background. The database can be restarted
  // independently of the app, so keep retrying transient startup failures
  // instead of leaving every DB-backed route at 503 forever.
  (async () => {
    await bootstrapDatabase();

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

    // The versioned read-only API is local-only. Persist Plumbing Sheet3
    // actuals before any workbook-heavy plan rebuild can fail on a transient
    // Sheets quota response, so /api/v1 remains useful after publishing.
    import("./lib/plant-ingestion")
      .then(({ refreshPlumbingActualsCache }) => refreshPlumbingActualsCache(month))
      .then(({ actuals, snapshotDate }) =>
        logger.info({ month, rowCount: actuals.length, snapshotDate }, "Plumbing API actuals startup cache ready"),
      )
      .catch((err) => logger.warn({ err, month }, "Plumbing API actuals startup cache failed"));

    // Warm the live machine summary independently. It is an external API
    // call, so it must never delay readiness or the Sheets-backed pre-warm.
    import("./routes/plant-live")
      .then(({ warmPlantLiveSummary }) => warmPlantLiveSummary(month, "PTMT"))
      .catch((err) => logger.warn({ err, month }, "Plant-live startup pre-warm could not start"));
  })();
}

main().catch((err) => {
  // Only app.listen() is awaited in main() — if that fails, exit.
  logger.error({ err }, "Failed to bind port — exiting");
  process.exit(1);
});

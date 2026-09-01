import { createServer, type RequestListener } from "node:http";

const port = Number(process.env.PORT ?? 8080);
const INITIAL_DB_RETRY_DELAY_MS = 5_000;
const MAX_DB_RETRY_DELAY_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let realHandler: RequestListener | null = null;

// Bind a minimal liveness server before loading the Express app and its full
// route/import graph. This process can be cold-started under a deployment
// health-check while the real application is still being evaluated.
const server = createServer((req, res) => {
  if (!realHandler) {
    if (req.url?.startsWith("/api/healthz") || req.url === "/api") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "starting" }));
      return;
    }

    res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
    res.end("starting");
    return;
  }

  realHandler(req, res);
});

async function loadApplication(): Promise<void> {
  const [{ createApp, setDatabaseReady }, { logger }] = await Promise.all([
    import("./app"),
    import("./lib/logger"),
  ]);

  const app = createApp();
  realHandler = app as unknown as RequestListener;
  logger.info({ port }, "api-server ready");

  const { ensureSeedData } = await import("./lib/seed");
  const { seedBootstrapAdmins } = await import("./lib/seed-bootstrap");
  const { runMigrations } = await import("./lib/runMigrations");

  // Run migrations + seeding after the port is bound and the real app is
  // serving. Database-backed routes remain retryable until this completes.
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
      break;
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

  const { ensureBrowser } = await import("./lib/ensureBrowser");
  const { startSyncScheduler } = await import("./routes/sync");

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
}

server.on("error", (err) => {
  console.error("Failed to bind port — exiting", err);
  process.exit(1);
});

server.listen(port, "0.0.0.0", () => {
  console.log(JSON.stringify({ port, msg: "api-server port bound" }));
  loadApplication().catch((err) => {
    console.error("Failed to load API application", err);
  });
});

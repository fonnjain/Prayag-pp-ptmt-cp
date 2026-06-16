import app from "./app";
import { logger } from "./lib/logger";
import { seedSourceConfig } from "./services/seed";
import { startScheduler } from "./services/scheduler";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function main(): Promise<void> {
  // Seed required reference data BEFORE serving traffic so the first pull/build
  // can never race an unseeded source_config table.
  await seedSourceConfig();

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
    // Start the work-hours auto-sync timer only after we are serving traffic.
    startScheduler();
  });
}

void main();

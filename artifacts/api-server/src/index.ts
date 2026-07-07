import { createApp } from "./app";
import { logger } from "./lib/logger";
import { ensureSeedData } from "./lib/seed";
import { runMigrations } from "./lib/runMigrations";
import { ensureBrowser } from "./lib/ensureBrowser";

const port = Number(process.env.PORT ?? 8080);

async function main(): Promise<void> {
  await runMigrations();
  await ensureSeedData();

  // Start listening immediately so healthchecks pass while Chrome installs
  const app = createApp();
  app.listen(port, "0.0.0.0", () => {
    logger.info({ port }, "api-server listening");
    // Install Chrome in background — PDF generation will work once ready
    ensureBrowser().catch((err) => logger.warn({ err }, "Background browser setup failed"));
  });
}

main().catch((err) => {
  logger.error({ err }, "Failed to start api-server");
  process.exit(1);
});

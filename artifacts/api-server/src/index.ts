import { createApp } from "./app";
import { logger } from "./lib/logger";
import { ensureSeedData } from "./lib/seed";
import { runMigrations } from "./lib/runMigrations";
import { ensureBrowser } from "./lib/ensureBrowser";

const port = Number(process.env.PORT ?? 8080);

async function main(): Promise<void> {
  const app = createApp();

  // Bind the port immediately so healthchecks pass on cold starts.
  // GET /api needs no DB so it responds 200 right away.
  await new Promise<void>((resolve) => {
    app.listen(port, "0.0.0.0", () => {
      logger.info({ port }, "api-server listening");
      resolve();
    });
  });

  // Migrations and seeding run after we're already serving traffic.
  // DB-backed routes will work once this completes (~a few seconds).
  await runMigrations();
  await ensureSeedData();

  // Chrome install is non-blocking — PDF generation becomes available once done.
  ensureBrowser().catch((err) => logger.warn({ err }, "Background browser setup failed"));
}

main().catch((err) => {
  logger.error({ err }, "Failed to start api-server");
  process.exit(1);
});

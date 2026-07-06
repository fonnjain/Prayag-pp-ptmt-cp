import { createApp } from "./app";
import { logger } from "./lib/logger";
import { ensureSeedData } from "./lib/seed";

const port = Number(process.env.PORT ?? 8080);

async function main(): Promise<void> {
  await ensureSeedData();

  const app = createApp();
  app.listen(port, "0.0.0.0", () => {
    logger.info({ port }, "api-server listening");
  });
}

main().catch((err) => {
  logger.error({ err }, "Failed to start api-server");
  process.exit(1);
});

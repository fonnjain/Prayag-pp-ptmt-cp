import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { logger } from "./logger";

export async function ensureBrowser(): Promise<void> {
  const cachePath = process.env.PUPPETEER_CACHE_DIR ?? `${process.env.HOME ?? "/home/runner"}/.cache/puppeteer`;
  const chromeDir = `${cachePath}/chrome`;
  if (existsSync(chromeDir)) {
    logger.info("Puppeteer Chrome already installed");
    return;
  }
  logger.info("Puppeteer Chrome not found — installing in background (this may take a minute)…");
  await new Promise<void>((resolve) => {
    exec(
      "npx puppeteer browsers install chrome",
      { timeout: 120_000 },
      (err, _stdout, stderr) => {
        if (err) {
          logger.warn({ err, stderr }, "Puppeteer Chrome install failed — PDF generation will be unavailable");
        } else {
          logger.info("Puppeteer Chrome installed successfully");
        }
        resolve();
      }
    );
  });
}

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { logger } from "./logger";

export async function ensureBrowser(): Promise<void> {
  const cachePath = process.env.PUPPETEER_CACHE_DIR ?? `${process.env.HOME ?? "/home/runner"}/.cache/puppeteer`;
  const chromeDir = `${cachePath}/chrome`;
  if (existsSync(chromeDir)) {
    logger.info("Puppeteer Chrome already installed");
    return;
  }
  logger.info("Puppeteer Chrome not found — installing (this may take a minute)…");
  try {
    execSync("npx puppeteer browsers install chrome", {
      stdio: "inherit",
      timeout: 120_000,
    });
    logger.info("Puppeteer Chrome installed successfully");
  } catch (err) {
    logger.warn({ err }, "Puppeteer Chrome install failed — PDF generation will be unavailable");
  }
}

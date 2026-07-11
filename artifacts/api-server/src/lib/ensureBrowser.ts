import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { logger } from "./logger";

let _ensured = false;

/**
 * Installs the Puppeteer-managed Chrome binary if it is not already present.
 * Checks for the actual executable — not just the directory — so a corrupt
 * partial download (directory created, zip corrupt) is correctly detected and
 * re-attempted. Wired into index.ts as a non-blocking background callback
 * so listen() fires first.
 */
export async function ensureBrowser(): Promise<void> {
  if (_ensured) return;
  _ensured = true;

  const cacheRoot =
    process.env.PUPPETEER_CACHE_DIR ??
    path.join(process.env.HOME ?? "/root", ".cache", "puppeteer");

  // Check for the actual chrome binary, not just the directory.
  // Puppeteer extracts to: <cacheRoot>/chrome/linux-<ver>/chrome-linux64/chrome
  const chromeBinGlob = path.join(cacheRoot, "chrome");
  const executableExists = (() => {
    try {
      // Walk up to 4 levels deep to find the `chrome` binary
      const { execFileSync: ef } = require("node:child_process") as typeof import("node:child_process");
      const result = ef("find", [chromeBinGlob, "-maxdepth", "4", "-type", "f", "-name", "chrome"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }) as string;
      return result.trim().length > 0;
    } catch {
      return false;
    }
  })();

  if (executableExists) {
    logger.info({ cacheRoot }, "Chrome already installed — skipping");
    return;
  }

  // Remove any partial directory that would cause the installer to bail.
  try {
    execFileSync("rm", ["-rf",
      path.join(cacheRoot, "chrome", "linux-*"),
      path.join(cacheRoot, "chrome", "*.zip"),
    ], { stdio: "ignore" });
  } catch {
    // best-effort cleanup
  }

  const installScript =
    "/home/runner/workspace/node_modules/.pnpm/puppeteer@23.11.1_typescript@5.9.3/node_modules/puppeteer/install.mjs";

  if (existsSync(installScript)) {
    logger.info("Chrome not found — installing via puppeteer install.mjs …");
    try {
      execFileSync("node", [installScript], {
        stdio: "pipe",
        timeout: 3 * 60 * 1000,
        env: { ...process.env, PUPPETEER_CACHE_DIR: cacheRoot },
      });
      logger.info("Chrome install complete");
      return;
    } catch (err) {
      logger.warn({ err }, "install.mjs failed — trying npx fallback");
    }
  }

  // Fallback: npx puppeteer browsers install chrome
  logger.info("Trying npx puppeteer browsers install chrome …");
  try {
    execFileSync("npx", ["puppeteer", "browsers", "install", "chrome"], {
      stdio: "pipe",
      timeout: 3 * 60 * 1000,
      cwd: "/home/runner/workspace",
      env: { ...process.env, PUPPETEER_CACHE_DIR: cacheRoot },
    });
    logger.info("Chrome install complete (npx)");
  } catch (err) {
    logger.error({ err }, "Chrome install failed — PDF export will be unavailable");
  }
}

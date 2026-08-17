/**
 * Centralised Puppeteer browser launcher for all PDF export routes.
 *
 * Why this exists:
 *  - protocolTimeout: 120_000 — prevents "Page.addScriptToEvaluateOnNewDocument timed out"
 *    in production containers where Chrome starts slowly (default protocolTimeout is 30 s,
 *    which the container regularly exceeds).
 *  - --disable-dev-shm-usage — prevents Chrome crashes when /dev/shm is too small
 *    (the default 64 MB is shared across all processes in Replit's container).
 *  - --disable-gpu / --no-zygote — further stability in headless-container environments.
 *
 * Every puppeteer.launch() call in the codebase MUST go through this function so that
 * any future tuning only needs to happen in one place.
 */
export async function launchBrowser() {
  const puppeteer = (await import("puppeteer")).default;
  return puppeteer.launch({
    headless: true,
    protocolTimeout: 120_000,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-zygote",
    ],
  });
}

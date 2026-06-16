import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
import { pullData, setSanityOnLatestBatch, getLatestBatchId } from "./ingestion";
import { runSanity } from "./sanity";
import { runCoverageReview } from "./coverage";

// Automatic work-hours data sync. Designed for the always-on Reserved VM
// deployment: a single long-lived process where an in-memory timer is reliable.
// On autoscale (scales to zero, multiple instances) it simply won't fire when
// idle — same effect as today's manual-only sync, so it is safe either way.
//
// What it does on each scheduled slot: pull ALL configured sources for both
// divisions for the CURRENT calendar month, then run + persist the data sanity
// check. What it deliberately does NOT do: acknowledge sanity warnings or build
// plans. Those stay human decisions (the buffer multiplier is always user input
// and warnings must be reviewed before planning), so auto-sync only refreshes
// data and surfaces the verdict.

const DIVISIONS = ["PTMT", "CP"] as const;

// Work hours in India (the planners' timezone). Every 3 hours, 09:00–18:00 IST.
const TZ = "Asia/Kolkata";
const SYNC_HOURS_IST = [9, 12, 15, 18];

// Fire within this many minutes after the top of a scheduled hour. The tick runs
// once a minute, so this is just slack against missed/slow ticks.
const SLOT_WINDOW_MIN = 9;

// Fixed key for the cross-instance advisory lock (any stable bigint works).
const ADVISORY_LOCK_KEY = 738201;

let running = false;
let lastSlot: string | null = null;

function nowIST(): { hour: number; minute: number; ymd: string; monthFirst: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0; // some runtimes report midnight as 24
  const minute = parseInt(get("minute"), 10);
  return {
    hour,
    minute,
    ymd: `${year}-${month}-${day}`,
    monthFirst: `${year}-${month}-01`,
  };
}

async function runSync(reason: string): Promise<void> {
  if (running) {
    logger.warn({ reason }, "scheduler: previous sync still running, skipping");
    return;
  }
  running = true;
  const { monthFirst } = nowIST();

  // Cross-instance guard. The in-memory `running`/`lastSlot` flags only protect a
  // single process; a Postgres session advisory lock (held on one dedicated
  // connection for the whole sync) ensures that even if more than one instance
  // is live — e.g. on autoscale — exactly one performs the pull per slot.
  const client = await pool.connect();
  try {
    const res = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [ADVISORY_LOCK_KEY],
    );
    if (!res.rows[0]?.locked) {
      logger.info({ reason }, "scheduler: another instance holds the sync lock, skipping");
      return;
    }
    await doSync(reason, monthFirst);
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]);
    } catch (err) {
      logger.warn({ err }, "scheduler: advisory unlock failed");
    }
    client.release();
    running = false;
  }
}

async function doSync(reason: string, monthFirst: string): Promise<void> {
  logger.info({ reason, monthFirst }, "scheduler: sync started");
  try {
    for (const division of DIVISIONS) {
      try {
        const outcome = await pullData(division, monthFirst, "scheduler", undefined);
        const batchId = await getLatestBatchId(division, monthFirst);
        const sanity = await runSanity(division, monthFirst, batchId, outcome.diags);
        await setSanityOnLatestBatch(division, monthFirst, sanity.verdict, sanity.summary, {
          model: sanity.model,
          tier: sanity.tier,
          downgraded: sanity.downgraded,
        });
        // Advisory fuzzy-coverage pass (best-effort; never affects the gate).
        await runCoverageReview(division, monthFirst, outcome.diags);
        logger.info(
          { division, monthFirst, verdict: sanity.verdict, noChange: outcome.noChange },
          "scheduler: division sync done",
        );
      } catch (err) {
        // One division's failure (e.g. a transient Sheets error) must not abort
        // the other. The next slot will retry.
        logger.error({ err, division, monthFirst }, "scheduler: division sync failed");
      }
    }
  } finally {
    logger.info({ monthFirst }, "scheduler: sync finished");
  }
}

export function startScheduler(): void {
  if (process.env["DISABLE_SCHEDULER"] === "1") {
    logger.info("scheduler: disabled via DISABLE_SCHEDULER=1");
    return;
  }
  setInterval(() => {
    const { hour, minute, ymd } = nowIST();
    if (!SYNC_HOURS_IST.includes(hour)) return;
    if (minute > SLOT_WINDOW_MIN) return;
    const slot = `${ymd}:${String(hour).padStart(2, "0")}`;
    if (lastSlot === slot) return; // already fired this slot
    lastSlot = slot;
    void runSync(`schedule ${slot} IST`);
  }, 60_000).unref?.();
  logger.info({ hoursIST: SYNC_HOURS_IST, tz: TZ }, "scheduler: started");
}

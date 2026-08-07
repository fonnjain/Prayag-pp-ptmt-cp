// Manual verification for task: month-end workbook pre-check.
// Simulates three clock states and prints the resulting sync-source rows:
//  1. day 25, next month missing (Sep 2026 files don't exist yet) → error naming pattern
//  2. day 25, next month exists  (July 25 → Aug 2026 files exist) → success
//  3. real clock (before day 25) → gate message, no Drive calls
import { db, syncSourcesTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { syncNextMonthWorkbookReadiness } from "../routes/sync";

const IDS = ["nextWorkbook_PTMT", "nextWorkbook_PTMT-Machine", "nextWorkbook_Plumbing"];

async function dump(label: string) {
  const rows = await db.select().from(syncSourcesTable).where(inArray(syncSourcesTable.id, IDS));
  console.log(`\n=== ${label} ===`);
  for (const r of rows.sort((a, b) => a.id.localeCompare(b.id))) {
    console.log(`${r.id} [${r.status}] ${r.name}\n   ${r.message}`);
  }
}

async function main() {
  await syncNextMonthWorkbookReadiness(new Date("2026-08-25T12:00:00Z"));
  await dump("day 25, next month = 2026-09 (expect errors naming title pattern)");

  await syncNextMonthWorkbookReadiness(new Date("2026-07-25T12:00:00Z"));
  await dump("day 25, next month = 2026-08 (expect success — Aug files exist)");

  await syncNextMonthWorkbookReadiness();
  await dump("real clock (expect day-25 gate message)");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

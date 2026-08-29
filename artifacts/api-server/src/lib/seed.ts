import { readFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { eq } from "drizzle-orm";
import { db, bufferCategoriesTable, itemMasterTable, syncSourcesTable, plantConfigsTable, plantSourceConfigsTable, weeklyReleaseBandsTable, plumbingMachineCapacityTable, correctivePlanRunsTable, uploadedFilesTable } from "@workspace/db";
import { logger } from "./logger";
import { SHEET_LABELS, normalizeCode, normalizeColour } from "./sheets";
import { seedBootstrapAdmins } from "./user-auth";
import { parseRateListRows, RATE_LIST_UPLOAD_KIND } from "./rate-list";

const DEFAULT_BUFFER_CATEGORIES: { name: string; multiplier: number }[] = [
  { name: "Cocks Standard", multiplier: 1.5 },
  { name: "Cocks Premium", multiplier: 1.2 },
  { name: "Faucets & Jetsprays & Shower", multiplier: 1.5 },
  { name: "Accessorise", multiplier: 1.5 },
  { name: "Cistern & Seat Cover", multiplier: 1.2 },
  { name: "Cabinet", multiplier: 1.2 },
  { name: "Ball Cock", multiplier: 1.5 },
];

function findSeedCsvPath(): string {
  const candidates = [
    path.resolve(process.cwd(), "lib/db/seed-data/item_master.csv"),
    path.resolve(process.cwd(), "../../lib/db/seed-data/item_master.csv"),
  ];
  for (const candidate of candidates) {
    try {
      readFileSync(candidate, "utf-8");
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error(`item_master.csv seed data not found. Tried: ${candidates.join(", ")}`);
}

function parseItemMasterCsv(csv: string): { category: string; itemCode: string; colour: string }[] {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const [, ...rows] = lines;
  return rows.map((line) => {
    const [category, itemCode, colour] = line.split(",");
    return {
      category: category.trim(),
      itemCode: normalizeCode(itemCode),
      colour: normalizeColour(colour),
    };
  }).filter((row) => !(row.category === "Cocks Standard" && row.itemCode === "186"));
}

function findRateListCsvPath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), "attached_assets/prayag_rate_list_codes_1787993531227.csv"),
    path.resolve(process.cwd(), "../../attached_assets/prayag_rate_list_codes_1787993531227.csv"),
  ];
  for (const candidate of candidates) {
    try {
      readFileSync(candidate, "utf-8");
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

async function seedRateList(): Promise<void> {
  const existing = await db.select({ id: uploadedFilesTable.id })
    .from(uploadedFilesTable)
    .where(eq(uploadedFilesTable.kind, RATE_LIST_UPLOAD_KIND))
    .limit(1);
  if (existing.length > 0) return;
  const csvPath = findRateListCsvPath();
  if (!csvPath) {
    logger.warn("Rate-list seed CSV not found; upload it from the Data page to enable governed PTMT roster coverage");
    return;
  }
  const workbook = XLSX.read(readFileSync(csvPath, "utf-8"), { type: "string" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]!];
  if (!sheet) throw new Error(`Rate-list seed CSV has no worksheet: ${csvPath}`);
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  const rows = parseRateListRows(rawRows).map((row) => ({
    source_tab: row.sourceTab,
    code: row.code,
    name: row.name,
    range: row.range,
    range_name: row.rangeName,
  }));
  await db.insert(uploadedFilesTable).values({
    kind: RATE_LIST_UPLOAD_KIND,
    filename: "prayag_rate_list_codes.csv",
    rowCount: rows.length,
    rows,
  });
  logger.info({ count: rows.length, csvPath }, "Seeded governed PTMT rate list");
}

async function seedBufferCategories(): Promise<void> {
  const existing = await db.select({ id: bufferCategoriesTable.id }).from(bufferCategoriesTable).limit(1);
  if (existing.length > 0) return;
  await db.insert(bufferCategoriesTable).values(DEFAULT_BUFFER_CATEGORIES);
  logger.info({ count: DEFAULT_BUFFER_CATEGORIES.length }, "Seeded buffer categories");
}

async function seedItemMaster(): Promise<void> {
  const existing = await db.select({ id: itemMasterTable.id }).from(itemMasterTable).limit(1);
  if (existing.length > 0) return;
  const csvPath = findSeedCsvPath();
  const csv = readFileSync(csvPath, "utf-8");
  const rows = parseItemMasterCsv(csv);
  const batchSize = 500;
  for (let i = 0; i < rows.length; i += batchSize) {
    await db.insert(itemMasterTable).values(rows.slice(i, i + batchSize)).onConflictDoNothing();
  }
  logger.info({ count: rows.length, csvPath }, "Seeded item master");
}

async function seedSyncSources(): Promise<void> {
  // Upsert all known sources so new sheets added to SHEET_LABELS appear in
  // existing deployments without requiring a manual DB seed.
  const values = Object.entries(SHEET_LABELS).map(([id, name]) => ({
    id,
    name,
    status: "idle" as const,
    message: null,
    rows: [],
    lastSyncedAt: null,
  }));
  await db.insert(syncSourcesTable).values(values).onConflictDoNothing();
  logger.info({ count: values.length }, "Seeded sync sources");
}

const PLANT_SOURCE_CONFIGS: { month: string; fileId: string; notes: string }[] = [
  { month: "2026-01", fileId: "1w5y24k5cBzf-7a_YYWaFnk-1pCW1tyBzUlaMe2NRa00", notes: "Jan 2026 monthly master" },
  { month: "2026-02", fileId: "11f9XIS5bMMwkn6HlTI8gmNrG2VHmmUhGtCan_fPhmeI", notes: "Feb 2026 monthly master" },
  { month: "2026-03", fileId: "1wi9FQAHkJG5rksk9WravDJ6Rtuw_Ks3LNcTvQSylERU", notes: "Mar 2026 monthly master" },
  { month: "2026-05", fileId: "1uDsowSmqu8J6NSAPS2AoJBKamkzATQqdtYPONJ7VQAc", notes: "May 2026 monthly master" },
  { month: "2026-06", fileId: "170xrcWDdTMvTLSJyCw3yGBWxqOOSfZkesGWunqKr8Rw", notes: "Jun 2026 monthly master" },
  { month: "2026-07", fileId: "1xxYYRdjrVcob3a_eIU7K4RRCzXkl50KMngJ5I8T7xuk", notes: "Jul 2026 monthly master" },
];

const PLANT_CONFIGS: { month: string; workingDays: number; snapshotDate: string | null }[] = [
  { month: "2026-07", workingDays: 27, snapshotDate: "2026-07-05" },
];

async function seedPlantSourceConfigs(): Promise<void> {
  for (const cfg of PLANT_SOURCE_CONFIGS) {
    await db.insert(plantSourceConfigsTable)
      .values({ month: cfg.month, fileId: cfg.fileId, notes: cfg.notes })
      .onConflictDoNothing();
  }
  logger.info({ count: PLANT_SOURCE_CONFIGS.length }, "Seeded plant source configs");
}

async function seedPlantConfigs(): Promise<void> {
  for (const cfg of PLANT_CONFIGS) {
    await db.insert(plantConfigsTable)
      .values({
        month: cfg.month,
        workingDays: cfg.workingDays,
        shiftsPerDay: 2,
        shiftHours: 12,
        snapshotDate: cfg.snapshotDate,
        thresholdsJson: {},
      })
      .onConflictDoNothing();
  }
  logger.info({ count: PLANT_CONFIGS.length }, "Seeded plant configs");
}

const DEFAULT_WEEKLY_RELEASE_BANDS: {
  segment?: string;
  categoryName: string;
  w1Upper: number;
  w2Upper: number;
  w3Upper: number;
  w4Upper: number;
}[] = [
  { categoryName: "Cocks Standard",             w1Upper: 0.1, w2Upper: 0.3, w3Upper: 0.8, w4Upper: 5.9 },
  { categoryName: "Cocks Premium",              w1Upper: 0.3, w2Upper: 0.5, w3Upper: 0.8, w4Upper: 3.0 },
  { categoryName: "Faucets & Jetsprays & Shower", w1Upper: 0.3, w2Upper: 0.5, w3Upper: 0.8, w4Upper: 5.0 },
  { categoryName: "Accessorise",               w1Upper: 0.3, w2Upper: 0.5, w3Upper: 0.8, w4Upper: 1.5 },
  { categoryName: "Cistern & Seat Cover",       w1Upper: 0.3, w2Upper: 0.5, w3Upper: 0.8, w4Upper: 1.5 },
  { categoryName: "Cabinet",                   w1Upper: 0.1, w2Upper: 0.3, w3Upper: 0.8, w4Upper: 5.9 },
  { categoryName: "Ball Cock",                 w1Upper: 0.1, w2Upper: 0.3, w3Upper: 0.8, w4Upper: 5.9 },
];

// Plumbing weekly release bands: W1 < 0.3 ≤ W2 < 0.5 ≤ W3 < 0.8 ≤ W4 < 99.
// All 12 Plumbing categories share the same thresholds (uniform priority ranking).
// W4 upper = 99 so items with high cover (even many months of stock) are still scheduled.
const PLUMBING_WEEKLY_RELEASE_BANDS: {
  segment: string;
  categoryName: string;
  w1Upper: number;
  w2Upper: number;
  w3Upper: number;
  w4Upper: number;
}[] = [
  "CPVC Pipe", "CPVC Fitting", "CPVC Solvent",
  "UPVC Pipe", "UPVC Fitting", "UPVC Solvent",
  "SWR Pipe",  "SWR Fitting",  "SWR Solvent",
  "AGRI Pipe", "AGRI Fitting", "AGRI Solvent",
].map((categoryName) => ({
  segment: "Plumbing",
  categoryName,
  w1Upper: 0.3,
  w2Upper: 0.5,
  w3Upper: 0.8,
  w4Upper: 99.0,
}));

async function seedWeeklyReleaseBands(): Promise<void> {
  for (const band of DEFAULT_WEEKLY_RELEASE_BANDS) {
    await db
      .insert(weeklyReleaseBandsTable)
      .values(band)
      .onConflictDoNothing();
  }
  for (const band of PLUMBING_WEEKLY_RELEASE_BANDS) {
    await db
      .insert(weeklyReleaseBandsTable)
      .values(band)
      .onConflictDoNothing();
  }
  logger.info(
    { ptmt: DEFAULT_WEEKLY_RELEASE_BANDS.length, plumbing: PLUMBING_WEEKLY_RELEASE_BANDS.length },
    "Seeded weekly release bands",
  );
}

/**
 * Idempotent upsert of overrideMultiplier for all 7 PTMT categories.
 * Runs every boot so the business-specified values are always locked in,
 * even after a DB reset or fresh deployment.
 *
 * IMPORTANT: these are the ONLY multipliers that may enter the plan.
 * suggestedMultiplier (from the seasonality engine) is advisory only
 * and must never auto-apply — it is displayed for human review and acceptance.
 */
const PTMT_BUSINESS_OVERRIDES: { name: string; multiplier: number }[] = [
  { name: "Cocks Standard",               multiplier: 1.5 },
  { name: "Cocks Premium",                multiplier: 1.2 },
  { name: "Faucets & Jetsprays & Shower", multiplier: 1.5 },
  { name: "Accessorise",                  multiplier: 1.5 },
  { name: "Cistern & Seat Cover",         multiplier: 1.2 },
  { name: "Cabinet",                      multiplier: 1.2 },
  { name: "Ball Cock",                    multiplier: 1.5 },
];

async function seedPtmtOverrides(): Promise<void> {
  for (const { name, multiplier } of PTMT_BUSINESS_OVERRIDES) {
    await db
      .update(bufferCategoriesTable)
      .set({ overrideMultiplier: multiplier, multiplier })
      .where(eq(bufferCategoriesTable.name, name));
  }
  logger.info({ count: PTMT_BUSINESS_OVERRIDES.length }, "Seeded PTMT business overrides");
}

type MachineRow = {
  pool: string;
  machineId: string;
  label: string;
  shiftsPerDay: number;
  hoursPerShift: number;
  workingDays: number;
  rates: Record<string, number>;
  lockedOut: boolean;
};

const PLUMBING_PIPE_MACHINES: MachineRow[] = [
  { pool: "PIPE", machineId: "MC1", label: "M/C-1 (CPVC dedicated)", shiftsPerDay: 2, hoursPerShift: 10, workingDays: 25, rates: { CPVC: 145.6 }, lockedOut: false },
  { pool: "PIPE", machineId: "MC2", label: "M/C-2 (CPVC dedicated)", shiftsPerDay: 2, hoursPerShift: 10, workingDays: 25, rates: { CPVC: 145.6 }, lockedOut: false },
  { pool: "PIPE", machineId: "MC3", label: "M/C-3 (Flex)",           shiftsPerDay: 2, hoursPerShift: 10, workingDays: 25, rates: { CPVC: 145.6, UPVC: 250, SWR: 295, AGRI: 300 }, lockedOut: false },
  { pool: "PIPE", machineId: "MC4", label: "M/C-4 (Flex)",           shiftsPerDay: 2, hoursPerShift: 10, workingDays: 25, rates: { CPVC: 145.6, UPVC: 250, SWR: 295, AGRI: 300 }, lockedOut: false },
  { pool: "PIPE", machineId: "MC5", label: "M/C-5 (Flex UPVC/AGRI)", shiftsPerDay: 2, hoursPerShift: 10, workingDays: 25, rates: { UPVC: 250, AGRI: 300 }, lockedOut: false },
  { pool: "PIPE", machineId: "MC6", label: "M/C-6 (UPVC dedicated)", shiftsPerDay: 2, hoursPerShift: 10, workingDays: 25, rates: { UPVC: 250 }, lockedOut: false },
  { pool: "PIPE", machineId: "MC7", label: "M/C-7 (Locked out)",     shiftsPerDay: 2, hoursPerShift: 10, workingDays: 25, rates: {}, lockedOut: true },
  { pool: "PIPE", machineId: "MC8", label: "M/C-8 (Locked out)",     shiftsPerDay: 2, hoursPerShift: 10, workingDays: 25, rates: {}, lockedOut: true },
  { pool: "PIPE", machineId: "MC9", label: "M/C-9 (SWR dedicated)",  shiftsPerDay: 2, hoursPerShift: 10, workingDays: 25, rates: { SWR: 295 }, lockedOut: false },
];

const PLUMBING_MOULDING_RATES: [string, number][] = [
  ["D01", 22.8], ["B02", 14.5], ["D02", 14.4], ["D06", 14.2], ["C01", 14.1],
  ["B01", 13.5], ["C07", 13.5], ["D07", 12.6], ["C05", 12.6], ["C06", 11.2],
  ["C02", 11.0], ["C04", 10.2], ["B03",  8.1], ["B06",  7.7], ["D03",  7.7],
  ["A02",  7.0], ["D05",  6.9], ["A03",  6.4], ["B04",  6.4], ["A05",  4.9],
  ["B05",  4.8], ["A06",  3.9], ["A01",  1.8], ["A04",  1.7],
];

const PLUMBING_MOULDING_MACHINES: MachineRow[] = PLUMBING_MOULDING_RATES.map(([id, rate]) => ({
  pool: "MOULDING",
  machineId: id,
  label: `MOULD-${id}`,
  shiftsPerDay: 2,
  hoursPerShift: 10,
  workingDays: 25,
  rates: { ALL: rate },
  lockedOut: false,
}));

async function seedPlumbingMachines(): Promise<void> {
  const allMachines = [...PLUMBING_PIPE_MACHINES, ...PLUMBING_MOULDING_MACHINES];
  let seeded = 0;
  for (const m of allMachines) {
    const result = await db
      .insert(plumbingMachineCapacityTable)
      .values({ segment: "Plumbing", ...m })
      .onConflictDoNothing()
      .returning({ id: plumbingMachineCapacityTable.id });
    if (result.length > 0) seeded++;
  }
  if (seeded > 0) logger.info({ seeded, total: allMachines.length }, "Seeded Plumbing machine capacity rows");
}

/**
 * Pin known regression-golden corrective runs so they cannot be accidentally
 * deleted by the plant. This is idempotent — safe to run on every startup.
 *
 * PTMT run #101 is the PTMT regression golden (July 2026 W3-closed reference).
 * Add further IDs here as new goldens are recorded.
 */
const GOLDEN_CORRECTIVE_RUN_IDS = [101];

async function seedPinnedCorrectiveRuns(): Promise<void> {
  for (const id of GOLDEN_CORRECTIVE_RUN_IDS) {
    const result = await db
      .update(correctivePlanRunsTable)
      .set({ pinned: true })
      .where(eq(correctivePlanRunsTable.id, id))
      .returning({ id: correctivePlanRunsTable.id });
    if (result.length > 0) {
      logger.info({ runId: id }, "Pinned corrective golden run");
    }
    // If result.length === 0, the run doesn't exist yet in this environment —
    // that is expected in fresh dev/CI databases and not an error.
  }
}

export async function ensureSeedData(): Promise<void> {
  await seedBootstrapAdmins();
  await seedBufferCategories();
  await seedItemMaster();
  await seedRateList();
  await seedSyncSources();
  await seedPlantSourceConfigs();
  await seedPlantConfigs();
  await seedWeeklyReleaseBands();
  await seedPtmtOverrides();
  const { seedCategoryCapacity } = await import("./capacity-engine");
  await seedCategoryCapacity();
  await seedPlumbingMachines();
  await seedPinnedCorrectiveRuns();
}

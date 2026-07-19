import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, bufferCategoriesTable, itemMasterTable, syncSourcesTable, plantConfigsTable, plantSourceConfigsTable, weeklyReleaseBandsTable } from "@workspace/db";
import { logger } from "./logger";
import { SHEET_LABELS } from "./sheets";

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
    return { category: category.trim(), itemCode: itemCode.trim(), colour: colour.trim() };
  });
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
  { month: "2025-06", fileId: "1AGmksx4gn6w0Wb9EF__yAV5v89IyAfX_f75ouW2c7Yw", notes: "PTMT ANUJ Production" },
  { month: "2026-03", fileId: "1AGmksx4gn6w0Wb9EF__yAV5v89IyAfX_f75ouW2c7Yw", notes: "PTMT ANUJ Production" },
  { month: "2026-05", fileId: "1AGmksx4gn6w0Wb9EF__yAV5v89IyAfX_f75ouW2c7Yw", notes: "PTMT ANUJ Production" },
  { month: "2026-06", fileId: "1AGmksx4gn6w0Wb9EF__yAV5v89IyAfX_f75ouW2c7Yw", notes: "PTMT ANUJ Production" },
  { month: "2026-07", fileId: "1AGmksx4gn6w0Wb9EF__yAV5v89IyAfX_f75ouW2c7Yw", notes: "PTMT ANUJ Production" },
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

export async function ensureSeedData(): Promise<void> {
  await seedBufferCategories();
  await seedItemMaster();
  await seedSyncSources();
  await seedPlantSourceConfigs();
  await seedPlantConfigs();
  await seedWeeklyReleaseBands();
  await seedPtmtOverrides();
  const { seedCategoryCapacity } = await import("./capacity-engine");
  await seedCategoryCapacity();
}

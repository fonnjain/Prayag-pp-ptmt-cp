import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { db, bufferCategoriesTable, itemMasterTable, syncSourcesTable } from "@workspace/db";
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findSeedCsvPath(): string {
  const candidates = [
    path.resolve(__dirname, "../../../../lib/db/seed-data/item_master.csv"),
    path.resolve(process.cwd(), "../../lib/db/seed-data/item_master.csv"),
    path.resolve(process.cwd(), "lib/db/seed-data/item_master.csv"),
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
  const existing = await db.select({ id: syncSourcesTable.id }).from(syncSourcesTable).limit(1);
  if (existing.length > 0) return;
  const values = Object.entries(SHEET_LABELS).map(([id, name]) => ({
    id,
    name,
    status: "idle" as const,
    message: null,
    rows: [],
    lastSyncedAt: null,
  }));
  await db.insert(syncSourcesTable).values(values);
  logger.info({ count: values.length }, "Seeded sync sources");
}

export async function ensureSeedData(): Promise<void> {
  await seedBufferCategories();
  await seedItemMaster();
  await seedSyncSources();
}

/**
 * One-time historical seeder for June 2026.
 *
 * This script intentionally reads actuals only:
 *   - PTMT from the immutable plant_ingestion_cache row.
 *   - Plumbing from Sheet3 daily production rows.
 *
 * It must never call buildPlanItems or read a June plan workbook. Once the
 * rows are persisted, the report engine reads plant_month_snapshots and never
 * reaches a live workbook for June.
 *
 * Run from the repository root:
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/seed-june-actuals-only.ts
 */

import { eq } from "drizzle-orm";
import {
  db,
  plantIngestionCacheTable,
  plantMonthSnapshotsTable,
} from "@workspace/db";
import { fetchPlumbingSheet3Production } from "../lib/sheets";

const MONTH = "2026-06";
const ARCHIVE_COMMIT = "021ab789a46be03c1fb5b534009af9b611df235c";
const REASON =
  "No finalized plan for June 2026 — plan reconstruction was attempted and rejected.";

type ActualRow = {
  itemCode: string;
  colour: string;
  category: string | null;
  weeks: [number, number, number, number];
  totalProduction: number;
};

function weekIndex(date: string): 0 | 1 | 2 | 3 {
  const day = Number(date.slice(8, 10));
  return day <= 7 ? 0 : day <= 14 ? 1 : day <= 21 ? 2 : 3;
}

function aggregate(
  rows: Array<{ date: string; itemCode: string; colour?: string; qty: number }>,
) {
  const byKey = new Map<string, ActualRow>();
  const weeklyProduction: [number, number, number, number] = [0, 0, 0, 0];
  let lastDataDate: string | null = null;

  for (const row of rows) {
    if (!row.date.startsWith(`${MONTH}-`) || row.qty <= 0) continue;
    const colour = row.colour ?? "";
    const key = `${row.itemCode}::${colour}`;
    const existing = byKey.get(key) ?? {
      itemCode: row.itemCode,
      colour,
      category: null,
      weeks: [0, 0, 0, 0],
      totalProduction: 0,
    };
    const week = weekIndex(row.date);
    existing.weeks[week] += row.qty;
    existing.totalProduction += row.qty;
    byKey.set(key, existing);
    weeklyProduction[week] += row.qty;
    if (!lastDataDate || row.date > lastDataDate) lastDataDate = row.date;
  }

  return {
    kind: "actuals_only" as const,
    sourceRowCount: rows.length,
    lastDataDate,
    weeklyProduction,
    totalProduction: weeklyProduction.reduce((sum, value) => sum + value, 0),
    attainmentPct: null,
    linearityIndex: null,
    rows: [...byKey.values()].sort((a, b) => b.totalProduction - a.totalProduction),
  };
}

async function upsertSnapshot(
  segment: "PTMT" | "Plumbing",
  payload: ReturnType<typeof aggregate>,
  source: string,
) {
  await db
    .insert(plantMonthSnapshotsTable)
    .values({
      month: MONTH,
      segment,
      payloadJson: payload,
      sourcePlanVersionsJson: [],
      closedAt: new Date("2026-07-01T00:00:00.000Z"),
      capturedCommitSha: ARCHIVE_COMMIT,
      backfilled: true,
      planStatus: "actuals_only",
      planStatusReason: REASON,
      planEvidenceJson: {
        archiveCommit: ARCHIVE_COMMIT,
        archivePath: "scripts/data/june-2026-plan-archive-2026-08-21/",
        source,
        planRuntimeSource: "none",
      },
    })
    .onConflictDoUpdate({
      target: [plantMonthSnapshotsTable.month, plantMonthSnapshotsTable.segment],
      set: {
        payloadJson: payload,
        capturedCommitSha: ARCHIVE_COMMIT,
        backfilled: true,
        planStatus: "actuals_only",
        planStatusReason: REASON,
        planEvidenceJson: {
          archiveCommit: ARCHIVE_COMMIT,
          archivePath: "scripts/data/june-2026-plan-archive-2026-08-21/",
          source,
          planRuntimeSource: "none",
        },
      },
    });
}

async function main() {
  const [cached] = await db
    .select()
    .from(plantIngestionCacheTable)
    .where(eq(plantIngestionCacheTable.month, MONTH))
    .limit(1);
  if (!cached || !Array.isArray(cached.rawActualsJson)) {
    throw new Error(`Missing immutable PTMT ingestion cache for ${MONTH}`);
  }

  const ptmt = aggregate(
    cached.rawActualsJson.map((row: any) => ({
      date: String(row.date),
      itemCode: String(row.itemCode),
      colour: String(row.colour ?? ""),
      qty: Number(row.qty),
    })),
  );
  if (ptmt.totalProduction !== 933653) {
    throw new Error(`PTMT June actual total changed: expected 933653, got ${ptmt.totalProduction}`);
  }
  if (ptmt.sourceRowCount !== 2234) {
    throw new Error(`PTMT June source row count changed: expected 2234, got ${ptmt.sourceRowCount}`);
  }
  await upsertSnapshot("PTMT", ptmt, "plant_ingestion_cache:2026-06");

  const plumbingRows = await fetchPlumbingSheet3Production(MONTH);
  const plumbing = aggregate(
    plumbingRows.map((row) => ({
      date: row.dateStr,
      itemCode: row.rawCode,
      qty: row.qty,
    })),
  );
  if (plumbing.totalProduction !== 1463741) {
    throw new Error(`Plumbing June actual total changed: expected 1463741, got ${plumbing.totalProduction}`);
  }
  if (plumbing.sourceRowCount !== 820) {
    throw new Error(`Plumbing June source row count changed: expected 820, got ${plumbing.sourceRowCount}`);
  }
  await upsertSnapshot("Plumbing", plumbing, "Plumbing Sheet3 actuals captured once");

  console.log(JSON.stringify({
    month: MONTH,
    reason: REASON,
    ptmt: { totalProduction: ptmt.totalProduction, rows: ptmt.rows.length },
    plumbing: { totalProduction: plumbing.totalProduction, rows: plumbing.rows.length },
  }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
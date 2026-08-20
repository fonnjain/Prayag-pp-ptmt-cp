/**
 * Unit tests for buildCorrectiveDetailExcel — legacy advisory branch.
 *
 * NC22g (regression suite) skips when every PTMT corrective run in the DB has
 * frozenPlanGrandMax populated.  These tests exercise the same code path
 * directly so the advisory-text check is never environment-dependent.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { buildCorrectiveDetailExcel } from "./corrective.js";

// ── Minimal mock helpers ────────────────────────────────────────────────────

/**
 * Minimal corrective run row.  Only the fields accessed by
 * buildCorrectiveDetailExcel are required; the rest are left as null/0.
 */
function makeMockRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    segment: "PTMT",
    month: "2026-07",
    weekClosed: 0,
    asOfDate: "2026-07-15",
    note: null,
    dailyCapacity: 5000,
    workingDaysPerWeek: 6,
    workingDaysRemaining: null,
    producedToDate: 0,
    newOrdersQty: 0,
    originalMonthTotal: 800,
    revisedMonthTotal: 1000,
    unfulfillableQty: 0,
    planRunId: null,
    frozenPlanGrandMax: null,
    pinned: false,
    categoriesJson: null,   // null → hasEngineCats = false (legacy path)
    weekStatsJson: null,
    warningsJson: null,
    createdAt: new Date("2026-07-15T10:00:00Z"),
    ...overrides,
  } as unknown as Parameters<typeof buildCorrectiveDetailExcel>[0];
}

/**
 * Minimal corrective item row.  Only the fields accessed inside the function
 * body are provided; unknown fields are zeroed so ExcelJS writes numbers.
 */
function makeMockItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    runId: 1,
    category: "CPVC Pipe",
    itemCode: "TEST001",
    colour: "GREY",
    avg3MoSale: 200,
    bufferMultiplier: 1.5,
    stockOpen: 0,
    producedToDate: 100,
    stockNow: 20,
    pendingAtPlan: 50,
    pendingNow: 50,
    pendingLastMonth: 30,
    originalPlan: 400,
    originalWeek: 1,
    bufferReqRev: 150,
    planRev: 500,
    remainingToProduce: 400,
    deltaNewOrders: 0,
    deltaProduction: 0,
    deltaNet: 0,
    coverNow: null,
    newWeek: null,
    w1Rev: 0,
    w2Rev: 0,
    w3Rev: 0,
    w4Rev: 0,
    status: "on-plan",
    isNewItem: 0,
    ...overrides,
  } as unknown as Parameters<typeof buildCorrectiveDetailExcel>[1][number];
}

// ── Helper: parse the generated buffer and extract the Summary sheet rows ──

async function parseSummarySheet(buf: Buffer): Promise<Map<string, unknown>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const sh = wb.getWorksheet("Summary");
  assert.ok(sh, "Summary worksheet must exist in the output workbook");
  const map = new Map<string, unknown>();
  sh.eachRow({ includeEmpty: false }, (row) => {
    const key = String(row.getCell(1).value ?? "").trim();
    if (key) map.set(key, row.getCell(2).value);
  });
  return map;
}

// ── Tests ──────────────────────────────────────────────────────────────────

test("buildCorrectiveDetailExcel — legacy run: advisory text present in Baseline Plan Run cell", async () => {
  // Arrange — planRunId is set but frozenPlanGrandMax is null (legacy run)
  const run = makeMockRun({ planRunId: 42, frozenPlanGrandMax: null });
  const items = [
    makeMockItem({ originalPlan: 400, planRev: 500 }),
    makeMockItem({ itemCode: "TEST002", originalPlan: 400, planRev: 500 }),
  ];

  // Act
  const buf = await buildCorrectiveDetailExcel(run, items, [], "PTMT");

  // Assert — the Summary sheet must contain the advisory string
  const rows = await parseSummarySheet(buf);
  const baselineCell = String(rows.get("Baseline Plan Run") ?? "");

  assert.ok(
    baselineCell.includes("frozen plan total not recorded for this run"),
    `"Baseline Plan Run" cell must contain the advisory text.\n` +
    `  Got: "${baselineCell}"`,
  );
  assert.ok(
    baselineCell.startsWith("#42"),
    `"Baseline Plan Run" cell must reference plan run #42.\n` +
    `  Got: "${baselineCell}"`,
  );
});

test("buildCorrectiveDetailExcel — legacy run: Revised Month Total is positive", async () => {
  // Arrange — two items each contributing 500 pcs to the revised plan
  const run = makeMockRun({ planRunId: 42, frozenPlanGrandMax: null });
  const items = [
    makeMockItem({ planRev: 500 }),
    makeMockItem({ itemCode: "TEST002", planRev: 500 }),
  ];
  const expectedTotal = 1000; // sum(Math.round(500) + Math.round(500))

  // Act
  const buf = await buildCorrectiveDetailExcel(run, items, [], "PTMT");

  // Assert — "Revised Month Total" row must be a non-zero number
  const rows = await parseSummarySheet(buf);
  const rawVal = rows.get("Revised Month Total");
  assert.equal(
    typeof rawVal,
    "number",
    `"Revised Month Total" cell must be numeric; got ${typeof rawVal} ("${rawVal}")`,
  );
  assert.equal(rawVal, expectedTotal, `"Revised Month Total" must equal ${expectedTotal}`);
  assert.ok((rawVal as number) > 0, `"Revised Month Total" must be > 0; got ${rawVal}`);
});

test("buildCorrectiveDetailExcel — run with frozenPlanGrandMax: shows plan-run total, not advisory", async () => {
  // This is the non-legacy (modern) path — assert the inverse so we know the
  // test distinguishes both branches and a future collapse to one would be caught.
  const run = makeMockRun({ planRunId: 7, frozenPlanGrandMax: 850 });
  const items = [
    makeMockItem({ originalPlan: 400, planRev: 500 }),
    makeMockItem({ itemCode: "TEST002", originalPlan: 400, planRev: 500 }),
  ];

  const buf = await buildCorrectiveDetailExcel(run, items, [], "PTMT");
  const rows = await parseSummarySheet(buf);
  const baselineCell = String(rows.get("Baseline Plan Run") ?? "");

  // Modern path must NOT contain the legacy advisory text
  assert.ok(
    !baselineCell.includes("frozen plan total not recorded for this run"),
    `Modern-path run must NOT show the legacy advisory.\n  Got: "${baselineCell}"`,
  );
  // Must reference the plan run id and show both totals
  assert.ok(
    baselineCell.startsWith("#7"),
    `"Baseline Plan Run" cell must reference plan run #7.\n  Got: "${baselineCell}"`,
  );
  assert.ok(
    baselineCell.includes("plan run:"),
    `"Baseline Plan Run" cell must include "plan run:" label.\n  Got: "${baselineCell}"`,
  );
});

test("buildCorrectiveDetailExcel — no planRunId: shows live-rebuild label", async () => {
  const run = makeMockRun({ planRunId: null, frozenPlanGrandMax: null });
  const items = [makeMockItem()];

  const buf = await buildCorrectiveDetailExcel(run, items, [], "PTMT");
  const rows = await parseSummarySheet(buf);
  const baselineCell = String(rows.get("Baseline Plan Run") ?? "");

  assert.ok(
    baselineCell.includes("Live rebuild"),
    `When planRunId is null the cell must say "Live rebuild".\n  Got: "${baselineCell}"`,
  );
});

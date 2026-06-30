// Machine Roster Reconciliation for the CP Pipe & Fitting plant.
//
// For each month, reads Report-5, Report-11, and Report-12 from the per-month
// PIPE daily workbook and reconciles machine coverage against the canonical
// roster.  Results are cached in reconciliation_runs and returned on demand.
//
// Key rules (from spec):
//   - Report-5: monthly summary grid; has both pipe AND moulding sections.
//   - Report-11: pipe-only, transaction-level rows (one row per date/machine/item).
//   - Report-12: moulding-only, transaction-level rows.
//   - "Ran" = appeared in that report with output > 0.
//   - Never edits source sheets; strictly read-only.

import { db } from "@workspace/db";
import { reconciliationRuns } from "@workspace/db/schema";
import { desc, eq } from "drizzle-orm";
import { readRange } from "../lib/google";
import { logger } from "../lib/logger";
import {
  PIPE_CANONICAL,
  MOULD_CANONICAL,
  PIPE_DAILY_WORKBOOKS,
  toCanonicalKey,
} from "./roster";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MachineCoverageGroup {
  expected: string[];
  inR5: string[];
  inR11OrR12: string[];
  bothAgreeRan: string[];
  missingBoth: string[];
  r5Only: string[];
  r11OrR12Only: string[];
  unlisted: string[];
}

export interface ReconciliationResult {
  month: string;
  fileId: string;
  pipeEmpty: boolean;
  pipe: MachineCoverageGroup;
  mould: MachineCoverageGroup;
  computedAt: string;
}

// ---------------------------------------------------------------------------
// Set helpers
// ---------------------------------------------------------------------------

function diff(a: Set<string>, b: Set<string>): Set<string> {
  return new Set([...a].filter((x) => !b.has(x)));
}

function intersect(a: Set<string>, b: Set<string>): Set<string> {
  return new Set([...a].filter((x) => b.has(x)));
}

function union(a: Set<string>, b: Set<string>): Set<string> {
  return new Set([...a, ...b]);
}

// ---------------------------------------------------------------------------
// Report-5 parser
//
// Format: monthly summary grid.  Col index 2 = machine name, col index 6 =
// total output KG for the month.  Pipe machines start around row 5, moulding
// around row 34.  Skip "TOTAL" and "MACHINE" header rows.
// ---------------------------------------------------------------------------

function parseReport5(
  rows: string[][],
): { pipe: Set<string>; mould: Set<string> } {
  const pipe = new Set<string>();
  const mould = new Set<string>();

  for (const row of rows) {
    const machineRaw = String(row[2] ?? "").trim();
    if (!machineRaw || machineRaw === "MACHINE" || machineRaw === "TOTAL") continue;

    const outputKg = Number(row[6] ?? 0);
    if (!outputKg || outputKg <= 0) continue;

    const key = toCanonicalKey(machineRaw);
    if (!key) continue;

    if (key.startsWith("PIPE-")) pipe.add(key);
    else if (key.startsWith("MOULD-")) mould.add(key);
  }

  return { pipe, mould };
}

// ---------------------------------------------------------------------------
// Report-11 parser
//
// Format: transaction-level pipe rows.  Col index 1 = date (Excel serial,
// > 40000 for real rows), col index 3 = "PIPE M/C - N", col index 9 = weight
// KG.  "Ran" = appeared with weight > 0.
// ---------------------------------------------------------------------------

function parseReport11(rows: string[][]): Set<string> {
  const machines = new Set<string>();

  for (const row of rows) {
    const dateVal = Number(row[1] ?? 0);
    if (dateVal < 40000) continue;

    const machineNo = String(row[3] ?? "").trim();
    const weightKg = Number(row[9] ?? 0);
    if (weightKg <= 0) continue;

    const key = toCanonicalKey(machineNo);
    if (key?.startsWith("PIPE-")) machines.add(key);
  }

  return machines;
}

// ---------------------------------------------------------------------------
// Report-12 parser
//
// Format: transaction-level moulding rows.  Col index 0 = date (Excel serial),
// col index 4 = moulding machine like "A02(U-150)", col index 9 = weight KG.
// ---------------------------------------------------------------------------

function parseReport12(rows: string[][]): Set<string> {
  const machines = new Set<string>();

  for (const row of rows) {
    const dateVal = Number(row[0] ?? 0);
    if (dateVal < 40000) continue;

    const machineRaw = String(row[4] ?? "").trim();
    const weightKg = Number(row[9] ?? 0);
    if (weightKg <= 0) continue;

    const key = toCanonicalKey(machineRaw);
    if (key?.startsWith("MOULD-")) machines.add(key);
  }

  return machines;
}

// ---------------------------------------------------------------------------
// Reconciliation engine
// ---------------------------------------------------------------------------

function buildGroup(
  expected: string[],
  inR5: Set<string>,
  inOther: Set<string>,
  otherLabel: "r11" | "r12",
  allFoundInData: Set<string>,
): MachineCoverageGroup {
  const expectedSet = new Set(expected);
  const both = intersect(inR5, inOther);
  const missingBoth = intersect(diff(expectedSet, inR5), diff(expectedSet, inOther));
  const r5Only = diff(inR5, inOther);
  const otherOnly = diff(inOther, inR5);
  const unlisted = diff(allFoundInData, expectedSet);
  void otherLabel;

  return {
    expected,
    inR5: [...inR5].sort(),
    inR11OrR12: [...inOther].sort(),
    bothAgreeRan: [...both].sort(),
    missingBoth: [...missingBoth].sort(),
    r5Only: [...r5Only].sort(),
    r11OrR12Only: [...otherOnly].sort(),
    unlisted: [...unlisted].sort(),
  };
}

// ---------------------------------------------------------------------------
// Main: run reconciliation for one month
// ---------------------------------------------------------------------------

export async function runReconciliation(
  month: string,
): Promise<ReconciliationResult> {
  const fileId = PIPE_DAILY_WORKBOOKS[month];
  if (!fileId) throw new Error(`No PIPE daily workbook configured for ${month}`);

  logger.info({ month, fileId }, "roster-reconciliation: reading reports");

  // Read all three tabs in parallel
  const [r5Rows, r11Rows, r12Rows] = await Promise.all([
    readRange(fileId, "Report-5!A1:H100"),
    readRange(fileId, "Report-11!A1:Z2000"),
    readRange(fileId, "Report-12!A1:Z3000"),
  ]);

  const { pipe: r5Pipe, mould: r5Mould } = parseReport5(r5Rows);
  const r11Pipe = parseReport11(r11Rows);
  const r12Mould = parseReport12(r12Rows);

  const pipeEmpty = r5Pipe.size === 0 && r11Pipe.size === 0;

  const pipeAll = union(r5Pipe, r11Pipe);
  const mouldAll = union(r5Mould, r12Mould);

  const pipe = buildGroup(PIPE_CANONICAL, r5Pipe, r11Pipe, "r11", pipeAll);
  const mould = buildGroup(MOULD_CANONICAL, r5Mould, r12Mould, "r12", mouldAll);

  const result: ReconciliationResult = {
    month,
    fileId,
    pipeEmpty,
    pipe,
    mould,
    computedAt: new Date().toISOString(),
  };

  logger.info(
    {
      month,
      pipeEmpty,
      pipeInR5: r5Pipe.size,
      pipeInR11: r11Pipe.size,
      mouldInR5: r5Mould.size,
      mouldInR12: r12Mould.size,
    },
    "roster-reconciliation: done",
  );

  return result;
}

// ---------------------------------------------------------------------------
// DB: persist and retrieve
// ---------------------------------------------------------------------------

export async function persistReconciliation(
  month: string,
  result: ReconciliationResult,
): Promise<void> {
  await db.insert(reconciliationRuns).values({
    month,
    status: result.pipeEmpty ? "empty_pipe" : "ok",
    pipeEmpty: result.pipeEmpty,
    payload: result as unknown as Record<string, unknown>,
    errorMsg: null,
  });
}

export async function persistReconciliationError(
  month: string,
  err: unknown,
): Promise<void> {
  await db.insert(reconciliationRuns).values({
    month,
    status: "error",
    pipeEmpty: false,
    payload: null,
    errorMsg: err instanceof Error ? err.message : String(err),
  });
}

export async function getLatestReconciliation(
  month: string,
): Promise<ReconciliationResult | null> {
  const rows = await db
    .select()
    .from(reconciliationRuns)
    .where(eq(reconciliationRuns.month, month))
    .orderBy(desc(reconciliationRuns.createdAt))
    .limit(1);

  const row = rows[0];
  if (!row || row.status === "error") return null;
  return row.payload as unknown as ReconciliationResult;
}

// ---------------------------------------------------------------------------
// Top-level orchestrator (best-effort, never throws)
// ---------------------------------------------------------------------------

export async function runAndPersistReconciliation(
  month: string,
): Promise<void> {
  try {
    const result = await runReconciliation(month);
    await persistReconciliation(month, result);
  } catch (err) {
    logger.error({ err, month }, "roster-reconciliation: failed");
    try {
      await persistReconciliationError(month, err);
    } catch {
      // swallow
    }
  }
}

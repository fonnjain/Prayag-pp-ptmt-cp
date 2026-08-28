import { db, pendingReadBaselinesTable, pendingReadSnapshotsTable, type PendingReadSnapshot } from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { DualTotals } from "./sheets";
import { diagnoseInputRows, type InputReadDiagnostics, type PendingPlanDiagnostics } from "./input-diagnostics";

export const LIVE_PENDING_SOURCE_KIND = "pending_order_live_sheet";
export const LIVE_PENDING_SOURCE_NAME = "Pending order / report";
export const LIVE_PENDING_SOURCE_SPREADSHEET_ID = "1dmt6uHOdZSIT0wgNkSfuK8W8d0YO8STW51PVOAAFHvY";
export const LIVE_PENDING_SOURCE_TAB = "report";
export const LIVE_PENDING_INPUT_ALIASES = {
  code: ["Old ERP Code", "Item Code", "Item No."],
  colour: ["Colour", "Color", "COLOR", "COLUOR"],
  quantity: ["Bal. Qty", "Bal.Qty", "Balance Qty", "Balance_Qty"],
};

export type PendingReadCaptureContext = "plan_run" | "validation";

export type PendingReadSnapshotInput = {
  runId?: number | null;
  captureContext: PendingReadCaptureContext;
  segment: string;
  totals?: DualTotals;
  diagnostics?: InputReadDiagnostics | Record<string, unknown>;
  status?: "captured" | "failed" | "pre_read_failed";
  sourceKind?: string;
  sourceName?: string;
  sourceSpreadsheetId?: string | null;
  sourceTabName?: string | null;
  environment?: string;
  errorText?: string | null;
};

export function livePendingFailureDiagnostics(segment: string, error: unknown): InputReadDiagnostics {
  return diagnoseInputRows([], LIVE_PENDING_INPUT_ALIASES, {
    source: `${LIVE_PENDING_SOURCE_NAME} · ${segment}`,
    error: error instanceof Error ? error.message : String(error),
  });
}

export function pendingReadSnapshotValues(input: PendingReadSnapshotInput) {
  const diagnostics = input.diagnostics ?? {};
  const sourceName = input.sourceName ?? ("source" in diagnostics && typeof diagnostics.source === "string"
    ? diagnostics.source
    : `${LIVE_PENDING_SOURCE_NAME} · ${input.segment}`);
  return {
    runId: input.runId ?? null,
    captureContext: input.captureContext,
    segment: input.segment,
    sourceRole: "pending_current_live",
    sourceKind: input.sourceKind ?? LIVE_PENDING_SOURCE_KIND,
    sourceName,
    sourceSpreadsheetId: input.sourceSpreadsheetId === undefined
      ? LIVE_PENDING_SOURCE_SPREADSHEET_ID
      : input.sourceSpreadsheetId,
    sourceTabName: input.sourceTabName === undefined
      ? LIVE_PENDING_SOURCE_TAB
      : input.sourceTabName,
    environment: input.environment ?? baselineEnvironment(),
    status: input.status ?? "captured",
    rawRowsJson: input.totals?.rawRows ?? [],
    parsedRowsJson: (input.totals?.pendingRows ?? []) as unknown as Record<string, unknown>[],
    diagnosticsJson: diagnostics as Record<string, unknown>,
    errorText: input.errorText ?? null,
  };
}

export async function persistPendingReadSnapshot(input: PendingReadSnapshotInput): Promise<number> {
  const [snapshot] = await db
    .insert(pendingReadSnapshotsTable)
    .values(pendingReadSnapshotValues(input))
    .returning({ id: pendingReadSnapshotsTable.id });
  if (!snapshot) throw new Error("Pending read snapshot insert returned no row");
  return snapshot.id;
}

export type CapturedLivePendingRead =
  | { totals: DualTotals; captureId: number }
  | { totals: null; captureId: number; error: unknown };

export async function captureLivePendingRead(
  segment: string,
  captureContext: PendingReadCaptureContext,
  read: () => Promise<DualTotals>,
): Promise<CapturedLivePendingRead> {
  try {
    const totals = await read();
    const captureId = await persistPendingReadSnapshot({
      captureContext,
      segment,
      totals,
      diagnostics: totals.diagnostics,
    });
    return { totals, captureId };
  } catch (error) {
    const captureId = await persistPendingReadSnapshot({
      captureContext,
      segment,
      diagnostics: livePendingFailureDiagnostics(segment, error),
      status: "failed",
      errorText: error instanceof Error ? error.message : String(error),
    });
    return { totals: null, captureId, error };
  }
}

export async function updatePendingReadSnapshotDiagnostics(
  id: number,
  diagnostics: InputReadDiagnostics | Record<string, unknown>,
): Promise<void> {
  const [updated] = await db
    .update(pendingReadSnapshotsTable)
    .set({ diagnosticsJson: diagnostics as Record<string, unknown> })
    .where(eq(pendingReadSnapshotsTable.id, id))
    .returning({ id: pendingReadSnapshotsTable.id });
  if (!updated) {
    throw new Error(`Pending read snapshot ${id} was not found while updating diagnostics`);
  }
}

type PendingBaselineDiagnostics = InputReadDiagnostics & {
  pendingPlan?: PendingPlanDiagnostics;
};

export type PendingReadBaselineEvidence = {
  sourceQuantity: number;
  joinedQuantity: number;
  explainedExclusionQuantity: number;
  unexplainedResidual: number;
  unmatchedQuantity: number;
  resolutionLossQuantity: number;
  fingerprint: string;
};

export type PendingReadBaselineSummary = {
  id: number;
  baselineKey: string;
  segment: string;
  sourceRole: string;
  status: string;
  captureId: number | null;
  environment: string;
  sourceKind: string;
  sourceName: string;
  sourceSpreadsheetId: string | null;
  sourceTabName: string | null;
  observedAt: Date | null;
  sourceQuantity: number;
  joinedQuantity: number;
  explainedExclusionQuantity: number;
  unexplainedResidual: number;
  unmatchedQuantity: number;
  resolutionLossQuantity: number;
  fingerprint: string | null;
  rationale: string;
};

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function pendingExclusionFingerprint(
  diagnostics: Pick<PendingPlanDiagnostics, "unmatchedRows" | "resolutionLossRows">,
): string {
  const rows = [...diagnostics.unmatchedRows, ...diagnostics.resolutionLossRows]
    .map((row) => [
      row.segment,
      row.sourceRole,
      row.code,
      row.colour,
      row.description,
      row.quantity,
      row.disposition,
      row.reason,
    ])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return createHash("sha256")
    .update(rows.map((row) => JSON.stringify(row)).join("\n"))
    .digest("hex");
}

/**
 * Return baseline facts only when the snapshot contains the complete
 * source-to-plan evidence needed to reproduce its exclusion ledger.
 */
export function pendingReadBaselineEvidence(
  snapshot: Pick<
    PendingReadSnapshot,
    | "segment"
    | "sourceRole"
    | "status"
    | "sourceKind"
    | "sourceSpreadsheetId"
    | "sourceTabName"
    | "diagnosticsJson"
  >,
): PendingReadBaselineEvidence | null {
  if (snapshot.segment !== "Plumbing"
    || snapshot.sourceRole !== "pending_current_live"
    || snapshot.status !== "captured"
    || snapshot.sourceKind !== LIVE_PENDING_SOURCE_KIND
    || snapshot.sourceSpreadsheetId !== LIVE_PENDING_SOURCE_SPREADSHEET_ID
    || snapshot.sourceTabName !== LIVE_PENDING_SOURCE_TAB) return null;

  const diagnostics = snapshot.diagnosticsJson as unknown as PendingBaselineDiagnostics;
  const plan = diagnostics.pendingPlan;
  const reconciliation = plan?.reconciliation;
  if (!plan || !reconciliation
    || !Array.isArray(diagnostics.missingRequiredFields)
    || diagnostics.missingRequiredFields.length > 0) return null;

  const values = [
    reconciliation.sourceQuantity,
    reconciliation.joinedQuantity,
    reconciliation.explainedExclusionQuantity,
    reconciliation.unexplainedResidual,
    plan.unmatchedQuantity,
    plan.resolutionLossQuantity,
  ].map(numberOrNull);
  if (values.some((value) => value === null)
    || !reconciliation.reconciled
    || Math.abs(reconciliation.unexplainedResidual) > 0.01) return null;

  const [
    sourceQuantity,
    joinedQuantity,
    explainedExclusionQuantity,
    unexplainedResidual,
    unmatchedQuantity,
    resolutionLossQuantity,
  ] = values as number[];
  const expectedExplained = unmatchedQuantity + resolutionLossQuantity;
  if (Math.abs(explainedExclusionQuantity - expectedExplained) > 0.01
    || Math.abs(sourceQuantity - joinedQuantity - explainedExclusionQuantity) > 0.01) return null;

  return {
    sourceQuantity,
    joinedQuantity,
    explainedExclusionQuantity,
    unexplainedResidual,
    unmatchedQuantity,
    resolutionLossQuantity,
    fingerprint: pendingExclusionFingerprint(plan),
  };
}

type PendingReadBaselineCandidate = Pick<
  PendingReadSnapshot,
  | "id"
  | "segment"
  | "sourceRole"
  | "status"
  | "sourceKind"
  | "sourceName"
  | "sourceSpreadsheetId"
  | "sourceTabName"
  | "capturedAt"
  | "diagnosticsJson"
>;

export function selectFirstEligiblePendingRead(
  candidates: PendingReadBaselineCandidate[],
): PendingReadBaselineCandidate | null {
  return candidates.find((snapshot) => pendingReadBaselineEvidence(snapshot) !== null) ?? null;
}

function baselineEnvironment(): string {
  return process.env.NODE_ENV === "production" ? "production" : "development";
}

function toBaselineSummary(row: typeof pendingReadBaselinesTable.$inferSelect): PendingReadBaselineSummary {
  return {
    id: row.id,
    baselineKey: row.baselineKey,
    segment: row.segment,
    sourceRole: row.sourceRole,
    status: row.status,
    captureId: row.captureId,
    environment: row.environment,
    sourceKind: row.sourceKind,
    sourceName: row.sourceName,
    sourceSpreadsheetId: row.sourceSpreadsheetId,
    sourceTabName: row.sourceTabName,
    observedAt: row.observedAt,
    sourceQuantity: row.sourceQuantity,
    joinedQuantity: row.joinedQuantity,
    explainedExclusionQuantity: row.explainedExclusionQuantity,
    unexplainedResidual: row.unexplainedResidual,
    unmatchedQuantity: row.unmatchedQuantity,
    resolutionLossQuantity: row.resolutionLossQuantity,
    fingerprint: row.fingerprint,
    rationale: row.rationale,
  };
}

export async function getActivePendingReadBaseline(
  segment = "Plumbing",
  sourceRole = "pending_current_live",
): Promise<PendingReadBaselineSummary | null> {
  const [row] = await db
    .select()
    .from(pendingReadBaselinesTable)
    .where(and(
      eq(pendingReadBaselinesTable.segment, segment),
      eq(pendingReadBaselinesTable.sourceRole, sourceRole),
      eq(pendingReadBaselinesTable.status, "active"),
      eq(pendingReadBaselinesTable.environment, baselineEnvironment()),
    ))
    .orderBy(asc(pendingReadBaselinesTable.id))
    .limit(1);
  return row ? toBaselineSummary(row) : null;
}

/**
 * Promote the first complete captured read exactly once. The historical
 * unreproducible row is intentionally ignored because it has no capture_id.
 */
export async function ensureEvidenceBackedPendingBaseline(
  _captureId: number,
  segment = "Plumbing",
  sourceRole = "pending_current_live",
): Promise<PendingReadBaselineSummary | null> {
  const existing = await getActivePendingReadBaseline(segment, sourceRole);
  if (existing) return existing;

  const candidates = await db
    .select()
    .from(pendingReadSnapshotsTable)
    .where(and(
      eq(pendingReadSnapshotsTable.segment, segment),
      eq(pendingReadSnapshotsTable.sourceRole, sourceRole),
      eq(pendingReadSnapshotsTable.status, "captured"),
      eq(pendingReadSnapshotsTable.environment, baselineEnvironment()),
    ))
    .orderBy(asc(pendingReadSnapshotsTable.capturedAt), asc(pendingReadSnapshotsTable.id));

  const selected = selectFirstEligiblePendingRead(candidates);
  if (!selected) return null;

  const evidence = pendingReadBaselineEvidence(selected);
  if (!evidence) return null;
  const environment = baselineEnvironment();
  const baselineKey = `${segment}:${sourceRole}:active:${environment}`;
  try {
    const [inserted] = await db
      .insert(pendingReadBaselinesTable)
      .values({
        baselineKey,
        segment,
        sourceRole,
        status: "active",
        captureId: selected.id,
        environment,
        sourceKind: selected.sourceKind,
        sourceName: selected.sourceName,
        sourceSpreadsheetId: selected.sourceSpreadsheetId,
        sourceTabName: selected.sourceTabName,
        observedAt: selected.capturedAt,
        ...evidence,
        rationale: "First complete successful Plumbing live pending capture retained after the historical baseline was marked unreproducible. This evidence-backed baseline is immutable for this environment and source identity.",
      })
      .returning();
    return inserted ? toBaselineSummary(inserted) : null;
  } catch (error) {
    // A concurrent validation can win the unique baseline key race. Return the
    // winner rather than allowing the second validation to fail.
    if (String(error).toLowerCase().includes("unique")) {
      return getActivePendingReadBaseline(segment, sourceRole);
    }
    throw error;
  }
}
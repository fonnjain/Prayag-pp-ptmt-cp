import {
  db,
  alertEventsTable,
  alertRecordsTable,
  alertThresholdsTable,
  plantSourceConfigsTable,
  syncSourcesTable,
  uploadedFilesTable,
  type AlertRecord,
  type AlertThreshold,
} from "@workspace/db";
import { and, desc, eq, gt, inArray, or } from "drizzle-orm";
import { buildPlanItems } from "../routes/plan";
import { getPlantMonitoringCached } from "../routes/plant";
import { normalizePlantSegment, type PlantSegment } from "./plant-segments";

export type AlertCode = "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7";
export type AlertState = "clear" | "fired" | "muted" | "suppressed";
export type AlertSeverity = "red";

type Link = { label: string; href: string };
type Detail = Record<string, unknown>;

export interface EvaluatedAlert {
  id: number | null;
  code: AlertCode;
  segment: PlantSegment;
  month: string;
  severity: AlertSeverity;
  state: AlertState;
  title: string;
  action: string;
  message: string;
  value: number | null;
  threshold: number | null;
  difference: number | null;
  quantity: number;
  details: Detail;
  sourceLinks: Link[];
  firstSeenAt: string | null;
  lastEvaluatedAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  mutedUntil: string | null;
  muteReason: string | null;
  suppressedReason: string | null;
}

export interface AlertThresholdView extends AlertThreshold {
  wouldFireCount: number;
}

export interface AlertEvaluation {
  month: string;
  segment: PlantSegment;
  summary: {
    total: number;
    fired: number;
    muted: number;
    suppressed: number;
    clear: number;
    quantityAtStake: number;
  };
  alerts: EvaluatedAlert[];
  thresholds: AlertThresholdView[];
}

export interface AlertEvaluationDependencies {
  getMonitoring?: (
    month: string,
    segment: PlantSegment,
  ) => Promise<Awaited<ReturnType<typeof getPlantMonitoringCached>>>;
  buildPlanItems?: (
    month: string,
    segment: PlantSegment,
  ) => Promise<Awaited<ReturnType<typeof buildPlanItems>>>;
  readSourceProblems?: (
    month: string,
    segment: PlantSegment,
    staleAfterHours: number,
  ) => Promise<string[]>;
}

const RULES: Array<{
  code: AlertCode;
  name: string;
  title: string;
  description: string;
  unit: string;
  defaultValue: number;
}> = [
  { code: "R1", name: "Plan is not physically producible", title: "Reschedule an overloaded release", description: "Required daily release divided by the best demonstrated production day.", unit: "x", defaultValue: 1.25 },
  { code: "R2", name: "Projected month-end below 70%", title: "Recover the projected month-end shortfall", description: "Projected month-end attainment after at least 25% of working days have elapsed.", unit: "%", defaultValue: 70 },
  { code: "R3", name: "Confirmed orders will not be met", title: "Escalate orders that capacity cannot cover", description: "Confirmed open-order quantity above the current item plan.", unit: "pcs", defaultValue: 0 },
  { code: "R4", name: "Input reconciliation failed", title: "Fix the input reconciliation before planning", description: "Source quantity must equal joined quantity plus explained exclusions.", unit: "pcs", defaultValue: 0 },
  { code: "R5", name: "Source is unreadable or stale", title: "Restore the source before trusting the board", description: "Workbook, upload, or sync source is missing, unreadable, or stale.", unit: "hours", defaultValue: 24 },
  { code: "R6", name: "Demand on unclassified products", title: "Classify products carrying real demand", description: "Pending and dummy demand on unresolved catalogue products.", unit: "pcs", defaultValue: 5000 },
  { code: "R7", name: "Fast mover cover collapse", title: "Protect confirmed fast-mover orders", description: "Stock cover below the threshold on an item with confirmed orders.", unit: "days", defaultValue: 3 },
];

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function link(label: string, href: string): Link {
  return { label, href };
}

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function severitySort(a: EvaluatedAlert, b: EvaluatedAlert): number {
  const stateOrder: Record<AlertState, number> = { fired: 0, muted: 1, suppressed: 2, clear: 3 };
  return stateOrder[a.state] - stateOrder[b.state] || b.quantity - a.quantity || a.code.localeCompare(b.code);
}

function thresholdFor(rows: AlertThreshold[], code: AlertCode): number {
  return rows.find((row) => row.code === code)?.value
    ?? RULES.find((rule) => rule.code === code)!.defaultValue;
}

async function ensureThresholds(segment: PlantSegment): Promise<AlertThreshold[]> {
  const current = await db.select().from(alertThresholdsTable).where(eq(alertThresholdsTable.segment, segment));
  const existing = new Set(current.map((row) => row.code));
  const missing = RULES.filter((rule) => !existing.has(rule.code)).map((rule) => ({
    code: rule.code,
    segment,
    name: rule.name,
    description: rule.description,
    value: rule.defaultValue,
    defaultValue: rule.defaultValue,
    unit: rule.unit,
    scope: "segment",
  }));
  if (missing.length) {
    await db.insert(alertThresholdsTable).values(missing).onConflictDoNothing();
    return db.select().from(alertThresholdsTable).where(eq(alertThresholdsTable.segment, segment));
  }
  return current;
}

function emptyAlert(
  code: AlertCode,
  segment: PlantSegment,
  month: string,
  threshold: number | null,
  state: AlertState,
  message: string,
  details: Detail = {},
  quantity = 0,
  value: number | null = null,
  difference: number | null = null,
): Omit<EvaluatedAlert, "id" | "firstSeenAt" | "lastEvaluatedAt" | "acknowledgedAt" | "acknowledgedBy" | "mutedUntil" | "muteReason" | "suppressedReason"> {
  const rule = RULES.find((candidate) => candidate.code === code)!;
  return {
    code,
    segment,
    month,
    severity: "red",
    state,
    title: rule.title,
    action: state === "suppressed" ? "Restore the missing input, then re-evaluate." : rule.title,
    message,
    value,
    threshold,
    difference,
    quantity: round(quantity),
    details,
    sourceLinks: [link("Open Summary", "/summary")],
  };
}

async function loadSourceProblems(month: string, segment: PlantSegment, staleAfterHours: number): Promise<string[]> {
  const [syncRows, sourceRows, uploadRows] = await Promise.all([
    db.select().from(syncSourcesTable).where(or(
      eq(syncSourcesTable.id, `liveProduction_${month}`),
      eq(syncSourcesTable.id, `liveOrder_${month}`),
    )),
    db.select().from(plantSourceConfigsTable).where(and(
      eq(plantSourceConfigsTable.month, month),
      eq(plantSourceConfigsTable.segment, segment),
    )),
    db.select().from(uploadedFilesTable).where(inArray(uploadedFilesTable.kind, segment === "Plumbing"
      ? ["plumbing_fg_stock"]
      : ["current_stock", "pending_orders", "last_month_pending"])).orderBy(desc(uploadedFilesTable.uploadedAt)),
  ]);
  const sourceProblems: string[] = [];
  for (const row of syncRows) {
    if (row.status !== "success") sourceProblems.push(`${row.name}: ${row.message ?? row.status}`);
    if (row.lastSyncedAt && Date.now() - row.lastSyncedAt.getTime() > staleAfterHours * 3600000) {
      sourceProblems.push(`${row.name} last synced ${row.lastSyncedAt.toISOString()}`);
    }
  }
  if (sourceRows.length === 0) sourceProblems.push(`No workbook is registered for ${segment}/${month}.`);
  const requiredKinds = segment === "Plumbing" ? ["plumbing_fg_stock"] : ["current_stock", "pending_orders", "last_month_pending"];
  for (const kind of requiredKinds) {
    const latest = uploadRows.find((row) => row.kind === kind);
    if (!latest) sourceProblems.push(`Missing upload: ${kind}`);
    else if (latest.uploadedAt < new Date(`${month}-01T00:00:00Z`)) sourceProblems.push(`${kind} upload predates ${month}.`);
  }
  return sourceProblems;
}

async function evaluateRaw(
  month: string,
  segment: PlantSegment,
  thresholdRows: AlertThreshold[],
  dependencies: AlertEvaluationDependencies = {},
): Promise<Array<ReturnType<typeof emptyAlert>>> {
  const monitoringLoader = dependencies.getMonitoring ?? getPlantMonitoringCached;
  const planLoader = dependencies.buildPlanItems ?? buildPlanItems;
  const monitoringResult = await Promise.allSettled([monitoringLoader(month, segment)]);
  const monitoringResultValue = monitoringResult[0].status === "fulfilled" ? monitoringResult[0].value : null;
  const monitoring = monitoringResultValue?.bundle ?? null;
  const planItems = monitoringResultValue?.planItems
    ?? (monitoringResult[0].status === "rejected"
      ? await Promise.allSettled([planLoader(month, segment)]).then(([result]) => result.status === "fulfilled" ? result.value : null)
      : null);
  const planError = monitoringResult[0].status === "rejected"
    ? (monitoringResult[0].reason instanceof Error ? monitoringResult[0].reason.message : "Plan inputs could not be read")
    : null;
  const monitoringError = monitoringResult[0].status === "rejected"
    ? (monitoringResult[0].reason instanceof Error ? monitoringResult[0].reason.message : "Monitoring inputs could not be read")
    : null;

  const r1Threshold = thresholdFor(thresholdRows, "R1");
  const r2Threshold = thresholdFor(thresholdRows, "R2");
  const r3Threshold = thresholdFor(thresholdRows, "R3");
  const r5Threshold = thresholdFor(thresholdRows, "R5");
  const r6Threshold = thresholdFor(thresholdRows, "R6");
  const r7Threshold = thresholdFor(thresholdRows, "R7");

  const productionDays = monitoring?.dailySeries.filter((day) => day.actualPcs > 0).length ?? 0;
  const bestDay = monitoring?.plant.bestDayOutput ?? 0;
  const requiredPerDay = monitoring?.plant.requiredPerDay ?? 0;
  const feasibilityRatio = bestDay > 0 ? round(requiredPerDay / bestDay) : null;
  const r1 = !monitoring || bestDay <= 0
    ? emptyAlert("R1", segment, month, r1Threshold, "suppressed", monitoringError ?? "No demonstrated production day is available.", { productionDays })
    : productionDays < 10
      ? emptyAlert("R1", segment, month, r1Threshold, "suppressed", `Only ${productionDays} production days are available; at least 10 are required.`, { productionDays, bestDay, requiredPerDay })
      : feasibilityRatio !== null && feasibilityRatio > r1Threshold
        ? emptyAlert("R1", segment, month, r1Threshold, "fired", `Required rate is ${requiredPerDay.toLocaleString()} pcs/day against a proven ${bestDay.toLocaleString()} pcs/day. Reschedule or accept the shortfall now.`, { productionDays, bestDay, requiredPerDay }, requiredPerDay, feasibilityRatio, round(feasibilityRatio - r1Threshold))
        : emptyAlert("R1", segment, month, r1Threshold, "clear", `Release rate ${feasibilityRatio ?? 0}× is within the ${r1Threshold}× limit.`, { productionDays, bestDay, requiredPerDay }, 0, feasibilityRatio, feasibilityRatio === null ? null : round(feasibilityRatio - r1Threshold));

  const elapsed = monitoring?.context.elapsed ?? 0;
  const workingDays = monitoring?.context.workingDays ?? 0;
  const projected = monitoring?.plant.projectedAttainmentPct ?? null;
  const projectedGap = monitoring?.plant.projectedMonthEnd !== null && monitoring
    ? Math.max(monitoring.plant.targetMax - monitoring.plant.projectedMonthEnd, 0)
    : null;
  const r2 = !monitoring || monitoring.plant.targetMax <= 0 || projected === null
    ? emptyAlert("R2", segment, month, r2Threshold, "suppressed", monitoringError ?? "Month-end projection cannot be computed.", { elapsed, workingDays })
    : elapsed < Math.ceil(workingDays * 0.25)
      ? emptyAlert("R2", segment, month, r2Threshold, "suppressed", `Projection starts after ${Math.ceil(workingDays * 0.25)} working days; only ${elapsed} have elapsed.`, { elapsed, workingDays })
      : projected < r2Threshold
        ? emptyAlert("R2", segment, month, r2Threshold, "fired", `At today's pace the month ends ${Math.round(projectedGap ?? 0).toLocaleString()} pieces short — ${monitoring.context.remaining} working days remain.`, { projectedMonthEnd: monitoring.plant.projectedMonthEnd, targetMax: monitoring.plant.targetMax, elapsed, workingDays }, projectedGap ?? 0, projected, round(projected - r2Threshold))
        : emptyAlert("R2", segment, month, r2Threshold, "clear", `Projected month-end attainment is ${projected.toFixed(1)}%, above the ${r2Threshold}% floor.`, { projectedMonthEnd: monitoring.plant.projectedMonthEnd, targetMax: monitoring.plant.targetMax, elapsed, workingDays }, 0, projected, round(projected - r2Threshold));

  const atRiskItems = (planItems ?? []).filter((item) => item.pendingOrder > 0 && item.maxProduction < item.pendingOrder);
  const atRiskQty = atRiskItems.reduce((sum, item) => sum + Math.max(item.pendingOrder - item.maxProduction, 0), 0);
  const r3 = !planItems
    ? emptyAlert("R3", segment, month, r3Threshold, "suppressed", planError ?? "Confirmed-order coverage cannot be evaluated.")
    : atRiskQty > r3Threshold
      ? emptyAlert("R3", segment, month, r3Threshold, "fired", `${Math.round(atRiskQty).toLocaleString()} confirmed-order pieces have no current plan coverage across ${atRiskItems.length} items.`, { items: atRiskItems.slice(0, 50).map((item) => ({ itemCode: item.itemCode, colour: item.colour, pending: item.pendingOrder, plan: item.maxProduction })) }, atRiskQty, atRiskQty, round(atRiskQty - r3Threshold))
      : emptyAlert("R3", segment, month, r3Threshold, "clear", "Every confirmed-order row is covered by the current item plan.", { checkedItems: planItems.length }, 0, atRiskQty, round(atRiskQty - r3Threshold));

  const r4 = planError
    ? emptyAlert("R4", segment, month, 0, "fired", `Input reconciliation failed before a plan could be built: ${planError}`, { error: planError }, 1, 1, 1)
    : emptyAlert("R4", segment, month, 0, "clear", "Input quantities reconciled sufficiently to build the current plan.", { sourceQuantity: 0, joinedQuantity: 0, explainedExclusions: 0, unexplainedResidual: 0 }, 0, 0, 0);

  const sourceProblems = dependencies.readSourceProblems
    ? await dependencies.readSourceProblems(month, segment, r5Threshold)
    : await loadSourceProblems(month, segment, r5Threshold);
  const r5 = sourceProblems.length
    ? emptyAlert("R5", segment, month, r5Threshold, "suppressed", "Restore the source before trusting the board: " + sourceProblems.join(" · "), { problems: sourceProblems }, 0, null, null)
    : emptyAlert("R5", segment, month, r5Threshold, "clear", "Registered workbooks, sync rows, and required uploads are available.", {}, 0, 0, 0);

  const unresolved = (planItems ?? []).filter((item) => item.bufferReq === null);
  const unresolvedDemand = unresolved.reduce((sum, item) => sum + item.pendingOrder + item.order, 0);
  const r6 = !planItems
    ? emptyAlert("R6", segment, month, r6Threshold, "suppressed", planError ?? "Unclassified demand cannot be evaluated.")
    : unresolvedDemand > r6Threshold
      ? emptyAlert("R6", segment, month, r6Threshold, "fired", `${Math.round(unresolvedDemand).toLocaleString()} pieces of pending or dummy demand sit on ${unresolved.length} unresolved products. Classify them before setting buffers.`, { itemCount: unresolved.length }, unresolvedDemand, unresolvedDemand, round(unresolvedDemand - r6Threshold))
      : emptyAlert("R6", segment, month, r6Threshold, "clear", `${Math.round(unresolvedDemand).toLocaleString()} unresolved-demand pieces are within the ${r6Threshold.toLocaleString()}-piece threshold.`, { itemCount: unresolved.length }, 0, unresolvedDemand, round(unresolvedDemand - r6Threshold));

  const fastMovers = (planItems ?? []).filter((item) => item.pendingOrder > 0 && typeof item.cover === "number" && item.cover < r7Threshold);
  const r7 = !planItems
    ? emptyAlert("R7", segment, month, r7Threshold, "suppressed", planError ?? "Fast-mover cover cannot be evaluated.")
    : fastMovers.length
      ? emptyAlert("R7", segment, month, r7Threshold, `${"fired"}`, `${fastMovers.length} confirmed-order items have less than ${r7Threshold} days of cover.`, { items: fastMovers.slice(0, 50).map((item) => ({ itemCode: item.itemCode, colour: item.colour, cover: item.cover, pending: item.pendingOrder })) }, fastMovers.reduce((sum, item) => sum + item.pendingOrder, 0), Math.min(...fastMovers.map((item) => Number(item.cover))), round(Math.min(...fastMovers.map((item) => Number(item.cover))) - r7Threshold))
      : emptyAlert("R7", segment, month, r7Threshold, "clear", "No confirmed-order fast mover is below the cover threshold.", { checkedItems: planItems.length }, 0, null, null);

  return [r1, r2, r3, r4, r5, r6, r7];
}

async function persistEvaluatedAlert(raw: ReturnType<typeof emptyAlert>, existing: AlertRecord | undefined, now: Date): Promise<EvaluatedAlert> {
  const muted = existing?.mutedUntil && existing.mutedUntil > now && raw.state === "fired";
  const state: AlertState = muted ? "muted" : raw.state;
  const values = {
    ...raw,
    state,
    id: existing?.id,
    lastEvaluatedAt: now,
    updatedAt: now,
    ...(existing ? {} : { firstSeenAt: now, createdAt: now }),
    ...(state !== "fired" ? { acknowledgedAt: existing?.acknowledgedAt ?? null, acknowledgedBy: existing?.acknowledgedBy ?? null } : {}),
    mutedUntil: existing?.mutedUntil ?? null,
    muteReason: existing?.muteReason ?? null,
    suppressedReason: raw.state === "suppressed" ? raw.message : null,
  };
  const [record] = await db.insert(alertRecordsTable).values(values).onConflictDoUpdate({
    target: [alertRecordsTable.code, alertRecordsTable.segment, alertRecordsTable.month],
    set: values,
  }).returning();
  const changed = !existing || existing.state !== state || existing.value !== raw.value || existing.threshold !== raw.threshold;
  if (changed && state !== "clear") {
    await db.insert(alertEventsTable).values({
      alertId: record.id,
      code: raw.code,
      segment: raw.segment,
      month: raw.month,
      state,
      value: raw.value,
      threshold: raw.threshold,
      difference: raw.difference,
      quantity: raw.quantity,
      message: raw.message,
      details: raw.details,
      sourceLinks: raw.sourceLinks,
      occurredAt: now,
      action: "evaluated",
    });
  }
  return toView(record);
}

function toView(row: AlertRecord): EvaluatedAlert {
  return {
    id: row.id,
    code: row.code as AlertCode,
    segment: row.segment as PlantSegment,
    month: row.month,
    severity: "red",
    state: row.state as AlertState,
    title: row.title,
    action: row.action,
    message: row.message,
    value: row.value,
    threshold: row.threshold,
    difference: row.difference,
    quantity: row.quantity,
    details: row.details,
    sourceLinks: row.sourceLinks,
    firstSeenAt: iso(row.firstSeenAt),
    lastEvaluatedAt: iso(row.lastEvaluatedAt)!,
    acknowledgedAt: iso(row.acknowledgedAt),
    acknowledgedBy: row.acknowledgedBy,
    mutedUntil: iso(row.mutedUntil),
    muteReason: row.muteReason,
    suppressedReason: row.suppressedReason,
  };
}

export async function evaluateAlerts(
  month: string,
  segment: PlantSegment,
  dependencies: AlertEvaluationDependencies = {},
): Promise<AlertEvaluation> {
  const thresholdRows = await ensureThresholds(segment);
  const raw = await evaluateRaw(month, segment, thresholdRows, dependencies);
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const recentEvents = await db.select({
    code: alertEventsTable.code,
    value: alertEventsTable.value,
    state: alertEventsTable.state,
  }).from(alertEventsTable).where(and(
    eq(alertEventsTable.segment, segment),
    gt(alertEventsTable.occurredAt, sixMonthsAgo),
  ));
  const enrichedThresholds = await Promise.all(thresholdRows.map(async (threshold) => {
    const observed = [
      ...recentEvents.filter((event) => event.code === threshold.code && event.value !== null).map((event) => Number(event.value)),
      ...(raw.find((alert) => alert.code === threshold.code)?.value === null || raw.find((alert) => alert.code === threshold.code)?.value === undefined
        ? []
        : [Number(raw.find((alert) => alert.code === threshold.code)!.value)]),
    ];
    const firedCount = recentEvents.filter((event) => event.code === threshold.code && (event.state === "fired" || event.state === "muted")).length;
    const [updated] = await db.update(alertThresholdsTable).set({
      observedMin: observed.length ? Math.min(...observed) : null,
      observedMax: observed.length ? Math.max(...observed) : null,
      wouldFireCount: firedCount,
    }).where(and(
      eq(alertThresholdsTable.code, threshold.code),
      eq(alertThresholdsTable.segment, segment),
    )).returning();
    return updated ?? threshold;
  }));
  const existingRows = await db.select().from(alertRecordsTable).where(and(
    eq(alertRecordsTable.month, month),
    eq(alertRecordsTable.segment, segment),
  ));
  const existingByCode = new Map(existingRows.map((row) => [row.code, row]));
  const now = new Date();
  const alerts = await Promise.all(raw.map((item) => persistEvaluatedAlert(item, existingByCode.get(item.code), now)));
  alerts.sort(severitySort);
  return {
    month,
    segment,
    summary: {
      total: alerts.length,
      fired: alerts.filter((alert) => alert.state === "fired").length,
      muted: alerts.filter((alert) => alert.state === "muted").length,
      suppressed: alerts.filter((alert) => alert.state === "suppressed").length,
      clear: alerts.filter((alert) => alert.state === "clear").length,
      quantityAtStake: round(alerts.filter((alert) => alert.state === "fired" || alert.state === "muted").reduce((sum, alert) => sum + alert.quantity, 0)),
    },
    alerts,
    thresholds: enrichedThresholds,
  };
}

export async function listAlertHistory(segment: PlantSegment, limit = 100) {
  return db.select().from(alertEventsTable)
    .where(eq(alertEventsTable.segment, segment))
    .orderBy(desc(alertEventsTable.occurredAt))
    .limit(limit);
}

export async function acknowledgeAlert(id: number, actor: string): Promise<AlertRecord | undefined> {
  const [updated] = await db.update(alertRecordsTable).set({
    acknowledgedAt: new Date(),
    acknowledgedBy: actor,
    updatedAt: new Date(),
  }).where(eq(alertRecordsTable.id, id)).returning();
  if (updated) await db.insert(alertEventsTable).values({
    alertId: updated.id,
    code: updated.code,
    segment: updated.segment,
    month: updated.month,
    state: updated.state,
    value: updated.value,
    threshold: updated.threshold,
    difference: updated.difference,
    quantity: updated.quantity,
    message: updated.message,
    details: updated.details,
    sourceLinks: updated.sourceLinks,
    actor,
    action: "acknowledged",
  });
  return updated;
}

export async function muteAlert(id: number, actor: string, reason: string, mutedUntil: Date): Promise<AlertRecord | undefined> {
  const [updated] = await db.update(alertRecordsTable).set({
    state: "muted",
    mutedUntil,
    muteReason: reason,
    updatedAt: new Date(),
  }).where(eq(alertRecordsTable.id, id)).returning();
  if (updated) await db.insert(alertEventsTable).values({
    alertId: updated.id,
    code: updated.code,
    segment: updated.segment,
    month: updated.month,
    state: "muted",
    value: updated.value,
    threshold: updated.threshold,
    difference: updated.difference,
    quantity: updated.quantity,
    message: updated.message,
    details: updated.details,
    sourceLinks: updated.sourceLinks,
    actor,
    action: "muted",
  });
  return updated;
}

export async function updateAlertThreshold(code: AlertCode, segment: PlantSegment, value: number, reason: string, actor: string): Promise<AlertThreshold | undefined> {
  const [updated] = await db.update(alertThresholdsTable).set({
    value,
    updatedBy: `${actor}: ${reason}`,
    updatedAt: new Date(),
  }).where(and(eq(alertThresholdsTable.code, code), eq(alertThresholdsTable.segment, segment))).returning();
  return updated;
}

export async function resetAlertThreshold(code: AlertCode, segment: PlantSegment, actor: string): Promise<AlertThreshold | undefined> {
  const rule = RULES.find((item) => item.code === code)!;
  const [updated] = await db.update(alertThresholdsTable).set({
    value: rule.defaultValue,
    updatedBy: `${actor}: reset to default`,
    updatedAt: new Date(),
  }).where(and(eq(alertThresholdsTable.code, code), eq(alertThresholdsTable.segment, segment))).returning();
  return updated;
}
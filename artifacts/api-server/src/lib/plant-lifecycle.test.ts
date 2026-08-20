import { test } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import {
  db,
  correctivePlanRunsTable,
  planRunResultsTable,
  planRunInputsTable,
  planRunsTable,
  plantIngestionCacheTable,
  plantMonitoringSnapshotsTable,
  plantPlanVersionsTable,
  weeklyReleaseBandsTable,
} from "@workspace/db";
import { resolvePlantMonthLifecycle, resolveWorkingDays } from "./plant-lifecycle";
import { getPlanVersionTimeline, savePlanVersionSnapshot } from "./plant-plan-timeline";
import { buildVersionAwarePlanMap, computePlanVsActualReport } from "./plan-vs-actual-engine";
import { buildPlantBundle } from "./plant-engine";
import { buildPlantWeeklySummary, formatPlanVersionAuditLabel } from "./plant-weekly-engine";
import {
  backfillLegacyPlantMonitoringSnapshot,
  captureClosedPlantMonth,
  computeLifecyclePlantMonitoring,
  reconstructLegacyWeeklyPlanItems,
  selectUnfrozenClosedMonths,
} from "./plant-monitoring";
import { runMigrations } from "./runMigrations";

test("UTC lifecycle boundaries include grace through the 7th and close on the 8th", () => {
  assert.equal(resolvePlantMonthLifecycle("2026-08", new Date("2026-08-19T12:00:00Z")).state, "open");
  assert.equal(resolvePlantMonthLifecycle("2026-09", new Date("2026-08-19T12:00:00Z")).state, "future");
  assert.equal(resolvePlantMonthLifecycle("2026-07", new Date("2026-08-07T23:59:59Z")).state, "grace");
  assert.equal(resolvePlantMonthLifecycle("2026-07", new Date("2026-08-08T00:00:00Z")).state, "closed");
  assert.equal(resolvePlantMonthLifecycle("2025-12", new Date("2026-01-07T23:59:59Z")).state, "grace");
  assert.equal(resolvePlantMonthLifecycle("2025-12", new Date("2026-01-08T00:00:00Z")).state, "closed");
});

test("working days are derived from the UTC calendar only when configuration is absent", () => {
  assert.deepEqual(resolveWorkingDays("2026-08", 25), { workingDays: 25, workingDaysSource: "configured" });
  assert.deepEqual(resolveWorkingDays("2026-08", null), { workingDays: 26, workingDaysSource: "derived" });
});

test("observed working-day resolution adds worked Sundays for closed months", () => {
  assert.deepEqual(
    resolveWorkingDays("2026-06", null, ["2026-06-07", "2026-06-14", "2026-06-28"], "2026-06-30", "closed"),
    { workingDays: 29, workingDaysSource: "observed" },
  );
  assert.deepEqual(
    resolveWorkingDays("2026-06", null, ["2026-06-28"], "2026-06-30", "closed"),
    { workingDays: 27, workingDaysSource: "observed" },
  );
});

test("open observed working days project future calendar non-Sundays and configured values still win", () => {
  assert.deepEqual(
    resolveWorkingDays("2026-08", null, ["2026-08-02", "2026-08-09"], "2026-08-19", "open"),
    { workingDays: 28, workingDaysSource: "observed" },
  );
  assert.deepEqual(
    resolveWorkingDays("2026-08", 25, ["2026-08-02", "2026-08-09"], "2026-08-19", "open"),
    { workingDays: 25, workingDaysSource: "configured" },
  );
});

test("legacy finalized plans hydrate without requiring a linked corrective run", async () => {
  await runMigrations();
  const month = "1996-01";
  await db.delete(plantPlanVersionsTable).where(and(eq(plantPlanVersionsTable.month, month), eq(plantPlanVersionsTable.segment, "PTMT")));
  await db.delete(planRunsTable).where(and(eq(planRunsTable.month, month), eq(planRunsTable.segment, "PTMT")));

  try {
    const [run] = await db.insert(planRunsTable).values({
      month,
      segment: "PTMT",
      status: "finalized",
      effectiveFrom: `${month}-01`,
      weeklyReleaseVersion: 1,
    }).returning();
    await db.insert(planRunResultsTable).values({
      runId: run.id,
      itemCode: "LEGACY-A",
      colour: "",
      category: "Legacy Test",
      productionPlan: 100,
      minProduction: 80,
      bufferReq: 0,
      releaseWeek: 1,
      w1: 100,
      w2: 0,
      w3: 0,
      w4: 0,
    });

    const timeline = await getPlanVersionTimeline(month, "PTMT");
    assert.equal(timeline.length, 1);
    assert.equal(timeline[0]?.sourceId, run.id);
    assert.equal(timeline[0]?.effectiveFrom, `${month}-01`);
  } finally {
    await db.delete(plantPlanVersionsTable).where(and(eq(plantPlanVersionsTable.month, month), eq(plantPlanVersionsTable.segment, "PTMT")));
    await db.delete(planRunsTable).where(and(eq(planRunsTable.month, month), eq(planRunsTable.segment, "PTMT")));
  }
});

test("same-day legacy revisions select the latest source issuance and retain an audit trail", async () => {
  await runMigrations();
  const month = "1996-02";
  await db.delete(plantPlanVersionsTable).where(and(eq(plantPlanVersionsTable.month, month), eq(plantPlanVersionsTable.segment, "PTMT")));
  await db.delete(correctivePlanRunsTable).where(and(eq(correctivePlanRunsTable.month, month), eq(correctivePlanRunsTable.segment, "PTMT")));

  try {
    const [earlier] = await db.insert(correctivePlanRunsTable).values({
      month,
      segment: "PTMT",
      effectiveFrom: `${month}-08`,
      asOfDate: `${month}-08`,
      createdAt: new Date("1996-02-08T10:00:00.000Z"),
    }).returning();
    const [later] = await db.insert(correctivePlanRunsTable).values({
      month,
      segment: "PTMT",
      effectiveFrom: `${month}-08`,
      asOfDate: `${month}-08`,
      createdAt: new Date("1996-02-08T11:00:00.000Z"),
    }).returning();

    // Save in reverse order to prove snapshot backfill order cannot choose the
    // governing revision.
    await savePlanVersionSnapshot({
      month, segment: "PTMT", kind: "corrective", sourceId: later.id,
      effectiveFrom: `${month}-08`, sourceLabel: "Later correction",
      targets: [{ itemCode: "A", colour: "", category: "Test", maxPcs: 120, minPcs: 0, w1: 0, w2: 120, w3: 0, w4: 0 }],
    });
    await savePlanVersionSnapshot({
      month, segment: "PTMT", kind: "corrective", sourceId: earlier.id,
      effectiveFrom: `${month}-08`, sourceLabel: "Earlier correction",
      targets: [{ itemCode: "A", colour: "", category: "Test", maxPcs: 100, minPcs: 0, w1: 0, w2: 100, w3: 0, w4: 0 }],
    });

    const [version] = await getPlanVersionTimeline(month, "PTMT");
    assert.equal(version?.sourceId, later.id);
    assert.deepEqual(version?.selection, {
      candidateCount: 2,
      reason: "latest_source_issuance",
      canonicalIssuedAt: "1996-02-08T11:00:00.000Z",
      canonicalIssuedAtSource: "corrective_created_at",
      superseded: [{
        kind: "corrective",
        sourceId: earlier.id,
        sourceLabel: "Earlier correction",
        issuedAt: "1996-02-08T10:00:00.000Z",
        issuedAtSource: "corrective_created_at",
      }],
    });
    assert.deepEqual(version?.supersededSameDaySources, [{
      kind: "corrective",
      sourceId: earlier.id,
      sourceLabel: "Earlier correction",
    }]);
    assert.match(formatPlanVersionAuditLabel(version!), /canonical: latest source issuance; 1 same-day revision superseded/);
  } finally {
    await db.delete(plantPlanVersionsTable).where(and(eq(plantPlanVersionsTable.month, month), eq(plantPlanVersionsTable.segment, "PTMT")));
    await db.delete(correctivePlanRunsTable).where(and(eq(correctivePlanRunsTable.month, month), eq(correctivePlanRunsTable.segment, "PTMT")));
  }
});

test("legacy weekly allocation reconstructs Week 1 from frozen inputs and bands, not zeroed result columns", () => {
  const allocation = reconstructLegacyWeeklyPlanItems(
    [{
      itemCode: "A",
      colour: "",
      category: "Test",
      productionPlan: 100,
      minProduction: 80,
      bufferReq: 150,
    }],
    [{
      itemCode: "A",
      colour: "",
      avg3MoSale: 100,
      stock: 10,
      pendingLastMonth: 0,
      pendingCurrent: 0,
    }],
    [{ categoryName: "Test", w1Upper: 0.3, w2Upper: 0.8, w3Upper: 1.5, w4Upper: 3 }],
  );

  assert.deepEqual(allocation.map((item) => [item.w1, item.w2, item.w3, item.w4]), [[100, 0, 0, 0]]);
});

test("weekly monitoring uses reconstructed legacy allocation when timeline week columns are zero", async () => {
  await runMigrations();
  const month = "1996-03";
  const category = "Legacy Weekly Timeline";
  await db.delete(plantPlanVersionsTable).where(and(eq(plantPlanVersionsTable.month, month), eq(plantPlanVersionsTable.segment, "PTMT")));
  await db.delete(planRunsTable).where(and(eq(planRunsTable.month, month), eq(planRunsTable.segment, "PTMT")));
  await db.delete(weeklyReleaseBandsTable).where(and(eq(weeklyReleaseBandsTable.segment, "PTMT"), eq(weeklyReleaseBandsTable.categoryName, category)));

  try {
    const [run] = await db.insert(planRunsTable).values({
      month,
      segment: "PTMT",
      status: "finalized",
      effectiveFrom: `${month}-01`,
      weeklyReleaseVersion: 0,
    }).returning();
    await db.insert(planRunResultsTable).values({
      runId: run.id,
      itemCode: "LEGACY-W1",
      colour: "",
      category,
      productionPlan: 100,
      minProduction: 80,
      bufferReq: 150,
      w1: 0,
      w2: 0,
      w3: 0,
      w4: 0,
    });
    await db.insert(planRunInputsTable).values({
      runId: run.id,
      itemCode: "LEGACY-W1",
      colour: "",
      avg3MoSale: 100,
      stock: 10,
      pendingCurrent: 0,
      pendingLastMonth: 0,
    });
    await db.insert(weeklyReleaseBandsTable).values({
      segment: "PTMT",
      categoryName: category,
      w1Upper: 0.3,
      w2Upper: 0.8,
      w3Upper: 1.5,
      w4Upper: 3,
    });

    const timeline = await getPlanVersionTimeline(month, "PTMT");
    assert.deepEqual(timeline[0]?.targets[0] && [
      timeline[0].targets[0].w1,
      timeline[0].targets[0].w2,
      timeline[0].targets[0].w3,
      timeline[0].targets[0].w4,
    ], [100, 0, 0, 0]);

    const weekly = buildPlantWeeklySummary(
      month,
      [],
      [],
      [{ itemCode: "LEGACY-W1", colour: "", category }],
      `${month}-31`,
      true,
      timeline,
    );
    assert.equal(weekly.plant.weeks[0]?.target, 100);
  } finally {
    await db.delete(plantPlanVersionsTable).where(and(eq(plantPlanVersionsTable.month, month), eq(plantPlanVersionsTable.segment, "PTMT")));
    await db.delete(planRunsTable).where(and(eq(planRunsTable.month, month), eq(planRunsTable.segment, "PTMT")));
    await db.delete(weeklyReleaseBandsTable).where(and(eq(weeklyReleaseBandsTable.segment, "PTMT"), eq(weeklyReleaseBandsTable.categoryName, category)));
  }
});

test("uncaptured closed months remain eligible after later month rollovers", () => {
  assert.deepEqual(
    selectUnfrozenClosedMonths(
      ["2026-02", "2026-01", "2026-01", "2025-12", "2026-03"],
      ["2025-12"],
      new Date("2026-03-08T00:00:00Z"),
    ),
    ["2026-02", "2026-01"],
  );
});

test("completed months have a full calendar, zero remaining days, and no upcoming weeks", () => {
  const bundle = buildPlantBundle(
    "2026-07",
    [{ date: "2026-07-02", itemCode: "A", colour: "", qty: 50, group: "PTMT" }],
    [{ itemCode: "A", colour: "", category: "Test", maxPcs: 100, minPcs: 80 }],
    {
      workingDays: 27,
      elapsed: 0,
      shiftsPerDay: 2,
      shiftHours: 12,
      snapshotDate: "2026-07-02",
      lifecycle: "closed",
      workingDaysSource: "derived",
    },
  );
  assert.equal(bundle.context.elapsed, 27);
  assert.equal(bundle.context.remaining, 0);

  const weekly = buildPlantWeeklySummary(
    "2026-07",
    [{ date: "2026-07-02", itemCode: "A", colour: "", qty: 50 }],
    [{ itemCode: "A", colour: "", category: "Test", w1: 25, w2: 25, w3: 25, w4: 25, maxProduction: 100 }],
    [{ itemCode: "A", colour: "", category: "Test" }],
    "2026-07-02",
    true,
  );
  assert.equal(weekly.currentWeek, 4);
  assert.ok(weekly.plant.weeks.every((week) => week.attainmentPct !== null), "completed weeks are never marked upcoming");
});

test("versioned monitoring retains actuals for retired and recategorized items", () => {
  const bundle = buildPlantBundle(
    "2026-08",
    [
      { date: "2026-08-03", itemCode: "A", colour: "", qty: 10, group: "PTMT" },
      { date: "2026-08-04", itemCode: "B", colour: "", qty: 20, group: "PTMT" },
      { date: "2026-08-17", itemCode: "A", colour: "", qty: 30, group: "PTMT" },
    ],
    [{ itemCode: "A", colour: "", category: "New Category", maxPcs: 200, minPcs: 160 }],
    {
      workingDays: 26,
      elapsed: 0,
      shiftsPerDay: 2,
      shiftHours: 12,
      snapshotDate: "2026-08-17",
      lifecycle: "open",
      workingDaysSource: "derived",
      versionTimeline: [
        {
          kind: "run",
          sourceId: 1,
          sourceLabel: "Original",
          effectiveFrom: "2026-08-01",
          effectiveTo: "2026-08-14",
          targets: [
            { itemCode: "A", colour: "", category: "Old Category", maxPcs: 100, minPcs: 80, w1: 25, w2: 25, w3: 25, w4: 25 },
            { itemCode: "B", colour: "", category: "Old Category", maxPcs: 50, minPcs: 40, w1: 50, w2: 0, w3: 0, w4: 0 },
          ],
        },
        {
          kind: "corrective",
          sourceId: 2,
          sourceLabel: "Revision",
          effectiveFrom: "2026-08-15",
          effectiveTo: null,
          targets: [
            { itemCode: "A", colour: "", category: "New Category", maxPcs: 200, minPcs: 160, w1: 0, w2: 0, w3: 100, w4: 100 },
          ],
        },
      ],
    },
  );

  assert.equal(bundle.plant.producedToDate, 60);
  assert.equal(bundle.categories.find((row) => row.category === "Old Category")?.producedToDate, 30);
  assert.equal(bundle.categories.find((row) => row.category === "New Category")?.producedToDate, 30);
  assert.ok((bundle.categories.find((row) => row.category === "Old Category")?.requiredCum ?? 0) > 0);
  assert.equal(bundle.items.find((row) => row.itemCode === "B")?.producedToDate, 20);
  assert.equal(bundle.items.find((row) => row.itemCode === "A" && row.category === "Old Category")?.producedToDate, 10);
  assert.equal(bundle.items.find((row) => row.itemCode === "A" && row.category === "New Category")?.producedToDate, 30);
  assert.equal(bundle.needsReview.length, 0);
});

test("weekly provenance identifies every issued plan governing a boundary week", () => {
  const weekly = buildPlantWeeklySummary(
    "2026-08",
    [],
    [],
    [{ itemCode: "A", colour: "", category: "New Category" }],
    "2026-08-20",
    true,
    [
      {
        kind: "run",
        sourceId: 1,
        sourceLabel: "Original plan #1",
        effectiveFrom: "2026-08-01",
        effectiveTo: "2026-08-09",
        targets: [
          { itemCode: "A", colour: "", category: "Old Category", maxPcs: 100, minPcs: 80, w1: 25, w2: 25, w3: 25, w4: 25 },
        ],
      },
      {
        kind: "corrective",
        sourceId: 2,
        sourceLabel: "Corrective plan #2",
        effectiveFrom: "2026-08-10",
        effectiveTo: null,
        targets: [
          { itemCode: "A", colour: "", category: "New Category", maxPcs: 120, minPcs: 90, w1: 30, w2: 30, w3: 30, w4: 30 },
        ],
      },
    ],
  );

  assert.deepEqual(weekly.plant.weeks[0].planVersions, ["Original plan #1 · effective 2026-08-01"]);
  assert.deepEqual(weekly.plant.weeks[1].planVersions, [
    "Original plan #1 · effective 2026-08-01",
    "Corrective plan #2 · effective 2026-08-10",
  ]);
  assert.deepEqual(weekly.plant.weeks[2].planVersions, ["Corrective plan #2 · effective 2026-08-10"]);
});

test("future monitoring returns a named no-plan state without rebuilding targets", async () => {
  await runMigrations();
  const { bundle } = await computeLifecyclePlantMonitoring("2099-01", new Date("2026-08-19T12:00:00Z"));
  assert.equal(bundle.monitoringStatus, "future");
  assert.equal(bundle.targetsAvailable, false);
  assert.equal(bundle.actualsAvailable, false);
  assert.match(bundle.unavailableReason ?? "", /No plan issued/);
  assert.equal(bundle.categories.length, 0);
});

test("grace monitoring never presents cached actuals after a refresh failure", async () => {
  await runMigrations();
  const month = "1997-03";
  await db.delete(plantMonitoringSnapshotsTable).where(eq(plantMonitoringSnapshotsTable.month, month));
  await db.delete(plantIngestionCacheTable).where(eq(plantIngestionCacheTable.month, month));
  await db.delete(planRunsTable).where(and(eq(planRunsTable.month, month), eq(planRunsTable.segment, "PTMT")));

  try {
    const [run] = await db.insert(planRunsTable).values({
      month,
      segment: "PTMT",
      status: "finalized",
      weeklyReleaseVersion: 1,
    }).returning();
    await db.insert(planRunResultsTable).values({
      runId: run.id,
      itemCode: "GRACE-A",
      colour: "",
      category: "Grace Test",
      productionPlan: 100,
      minProduction: 80,
      bufferReq: 0,
      releaseWeek: 1,
      w1: 100,
      w2: 0,
      w3: 0,
      w4: 0,
    });
    await db.insert(plantIngestionCacheTable).values({
      month,
      snapshotDate: "1997-03-31",
      rawActualsJson: [{ date: "1997-03-03", itemCode: "GRACE-A", colour: "", qty: 40, group: "PTMT" }],
      cachedAt: new Date("1997-04-01T00:00:00Z"),
    });

    const { bundle, weekly } = await computeLifecyclePlantMonitoring(
      month,
      new Date("1997-04-07T23:59:59Z"),
      {
        fetchActuals: async (_selectedMonth, options) => {
          assert.equal(options.forceRefresh, true);
          assert.equal(options.requireFresh, true);
          throw new Error("upstream unavailable");
        },
      },
    );
    assert.equal(bundle.monitoringStatus, "grace");
    assert.equal(bundle.targetsAvailable, true);
    assert.equal(bundle.actualsAvailable, false);
    assert.match(bundle.unavailableReason ?? "", /could not be refreshed/i);
    assert.equal(bundle.plant.targetMax, 100);
    assert.equal(bundle.plant.producedToDate, 0, "stale cached actuals must not be represented as current");
    assert.equal(weekly.plant.weeks[0]?.target, 100);
    assert.equal(weekly.plant.weeks[0]?.actual, 0);
  } finally {
    await db.delete(plantMonitoringSnapshotsTable).where(eq(plantMonitoringSnapshotsTable.month, month));
    await db.delete(plantIngestionCacheTable).where(eq(plantIngestionCacheTable.month, month));
    await db.delete(planRunsTable).where(and(eq(planRunsTable.month, month), eq(planRunsTable.segment, "PTMT")));
  }
});

test("a captured closed-month snapshot stays byte-for-byte stable after source rows change", async () => {
  await runMigrations();
  const month = "1998-02";
  await db.delete(plantMonitoringSnapshotsTable).where(eq(plantMonitoringSnapshotsTable.month, month));
  await db.delete(plantIngestionCacheTable).where(eq(plantIngestionCacheTable.month, month));
  await db.delete(planRunsTable).where(and(eq(planRunsTable.month, month), eq(planRunsTable.segment, "PTMT")));

  try {
    const [run] = await db.insert(planRunsTable).values({
      month,
      segment: "PTMT",
      status: "finalized",
      weeklyReleaseVersion: 1,
    }).returning();
    await db.insert(planRunResultsTable).values({
      runId: run.id,
      itemCode: "SNAPSHOT-A",
      colour: "",
      category: "Snapshot Test",
      productionPlan: 100,
      minProduction: 80,
      bufferReq: 0,
      releaseWeek: 1,
      w1: 100,
      w2: 0,
      w3: 0,
      w4: 0,
    });
    await db.insert(plantIngestionCacheTable).values({
      month,
      snapshotDate: "1998-02-28",
      rawActualsJson: [{ date: "1998-02-02", itemCode: "SNAPSHOT-A", colour: "", qty: 40, group: "PTMT" }],
      cachedAt: new Date("1998-03-01T00:00:00Z"),
    });

    const beforeBackfill = await computeLifecyclePlantMonitoring(month, new Date("2026-08-19T12:00:00Z"));
    assert.equal(beforeBackfill.bundle.monitoringStatus, "unavailable");
    assert.match(beforeBackfill.bundle.unavailableReason ?? "", /no frozen monitoring snapshot/i);
    const snapshotsBefore = await db
      .select()
      .from(plantMonitoringSnapshotsTable)
      .where(eq(plantMonitoringSnapshotsTable.month, month));
    assert.equal(snapshotsBefore.length, 0, "a normal closed-month read must not capture a snapshot");

    const first = await captureClosedPlantMonth(
      month,
      new Date("2026-08-19T12:00:00Z"),
      { refreshActuals: false },
    );
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.bundle.monitoringStatus, "frozen");
    assert.equal(first.bundle.plant.targetMax, 100);
    assert.equal(first.bundle.plant.producedToDate, 40);
    assert.equal(first.weekly.plant.weeks[0]?.target, 100);
    assert.equal(first.weekly.currentWeek, 4);
    assert.ok(first.weekly.plant.weeks.every((week) => week.target <= 0 || week.attainmentPct !== null));

    await db.update(planRunResultsTable).set({ productionPlan: 999 }).where(eq(planRunResultsTable.runId, run.id));
    await db.update(plantIngestionCacheTable).set({
      rawActualsJson: [{ date: "1998-02-02", itemCode: "SNAPSHOT-A", colour: "", qty: 999, group: "PTMT" }],
      cachedAt: new Date("2026-08-19T00:00:00Z"),
    }).where(eq(plantIngestionCacheTable.month, month));

    const second = await captureClosedPlantMonth(
      month,
      new Date("2026-08-19T12:00:00Z"),
      { refreshActuals: false },
    );
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.deepEqual(second.bundle, first.bundle);
    assert.deepEqual(second.weekly, first.weekly);
  } finally {
    await db.delete(plantMonitoringSnapshotsTable).where(eq(plantMonitoringSnapshotsTable.month, month));
    await db.delete(plantIngestionCacheTable).where(eq(plantIngestionCacheTable.month, month));
    await db.delete(planRunsTable).where(and(eq(planRunsTable.month, month), eq(planRunsTable.segment, "PTMT")));
  }
});

test("legacy frozen snapshot restores its captured immutable item timeline and preserves weekly totals", async () => {
  await runMigrations();
  const month = "1998-03";
  await db.delete(plantMonitoringSnapshotsTable).where(eq(plantMonitoringSnapshotsTable.month, month));
  await db.delete(plantPlanVersionsTable).where(and(eq(plantPlanVersionsTable.month, month), eq(plantPlanVersionsTable.segment, "PTMT")));
  await db.delete(planRunsTable).where(and(eq(planRunsTable.month, month), eq(planRunsTable.segment, "PTMT")));

  try {
    const [run] = await db.insert(planRunsTable).values({
      month,
      segment: "PTMT",
      status: "finalized",
      effectiveFrom: `${month}-01`,
      weeklyReleaseVersion: 1,
    }).returning();
    const target = {
      itemCode: "BACKFILL-A",
      colour: "RED",
      category: "Backfill Test",
      maxPcs: 100,
      minPcs: 80,
      w1: 30,
      w2: 30,
      w3: 20,
      w4: 20,
    };
    await db.insert(planRunResultsTable).values({
      runId: run.id,
      itemCode: target.itemCode,
      colour: target.colour,
      category: target.category,
      productionPlan: target.maxPcs,
      minProduction: target.minPcs,
      bufferReq: 0,
      releaseWeek: 1,
      w1: target.w1,
      w2: target.w2,
      w3: target.w3,
      w4: target.w4,
    });
    await savePlanVersionSnapshot({
      month,
      segment: "PTMT",
      kind: "run",
      sourceId: run.id,
      effectiveFrom: `${month}-01`,
      sourceLabel: "March issued plan",
      targets: [target],
    });
    await db.insert(plantMonitoringSnapshotsTable).values({
      month,
      planRunId: run.id,
      actualsJson: [{ date: `${month}-02`, itemCode: target.itemCode, colour: target.colour, qty: 40, group: "PTMT" }],
      targetsJson: [{ itemCode: target.itemCode, colour: target.colour, category: target.category, maxPcs: 100, minPcs: 80 }],
      bundleJson: { context: { sourceInfo: { planVersions: [] } } },
      weeklyJson: {},
      sourceInfoJson: {
        planVersions: [{
          kind: "run",
          sourceId: run.id,
          sourceLabel: "March issued plan",
          effectiveFrom: `${month}-01`,
          effectiveTo: null,
          targetCount: 1,
        }],
      },
      // Always later than the test's issued-version write, proving the backfill
      // can only use a source that existed when this snapshot was captured.
      capturedAt: new Date("2099-01-01T00:00:00.000Z"),
    });

    const restored = await backfillLegacyPlantMonitoringSnapshot(month);
    assert.equal(restored.restored, true);
    const sourceInfo = restored.snapshot?.sourceInfoJson as Record<string, unknown>;
    const timeline = sourceInfo.planVersionTimeline as import("./plant-plan-timeline").PlanVersion[];
    assert.equal(sourceInfo.planVersionTimelineSource, "issued_plan_version_snapshot");
    assert.equal(timeline.length, 1);
    assert.deepEqual(timeline[0]?.targets, [target]);

    // Item, category, and monthly totals are rebuilt from the immutable W1–W4
    // timeline and satisfy the same sums the report invariants enforce.
    const planMap = buildVersionAwarePlanMap(month, timeline);
    const item = planMap.get("BACKFILL-A::RED");
    assert.deepEqual(item && [item.w1, item.w2, item.w3, item.w4, item.plan], [30, 30, 20, 20, 100]);
    const weekly = buildPlantWeeklySummary(
      month,
      [{ date: `${month}-02`, itemCode: target.itemCode, colour: target.colour, qty: 40 }],
      [],
      [{ itemCode: target.itemCode, colour: target.colour, category: target.category }],
      `${month}-31`,
      true,
      timeline,
    );
    const categoryWeeks = weekly.categories.find((row) => row.category === target.category)?.weeks ?? [];
    assert.equal(categoryWeeks.reduce((sum, week) => sum + week.target, 0), 100);
    assert.equal(categoryWeeks.reduce((sum, week) => sum + week.actual, 0), 40);

    const retry = await backfillLegacyPlantMonitoringSnapshot(month);
    assert.equal(retry.restored, false, "a restored snapshot is never rewritten on later reads");
    assert.deepEqual(retry.snapshot?.sourceInfoJson, restored.snapshot?.sourceInfoJson);
  } finally {
    await db.delete(plantMonitoringSnapshotsTable).where(eq(plantMonitoringSnapshotsTable.month, month));
    await db.delete(plantPlanVersionsTable).where(and(eq(plantPlanVersionsTable.month, month), eq(plantPlanVersionsTable.segment, "PTMT")));
    await db.delete(planRunsTable).where(and(eq(planRunsTable.month, month), eq(planRunsTable.segment, "PTMT")));
  }
});

test("legacy frozen snapshot without a matching immutable issued timeline remains explicitly unavailable", async () => {
  await runMigrations();
  const month = "1998-04";
  await db.delete(plantMonitoringSnapshotsTable).where(eq(plantMonitoringSnapshotsTable.month, month));
  await db.delete(plantPlanVersionsTable).where(and(eq(plantPlanVersionsTable.month, month), eq(plantPlanVersionsTable.segment, "PTMT")));

  try {
    await db.insert(plantMonitoringSnapshotsTable).values({
      month,
      actualsJson: [],
      targetsJson: [],
      bundleJson: {},
      weeklyJson: {},
      sourceInfoJson: {
        planVersions: [{
          kind: "run",
          sourceId: 987654321,
          sourceLabel: "Missing immutable plan",
          effectiveFrom: `${month}-01`,
          effectiveTo: null,
          targetCount: 1,
        }],
      },
      capturedAt: new Date("2099-01-01T00:00:00.000Z"),
    });

    const restored = await backfillLegacyPlantMonitoringSnapshot(month);
    assert.equal(restored.restored, false);
    assert.match(restored.reason ?? "", /no matching immutable issued snapshot/i);

    const report = await computePlanVsActualReport(month, "PTMT", new Date("2026-08-19T12:00:00.000Z"));
    assert.equal(report.dataAvailable, false);
    assert.match(report.unavailableReason ?? "", /no matching immutable issued snapshot/i);
  } finally {
    await db.delete(plantMonitoringSnapshotsTable).where(eq(plantMonitoringSnapshotsTable.month, month));
    await db.delete(plantPlanVersionsTable).where(and(eq(plantPlanVersionsTable.month, month), eq(plantPlanVersionsTable.segment, "PTMT")));
  }
});

test("legacy backfill refuses an immutable version whose final targets do not match the snapshot roster", async () => {
  await runMigrations();
  const month = "1998-05";
  await db.delete(plantMonitoringSnapshotsTable).where(eq(plantMonitoringSnapshotsTable.month, month));
  await db.delete(plantPlanVersionsTable).where(and(eq(plantPlanVersionsTable.month, month), eq(plantPlanVersionsTable.segment, "PTMT")));
  await db.delete(planRunsTable).where(and(eq(planRunsTable.month, month), eq(planRunsTable.segment, "PTMT")));

  try {
    const [run] = await db.insert(planRunsTable).values({
      month,
      segment: "PTMT",
      status: "finalized",
      effectiveFrom: `${month}-01`,
      weeklyReleaseVersion: 1,
    }).returning();
    const frozenTarget = {
      itemCode: "MUTATED-A",
      colour: "",
      category: "Mutation Test",
      maxPcs: 100,
      minPcs: 80,
      w1: 100,
      w2: 0,
      w3: 0,
      w4: 0,
    };
    await savePlanVersionSnapshot({
      month,
      segment: "PTMT",
      kind: "run",
      sourceId: run.id,
      effectiveFrom: `${month}-01`,
      targets: [{ ...frozenTarget, maxPcs: 999, w1: 999 }],
    });
    await db.insert(plantMonitoringSnapshotsTable).values({
      month,
      planRunId: run.id,
      actualsJson: [],
      targetsJson: [{
        itemCode: frozenTarget.itemCode,
        colour: frozenTarget.colour,
        category: frozenTarget.category,
        maxPcs: frozenTarget.maxPcs,
        minPcs: frozenTarget.minPcs,
      }],
      bundleJson: {},
      weeklyJson: {},
      sourceInfoJson: {
        planVersions: [{
          kind: "run",
          sourceId: run.id,
          sourceLabel: null,
          effectiveFrom: `${month}-01`,
          effectiveTo: null,
          targetCount: 1,
        }],
      },
      capturedAt: new Date("2099-01-01T00:00:00.000Z"),
    });

    const restored = await backfillLegacyPlantMonitoringSnapshot(month);
    assert.equal(restored.restored, false);
    assert.match(restored.reason ?? "", /does not match the final target roster/i);
  } finally {
    await db.delete(plantMonitoringSnapshotsTable).where(eq(plantMonitoringSnapshotsTable.month, month));
    await db.delete(plantPlanVersionsTable).where(and(eq(plantPlanVersionsTable.month, month), eq(plantPlanVersionsTable.segment, "PTMT")));
    await db.delete(planRunsTable).where(and(eq(planRunsTable.month, month), eq(planRunsTable.segment, "PTMT")));
  }
});
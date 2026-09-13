import { test } from "node:test";
import assert from "node:assert/strict";

// The route module constructs the shared DB client at import time. These
// demand-guard tests never query it or call the plant.
process.env.DATABASE_URL ??= "postgres://fit-test:fit-test@localhost:5432/fit_test";
const {
  buildPlumbingFitDemand,
  buildPlumbingFitSummary,
  fitAllocationNetByCode,
  legacyScheduleEligibility,
  plumbingFitAttemptIsStale,
  plumbingFitRetryFingerprint,
  plumbingFitAttemptLeaseIsOwned,
  plumbingTemporaryDeletionGuard,
} = await import("./plan-runs");

function row(id: number, itemCode: string, category: string, material: string | null, quantity = 10): any {
  return {
    id,
    itemCode,
    colour: "",
    category,
    material,
    demandPlan: quantity,
    productionPlan: quantity,
    temporaryPlan: quantity,
  };
}

test("Plumbing demand guard accepts corroborated material and omits unknown fitting prefix", () => {
  const result = buildPlumbingFitDemand([
    row(1, "C-PIPE", "CPVC Pipe", "CPVC"),
    row(2, "U-FIT", "UPVC Fitting", "UPVC"),
    row(3, "X-FIT", "CPVC Fitting", "CPVC"),
    row(4, "PS-2", "CPVC Pipe", "CPVC"),
    row(5, "PW11", "SWR Pipe", "SWR"),
    row(6, "PU-11", "UPVC Pipe", "UPVC"),
  ]);
  assert.equal(result.demandByKind.pipe.length, 4);
  assert.equal(result.demandByKind.fitting.length, 1);
  assert.deepEqual([...result.unknownFittings], [3]);
  assert.equal(result.materialBySourceId.get(1), "CPVC");
  assert.equal(result.materialBySourceId.get(2), "UPVC");
  assert.equal(result.materialBySourceId.has(3), false);
  assert.equal(result.materialBySourceId.get(4), "CPVC");
  assert.equal(result.materialBySourceId.get(5), "SWR");
  assert.equal(result.materialBySourceId.get(6), "UPVC");
});

test("Plumbing demand guard rejects recognized prefix disagreement and normalized duplicates by kind", () => {
  assert.throws(
    () => buildPlumbingFitDemand([row(1, "C-FIT", "UPVC Fitting", "UPVC")]),
    /material disagreement/,
  );
  assert.throws(
    () => buildPlumbingFitDemand([row(1, "C-FIT", "UPVC Fitting", "CPVC")]),
    /material disagreement/,
  );
  assert.throws(
    () => buildPlumbingFitDemand([row(1, "PS-2", "CPVC Pipe", "SWR")]),
    /pipe material disagreement/,
  );
  assert.throws(
    () => buildPlumbingFitDemand([
      row(1, "C-PIPE", "CPVC Pipe", "CPVC"),
      row(2, "CPIPE", "CPVC Pipe", "CPVC"),
    ]),
    /Duplicate normalized Plumbing pipe code/,
  );
});

test("zero-quantity rows are skipped before duplicate scheduler-line detection", () => {
  assert.doesNotThrow(() => buildPlumbingFitDemand([
    row(1, "C-PIPE", "CPVC Pipe", "CPVC", 0),
    row(2, "CPIPE", "CPVC Pipe", "CPVC", 10),
  ]));
});

test("legacy schedule guard rejects Temporary runs without mutating them", () => {
  assert.deepEqual(
    legacyScheduleEligibility({ segment: "Plumbing", planType: "temporary" }),
    {
      error: "LEGACY_SCHEDULE_PRODUCTION_ONLY",
      message: "Legacy scheduling cannot mutate a Temporary run; use fit-plumbing for finalized Plumbing Temporary runs.",
    },
  );
  assert.equal(legacyScheduleEligibility({ segment: "Plumbing", planType: "production" }), null);
});

test("running fit attempts become stale only after five minutes", () => {
  const now = Date.parse("2026-01-01T00:10:00.000Z");
  assert.equal(plumbingFitAttemptIsStale({ state: "running", updatedAt: new Date(now - 299_999) }, now), false);
  assert.equal(plumbingFitAttemptIsStale({ state: "running", updatedAt: new Date(now - 300_001) }, now), true);
  assert.equal(plumbingFitAttemptIsStale({ state: "failed", updatedAt: new Date(0) }, now), false);
});

test("failed fit retries use a deterministic distinct fingerprint without changing the prior attempt", () => {
  const original = "a".repeat(64);
  const retry = plumbingFitRetryFingerprint(original, 1);
  assert.equal(retry.length, 64);
  assert.notEqual(retry, original);
  assert.equal(plumbingFitRetryFingerprint(original, 1), retry);
  assert.notEqual(plumbingFitRetryFingerprint(retry, 2), retry);
});

test("fit attempt lease and Temporary lineage deletion guards are transition-safe", () => {
  assert.equal(plumbingFitAttemptLeaseIsOwned({ id: 7, state: "running" }, 7), true);
  assert.equal(plumbingFitAttemptLeaseIsOwned({ id: 7, state: "abandoned" }, 7), false);
  assert.equal(plumbingFitAttemptLeaseIsOwned({ id: 8, state: "running" }, 7), false);
  assert.equal(plumbingFitAttemptLeaseIsOwned(undefined, 7), false);

  assert.equal(plumbingTemporaryDeletionGuard({ planType: "production" }, 1, 1), null);
  assert.equal(plumbingTemporaryDeletionGuard({ planType: "temporary" }, 0, 0), null);
  assert.deepEqual(
    plumbingTemporaryDeletionGuard({ planType: "temporary" }, 0, 1),
    {
      error: "PLUMBING_TEMPORARY_LINEAGE_LOCKED",
      message: "A Plumbing Temporary run referenced by a Production run or fit attempt cannot be deleted.",
    },
  );
});

test("allocation net helper preserves four-decimal values and separates Pipe/Fitting keys", () => {
  const values = fitAllocationNetByCode([
    { kind: "pipe", raw: { allocations: [
      { item_code: "C-1", scheduled_net_pcs: 9.9 },
      { item_code: "C-2", scheduled_net_pcs: 5.1 },
    ] } },
    { kind: "fitting", raw: { allocations: [{ item_code: "C-1", scheduled_net_pcs: 2.3456 }] } },
  ]);
  assert.equal(values.get("pipe::C1"), 9.9);
  assert.equal(values.get("pipe::C2"), 5.1);
  assert.equal((values.get("pipe::C1") ?? 0) + (values.get("pipe::C2") ?? 0), 15);
  assert.equal(values.get("fitting::C1"), 2.3456);
});

test("fit summary keeps authoritative compensating net allocations", () => {
  const sourceRows = [
    row(1, "C-1", "CPVC Pipe", "CPVC", 10),
    row(2, "C-2", "CPVC Pipe", "CPVC", 5),
  ];
  const demand = buildPlumbingFitDemand(sourceRows);
  const allocationByCode = fitAllocationNetByCode([{
    kind: "pipe",
    raw: {
      allocations: [
        { item_code: "C-1", scheduled_net_pcs: 9.9 },
        { item_code: "C-2", scheduled_net_pcs: 5.1 },
      ],
    },
  }]);
  const summary = buildPlumbingFitSummary({
    sourceRows,
    demand,
    allocationByCode,
    sourceRunId: 7,
    schedule: {
      data_limited: [],
      unroutable: [],
      merged: { unfinished: [] },
      results: [],
      sentDemandByKind: { pipe: [], fitting: [] },
    },
  } as any);
  assert.equal(summary.executableNet, 15);
  assert.equal(summary.fulfilledAgainstDemand, 14.9);
  assert.ok(Math.abs(Number(summary.roundingDriftNet) - 0.1) < 1e-9);
  assert.ok(Math.abs(Number(summary.unfeasiblePieces) - 0.1) < 1e-9);
  assert.equal(allocationByCode.get("pipe::C1"), 9.9);
  assert.equal(allocationByCode.get("pipe::C2"), 5.1);
});
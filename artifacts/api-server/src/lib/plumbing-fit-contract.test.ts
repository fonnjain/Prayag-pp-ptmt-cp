import { test } from "node:test";
import assert from "node:assert/strict";
import { assertAllocationContract } from "./plumbing-scheduler";

const demand = [
  { item_code: "C-1", material: "CPVC", qty_pcs: 10 },
  { item_code: "C-2", material: "CPVC", qty_pcs: 5 },
];

function response(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    allocation_schema_version: "2",
    reference: "machine-reference-1",
    demand_reconciliation: {
      submitted_requested_pcs: 15,
      scheduled_gross_pcs: 15,
      net_conservation: {
        passed: true,
        status: "passed",
        drift_net_pcs: 0,
        items: [
          { item_code: "C-1", passed: true, submitted_net_pcs: 10, allocated_net_pcs: 10, unfinished_net_pcs: 0, data_limited_net_pcs: 0, accounted_net_pcs: 10, drift_net_pcs: 0 },
          { item_code: "C-2", passed: true, submitted_net_pcs: 5, allocated_net_pcs: 5, unfinished_net_pcs: 0, data_limited_net_pcs: 0, accounted_net_pcs: 5, drift_net_pcs: 0 },
        ],
      },
    },
    allocations: [
      { item_code: "C-1", scheduled_net_pcs: 10, scheduled_gross_pcs: 10, scheduled_kg: 1 },
      { item_code: "C-2", scheduled_net_pcs: 5, scheduled_gross_pcs: 5, scheduled_kg: 0.5 },
    ],
    blocks: [
      { item_code: "C-1", scheduled_net_pcs: 10, scheduled_gross_pcs: 10, scheduled_kg: 1 },
      { item_code: "C-2", scheduled_net_pcs: 5, scheduled_gross_pcs: 5, scheduled_kg: 0.5 },
      { is_idle: true, scheduled_net_pcs: 999, scheduled_gross_pcs: 999, scheduled_kg: 999 },
    ],
    unfinished: [],
    ...overrides,
  };
}

test("strict allocation contract accepts v2 and ignores is_idle blocks", () => {
  assert.deepEqual(assertAllocationContract(response(), "pipe", demand), []);
});

test("strict v2 requires canonical arrays and finite numeric fields", () => {
  assert.throws(() => assertAllocationContract(response({ allocations: undefined }), "pipe", demand), /allocations/);
  assert.throws(() => assertAllocationContract(response({ blocks: undefined }), "pipe", demand), /blocks/);
  assert.throws(() => assertAllocationContract(response({ unfinished: undefined }), "pipe", demand), /unfinished/);
  assert.throws(() => assertAllocationContract(response({ allocation_schema_version: 1 }), "pipe", demand), /allocation_schema_version/);
  assert.throws(() => assertAllocationContract(response({
    demand_reconciliation: { submitted_requested_pcs: 15 },
  }), "pipe", demand), /scheduled_gross_pcs/);
  assert.throws(() => assertAllocationContract(response({
    allocations: [{ item_code: "C-1", scheduled_net_pcs: "10", scheduled_gross_pcs: 10, scheduled_kg: 1 }],
  }), "pipe", demand), /invalid/);
  assert.throws(() => assertAllocationContract(response({
    blocks: [{ item_code: "C-1", net_pcs: 10, gross_pcs: 10, kg: 1 }],
  }), "pipe", demand), /missing scheduled_net_pcs/);
  assert.throws(() => assertAllocationContract(response({
    allocations: [{ item_code: "C-1", scheduled_net_pcs: 10, scheduled_gross_pcs: 10, scheduled_kg: 1 }],
    blocks: [{ item_code: "C-1", scheduled_net_pcs: 10, scheduled_gross_pcs: 10, scheduled_kg: 1 }],
    demand_reconciliation: { submitted_requested_pcs: Number.NaN, scheduled_gross_pcs: 10 },
  }), "pipe", demand), /invalid/);
});

test("strict v2 allows repeated allocation codes for split machine/date rows", () => {
  assert.doesNotThrow(() => assertAllocationContract(response({
    allocations: [
      { item_code: "C-1", scheduled_net_pcs: 4, scheduled_gross_pcs: 4, scheduled_kg: 0.4 },
      { item_code: "C-1", scheduled_net_pcs: 6, scheduled_gross_pcs: 6, scheduled_kg: 0.6 },
      { item_code: "C-2", scheduled_net_pcs: 5, scheduled_gross_pcs: 5, scheduled_kg: 0.5 },
    ],
    blocks: [
      { item_code: "C-1", scheduled_net_pcs: 4, scheduled_gross_pcs: 4, scheduled_kg: 0.4 },
      { item_code: "C-1", scheduled_net_pcs: 6, scheduled_gross_pcs: 6, scheduled_kg: 0.6 },
      { item_code: "C-2", scheduled_net_pcs: 5, scheduled_gross_pcs: 5, scheduled_kg: 0.5 },
    ],
  }), "pipe", demand));
});

test("strict allocation contract rejects missing version, negatives, and whole-response drift", () => {
  assert.throws(() => assertAllocationContract(response({ allocation_schema_version: "1" }), "pipe", demand), /allocation_schema_version/);
  assert.throws(() => assertAllocationContract(response({
    allocations: [{ item_code: "C-1", scheduled_net_pcs: -1, scheduled_gross_pcs: 0, scheduled_kg: 0 }],
    blocks: [{ item_code: "C-1", scheduled_net_pcs: -1, scheduled_gross_pcs: 0, scheduled_kg: 0 }],
    demand_reconciliation: { submitted_requested_pcs: 10, scheduled_gross_pcs: 0 },
  }), "pipe", demand), /negative/);
  assert.throws(() => assertAllocationContract(response({
    allocations: [{ item_code: "C-1", scheduled_net_pcs: -0.00001, scheduled_gross_pcs: 0, scheduled_kg: 0 }],
    blocks: [{ item_code: "C-1", scheduled_net_pcs: -0.00001, scheduled_gross_pcs: 0, scheduled_kg: 0 }],
    demand_reconciliation: { submitted_requested_pcs: 10, scheduled_gross_pcs: 0 },
  }), "pipe", demand), /negative/);
  assert.throws(() => assertAllocationContract(response({
     blocks: [{ item_code: "C-1", scheduled_net_pcs: 9, scheduled_gross_pcs: 10, scheduled_kg: 1 }, { item_code: "C-2", scheduled_net_pcs: 5, scheduled_gross_pcs: 5, scheduled_kg: 0.5 }],
  }), "pipe", demand), /reconciliation mismatch/);
});

test("strict allocation contract retains v2 per-item drift as warning while response totals stay hard", () => {
  const warnings = assertAllocationContract(response({
    allocations: [
       { item_code: "C-1", scheduled_net_pcs: 9.99995, scheduled_gross_pcs: 10, scheduled_kg: 1 },
       { item_code: "C-2", scheduled_net_pcs: 5, scheduled_gross_pcs: 5, scheduled_kg: 0.5 },
    ],
    blocks: [
       { item_code: "C-1", scheduled_net_pcs: 9.99995, scheduled_gross_pcs: 10, scheduled_kg: 1 },
       { item_code: "C-2", scheduled_net_pcs: 5, scheduled_gross_pcs: 5, scheduled_kg: 0.5 },
    ],
    demand_reconciliation: {
      submitted_requested_pcs: 15,
      scheduled_gross_pcs: 15,
      net_conservation: {
        passed: true,
        status: "passed",
        drift_net_pcs: -0.0001,
        items: [
          { item_code: "C-1", passed: true, submitted_net_pcs: 10, allocated_net_pcs: 9.99995, unfinished_net_pcs: 0, data_limited_net_pcs: 0, accounted_net_pcs: 9.99995, drift_net_pcs: 0.00005 },
          { item_code: "C-2", passed: true, submitted_net_pcs: 5, allocated_net_pcs: 5, unfinished_net_pcs: 0, data_limited_net_pcs: 0, accounted_net_pcs: 5, drift_net_pcs: 0 },
        ],
      },
    },
  }), "pipe", demand);
  assert.equal(warnings.length, 0, "relative tolerance accepts harmless accumulation drift");

  const larger = assertAllocationContract(response({
    allocations: [
       { item_code: "C-1", scheduled_net_pcs: 9.9, scheduled_gross_pcs: 10, scheduled_kg: 1 },
       { item_code: "C-2", scheduled_net_pcs: 5.1, scheduled_gross_pcs: 5, scheduled_kg: 0.5 },
    ],
    blocks: [
       { item_code: "C-1", scheduled_net_pcs: 9.9, scheduled_gross_pcs: 10, scheduled_kg: 1 },
       { item_code: "C-2", scheduled_net_pcs: 5.1, scheduled_gross_pcs: 5, scheduled_kg: 0.5 },
    ],
    demand_reconciliation: {
      submitted_requested_pcs: 15,
      scheduled_gross_pcs: 15,
      net_conservation: {
        passed: true,
        status: "passed",
        drift_net_pcs: 0,
        items: [
          { item_code: "C-1", passed: false, submitted_net_pcs: 10, allocated_net_pcs: 9.9, unfinished_net_pcs: 0, data_limited_net_pcs: 0, accounted_net_pcs: 9.9, drift_net_pcs: 0.1 },
          { item_code: "C-2", passed: false, submitted_net_pcs: 5, allocated_net_pcs: 5.1, unfinished_net_pcs: 0, data_limited_net_pcs: 0, accounted_net_pcs: 5.1, drift_net_pcs: -0.1 },
        ],
      },
    },
  }), "pipe", demand);
  assert.ok(larger.some((warning) => warning.includes("code=C1") && warning.includes("drift=0.1")));
});

test("response-wide conservation uses a relative tolerance with an absolute floor", () => {
  const largeDemand = [{ item_code: "P-1", material: "CPVC", qty_pcs: 286_053 }];
  const largeResponse = (drift: number) => response({
    demand_reconciliation: {
      submitted_requested_pcs: 286_053,
      scheduled_gross_pcs: 286_053 + drift,
      net_conservation: {
        passed: true,
        status: "passed",
        drift_net_pcs: -drift,
        items: [{
          item_code: "P-1",
          passed: true,
          submitted_net_pcs: 286_053,
          allocated_net_pcs: 286_053 + drift,
          unfinished_net_pcs: 0,
          data_limited_net_pcs: 0,
          accounted_net_pcs: 286_053 + drift,
          drift_net_pcs: -drift,
        }],
      },
    },
    allocations: [{
      item_code: "P-1",
      scheduled_net_pcs: 286_053 + drift,
      scheduled_gross_pcs: 286_053 + drift,
      scheduled_kg: 1,
    }],
    blocks: [{
      item_code: "P-1",
      scheduled_net_pcs: 286_053 + drift,
      scheduled_gross_pcs: 286_053 + drift,
      scheduled_kg: 1,
    }],
  });

  assert.doesNotThrow(
    () => assertAllocationContract(largeResponse(0.0002), "pipe", largeDemand),
    "attempt #1 drift of 0.0002 must pass against the 0.01 floor",
  );
  assert.throws(
    () => assertAllocationContract(largeResponse(0.02), "pipe", largeDemand),
    /does not conserve submitted demand/,
    "a 0.02-piece drift must remain a hard failure",
  );
  assert.throws(
    () => assertAllocationContract(largeResponse(315.34), "pipe", largeDemand),
    /does not conserve submitted demand/,
    "the historical +315.34 overcount must remain a hard failure",
  );
});
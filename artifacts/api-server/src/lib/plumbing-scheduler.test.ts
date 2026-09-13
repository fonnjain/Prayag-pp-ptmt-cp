import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPlumbingWeekDays,
  runPlumbingSchedule,
  runPlumbingCorrectiveSchedule,
} from "./plumbing-scheduler";

function contractFields(body: Record<string, unknown>, dataLimited: unknown[] = []): Record<string, unknown> {
  const demand = Array.isArray(body.demand) ? body.demand as Array<Record<string, unknown>> : [];
  return {
    coverage: {
      items: demand.map((item) => ({
        item_code: item.item_code,
        requested_pcs: item.qty_pcs,
        status: "schedulable",
      })),
    },
    data_limited: dataLimited,
    demand_reconciliation: {
      submitted_requested_pcs: demand.reduce((sum, item) => sum + Number(item.qty_pcs ?? 0), 0),
    },
    params_used: { week_days: body.week_days },
  };
}

test("Plumbing calendar includes observed worked Sundays in the four buckets", () => {
  assert.deepEqual(
    buildPlumbingWeekDays("2026-08", ["2026-08-09", "2026-08-16", "2026-08-23"]),
    [6, 7, 7, 9],
  );
});

test("Plumbing scheduler sends pipe then fitting with an identical calendar and merges results", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.PRAYAG_PLANT_API_KEY;
  const requests: Array<Record<string, unknown>> = [];
  process.env.PRAYAG_PLANT_API_KEY = "test-key";
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push(body);
    const kind = body.kind as string;
    return new Response(JSON.stringify({
      kind,
      week_days: body.week_days,
      ...contractFields(body),
      blocks: [{ kind }],
      weekly_fill: [{
        machine: kind === "pipe" ? "M/C-1" : "C04(U-250)",
        capacity_hrs: kind === "pipe" ? 100 : 200,
        scheduled_hrs: kind === "pipe" ? 100 : 80,
        idle_hrs: kind === "pipe" ? 0 : 120,
        utilisation_pct: kind === "pipe" ? 100 : 40,
      }],
      unfinished: [{
        item_code: kind === "pipe" ? "P-1" : "F-1",
        material: kind === "pipe" ? "CPVC" : "UPVC",
        remaining_pcs: kind === "pipe" ? 10 : 20,
        remaining_kg: kind === "pipe" ? 4 : 6,
        remaining_hours: kind === "pipe" ? 1.5 : 2.5,
        capable_machines: [kind === "pipe" ? "M/C-1" : "C04(U-250)"],
      }],
      total_capacity_hrs: kind === "pipe" ? 100 : 200,
      total_scheduled_hrs: kind === "pipe" ? 8 : 18,
      total_idle_hrs: kind === "pipe" ? 92 : 182,
      downtime_hours_lost: kind === "pipe" ? 12 : 102,
      downtime_machine_days: kind === "pipe" ? 0.5 : 2,
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    const result = await runPlumbingSchedule({
      month: "2026-08",
      workedSundayDates: ["2026-08-09", "2026-08-16", "2026-08-23"],
      demandByKind: {
        pipe: [{ item_code: "P-1", material: "CPVC", qty_pcs: 100 }],
        fitting: [{ item_code: "F-1", material: "UPVC", qty_pcs: 200 }],
      },
      weightByCode: new Map([["P-1", 0.4], ["F-1", 0.3]]),
      machineLockedOut: new Map([["M/C-1", true], ["C04(U-250)", false]]),
    });

    assert.deepEqual(requests.map((request) => request.kind), ["pipe", "fitting"]);
    assert.deepEqual(requests[0]!.week_days, [6, 7, 7, 9]);
    assert.deepEqual(requests[1]!.week_days, requests[0]!.week_days);
    assert.equal(requests[0]!.segment, "PLUMBING");
    assert.equal(requests[1]!.segment, "PLUMBING");
    assert.deepEqual(result.results.map((item) => item.kind), ["pipe", "fitting"]);
    assert.equal(result.demand.pieces, 300);
    assert.equal(result.scheduled.pieces, 270);
    assert.equal(result.unfinished.pieces, 30);
    assert.equal(result.unfinished.kg, 10);
    assert.equal(result.unfinished.hours, 4);
    assert.equal(result.downtime_hours_lost, 114);
    assert.equal(result.downtime_machine_days, 2.5);
    assert.equal(result.unallocated_hours, 0);
    assert.equal(result.results[0]!.unfinished_capability[0]!.capable_machines[0]!.locked_out, true);
    assert.equal(result.results[0]!.unfinished_capability[0]!.capable_machines[0]!.saturated, true);
    assert.equal(result.results[1]!.unfinished_capability[0]!.capable_machines[0]!.saturated, false);
    assert.deepEqual(result.merged.blocks, [{ kind: "pipe" }, { kind: "fitting" }]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.PRAYAG_PLANT_API_KEY;
    else process.env.PRAYAG_PLANT_API_KEY = originalKey;
  }
});

test("Plumbing parser keeps coverage data-limited rows out of scheduled pieces", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.PRAYAG_PLANT_API_KEY;
  process.env.PRAYAG_PLANT_API_KEY = "test-key";
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const demand = body.demand as Array<Record<string, unknown>>;
    const limited = body.kind === "pipe"
      ? [{ item_code: "DL-1", requested_pcs: 7, reasons: ["missing BOM"] }]
      : [];
    return new Response(JSON.stringify({
      kind: body.kind,
      week_days: body.week_days,
      ...contractFields(body, limited),
      blocks: demand
        .filter((item) => item.item_code !== "DL-1")
        .map((item) => ({ item_code: item.item_code, week: 1, planned_hours: 1 })),
      weekly_fill: [],
      unfinished: [],
      total_capacity_hrs: 100,
      total_scheduled_hrs: 30,
      total_idle_hrs: 70,
      downtime_hours_lost: 0,
      downtime_machine_days: 0,
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    const result = await runPlumbingSchedule({
      month: "2026-09",
      workedSundayDates: [],
      demandByKind: {
        pipe: [
          { item_code: "DL-1", material: "CPVC", qty_pcs: 7 },
          { item_code: "P-1", material: "CPVC", qty_pcs: 10 },
        ],
        fitting: [{ item_code: "F-1", material: "UPVC", qty_pcs: 20 }],
      },
      weightByCode: new Map(),
    });

    assert.deepEqual(result.week_days, [6, 6, 6, 8]);
    assert.equal(result.working_days_provenance.total_days, 26);
    assert.equal(result.data_limited_pieces, 7);
    assert.equal(result.scheduled.pieces, 30);
    assert.equal(result.unfinished.pieces, 0);
    assert.deepEqual(result.data_limited, [{
      kind: "pipe",
      item_code: "DL-1",
      material: "CPVC",
      qty_pcs: 7,
      reason: "missing BOM",
    }]);
    assert.equal(result.results[0]!.total_scheduled_pcs, 10);
    assert.equal(result.results[0]!.total_data_limited_pcs, 7);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.PRAYAG_PLANT_API_KEY;
    else process.env.PRAYAG_PLANT_API_KEY = originalKey;
  }
});

test("Plumbing parser uses v2 net remainders, retains gross remainders, and captures evidence", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.PRAYAG_PLANT_API_KEY;
  process.env.PRAYAG_PLANT_API_KEY = "test-key";
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const demand = body.demand as Array<Record<string, unknown>>;
    const isPipe = body.kind === "pipe";
    return new Response(JSON.stringify({
      kind: body.kind,
      week_days: body.week_days,
      ...contractFields(body),
      net_conservation: { balanced: true, remaining_net_pcs: isPipe ? 2 : 0 },
      timings_ms: { total: isPipe ? 17 : 19, server: 11 },
      blocks: demand.map((item) => ({ item_code: item.item_code })),
      weekly_fill: [],
      unfinished: isPipe
        ? [{
          item_code: "P-1",
          material: "CPVC",
          remaining_pcs: null,
          remaining_net_pcs: 2,
          remaining_gross_pcs: 3,
          remaining_kg: 1,
          remaining_hours: 0.5,
          net_conservation: { balanced: true },
        }]
        : [],
      total_capacity_hrs: 10,
      total_scheduled_hrs: 8,
      total_idle_hrs: 2,
      downtime_hours_lost: 0,
      downtime_machine_days: 0,
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    const result = await runPlumbingSchedule({
      month: "2026-09",
      workedSundayDates: [],
      demandByKind: {
        pipe: [{ item_code: "P-1", material: "CPVC", qty_pcs: 10 }],
        fitting: [{ item_code: "F-1", material: "UPVC", qty_pcs: 20 }],
      },
      weightByCode: new Map([["P-1", 0.5], ["F-1", 0.5]]),
    });

    const pipe = result.results[0]!;
    assert.equal(pipe.total_unfinished_pcs, 2);
    assert.equal(pipe.total_unfinished_gross_pcs, 3);
    assert.equal(pipe.unfinished[0]!.remaining_pcs, 2);
    assert.equal(pipe.unfinished[0]!.remaining_net_pcs, 2);
    assert.equal(pipe.unfinished[0]!.remaining_gross_pcs, 3);
    assert.deepEqual(pipe.unfinished[0]!.net_conservation, { balanced: true });
    assert.deepEqual(pipe.net_conservation, { balanced: true, remaining_net_pcs: 2 });
    assert.deepEqual(pipe.timings_ms, { total: 17, server: 11 });
    assert.equal(result.unfinished.pieces, 2);
    assert.equal(result.unfinished.gross_pieces, 3);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.PRAYAG_PLANT_API_KEY;
    else process.env.PRAYAG_PLANT_API_KEY = originalKey;
  }
});

test("Plumbing parser does not turn unavailable legacy remainder snapshots into zero", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.PRAYAG_PLANT_API_KEY;
  process.env.PRAYAG_PLANT_API_KEY = "test-key";
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      kind: body.kind,
      week_days: body.week_days,
      ...contractFields(body),
      blocks: [],
      weekly_fill: [],
      unfinished: [{
        item_code: "P-1",
        material: "CPVC",
        remaining_pcs: null,
        remaining_kg: 1,
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    await assert.rejects(
      runPlumbingSchedule({
        month: "2026-09",
        workedSundayDates: [],
        demandByKind: {
          pipe: [{ item_code: "P-1", material: "CPVC", qty_pcs: 10 }],
          fitting: [{ item_code: "F-1", material: "UPVC", qty_pcs: 20 }],
        },
        weightByCode: new Map(),
      }),
      /unavailable remaining_pcs; refusing to treat it as zero/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.PRAYAG_PLANT_API_KEY;
    else process.env.PRAYAG_PLANT_API_KEY = originalKey;
  }
});

test("Plumbing parser rejects an item reported as both unfinished and data-limited", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.PRAYAG_PLANT_API_KEY;
  process.env.PRAYAG_PLANT_API_KEY = "test-key";
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      kind: body.kind,
      week_days: body.week_days,
      ...contractFields(body, [{ item_code: "P-1", requested_pcs: 10 }]),
      blocks: [],
      weekly_fill: [],
      unfinished: [{
        item_code: "P-1",
        material: "CPVC",
        remaining_pcs: 1,
        remaining_kg: 1,
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    await assert.rejects(
      runPlumbingSchedule({
        month: "2026-09",
        workedSundayDates: [],
        demandByKind: {
          pipe: [{ item_code: "P-1", material: "CPVC", qty_pcs: 10 }],
          fitting: [{ item_code: "F-1", material: "UPVC", qty_pcs: 20 }],
        },
        weightByCode: new Map(),
      }),
      /both unfinished and data_limited/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.PRAYAG_PLANT_API_KEY;
    else process.env.PRAYAG_PLANT_API_KEY = originalKey;
  }
});

test("corrective scheduler persists and applies the original-week offset", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.PRAYAG_PLANT_API_KEY;
  const requests: Array<Record<string, unknown>> = [];
  process.env.PRAYAG_PLANT_API_KEY = "test-key";
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push(body);
    return new Response(JSON.stringify({
      kind: body.kind,
      week_days: body.week_days,
      ...contractFields(body),
      blocks: [{
        item_code: "P-1",
        week: 1,
        planned_hours: 10,
      }],
      weekly_fill: [],
      unfinished: [],
      total_capacity_hrs: 10,
      total_scheduled_hrs: 10,
      total_idle_hrs: 0,
      downtime_hours_lost: 0,
      downtime_machine_days: 0,
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    const result = await runPlumbingCorrectiveSchedule({
      month: "2026-08",
      weeks: [
        { originalWeek: 3, workingDays: 4 },
        { originalWeek: 4, workingDays: 9 },
      ],
      demandByKind: {
        pipe: [{ item_code: "P-1", material: "CPVC", qty_pcs: 100 }],
        fitting: [],
      },
      weightByCode: new Map([["P-1", 0.4]]),
    });

    assert.deepEqual(requests.map((request) => request.week_days), [[4, 4, 2, 3]]);
    assert.equal(result.weekOffset, 2);
    assert.deepEqual(result.originalWeeks, [3, 4]);
    assert.deepEqual(result.weekDays, [4, 9]);
    assert.deepEqual(result.allocations[0]!.weeks, [0, 0, 100, 0]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.PRAYAG_PLANT_API_KEY;
    else process.env.PRAYAG_PLANT_API_KEY = originalKey;
  }
});

test("corrective scheduler floors payload quantities and reports sub-one-piece exclusions", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.PRAYAG_PLANT_API_KEY;
  const requests: Array<Record<string, unknown>> = [];
  process.env.PRAYAG_PLANT_API_KEY = "test-key";
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push(body);
    return new Response(JSON.stringify({
      kind: body.kind,
      week_days: body.week_days,
      ...contractFields(body),
      blocks: [{ item_code: "P-1", week: 1, planned_hours: 1 }],
      weekly_fill: [],
      unfinished: [],
      total_capacity_hrs: 1,
      total_scheduled_hrs: 1,
      total_idle_hrs: 0,
      downtime_hours_lost: 0,
      downtime_machine_days: 0,
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    const result = await runPlumbingCorrectiveSchedule({
      month: "2026-08",
      weeks: [{ originalWeek: 3, workingDays: 4 }],
      demandByKind: {
        pipe: [{ item_code: "P-1", material: "CPVC", qty_pcs: 1.49 }],
        fitting: [{ item_code: "F-1", material: "AGRI", qty_pcs: 0.35 }],
      },
      weightByCode: new Map([["P-1", 0.4]]),
    });

    assert.deepEqual(requests[0]!.demand, [{
      item_code: "P-1",
      material: "CPVC",
      qty_pcs: 1,
    }]);
    assert.equal(result.payloadAudit.candidate_pipe_rows, 1);
    assert.equal(result.payloadAudit.candidate_fitting_rows, 1);
    assert.equal(result.payloadAudit.sent_pipe_rows, 1);
    assert.equal(result.payloadAudit.sent_fitting_rows, 0);
    assert.equal(result.payloadAudit.sub_one_piece_excluded_rows, 1);
    assert.equal(result.payloadAudit.sub_one_piece_excluded_quantity, 0.35);
    assert.deepEqual(result.payloadAudit.sub_one_piece_excluded[0], {
      kind: "fitting",
      item_code: "F-1",
      material: "AGRI",
      remaining_pcs: 0.35,
      rounded_pcs: 0,
      reason: "SUB_ONE_PIECE_REMAINDER",
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.PRAYAG_PLANT_API_KEY;
    else process.env.PRAYAG_PLANT_API_KEY = originalKey;
  }
});
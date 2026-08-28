import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPlumbingWeekDays,
  runPlumbingSchedule,
  runPlumbingCorrectiveSchedule,
} from "./plumbing-scheduler";

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

    assert.deepEqual(requests.map((request) => request.week_days), [[4, 9]]);
    assert.equal(result.weekOffset, 2);
    assert.deepEqual(result.originalWeeks, [3, 4]);
    assert.deepEqual(result.allocations[0]!.weeks, [0, 0, 100, 0]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.PRAYAG_PLANT_API_KEY;
    else process.env.PRAYAG_PLANT_API_KEY = originalKey;
  }
});
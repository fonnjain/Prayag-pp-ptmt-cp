import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import http from "node:http";
import {
  _setPlantMonitoringComputeForTest,
  getPlantMonitoringCached,
  invalidatePlantBundleCache,
} from "./plant.js";
import plantRouter from "./plant.js";
import { isPlantSegment, normalizePlantSegment, PLANT_SEGMENTS, plantSegmentProfile } from "../lib/plant-segments.js";
import { PlanningInputError } from "./plan.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("plant bundle and weekly consumers share one cold monitoring computation", async () => {
  invalidatePlantBundleCache();
  let calls = 0;
  const payload = { bundle: { marker: "bundle" }, weekly: { marker: "weekly" } } as any;
  const restore = _setPlantMonitoringComputeForTest(async () => {
    calls++;
    return payload;
  });
  try {
    const [bundleConsumer, weeklyConsumer] = await Promise.all([
      getPlantMonitoringCached("2099-01"),
      getPlantMonitoringCached("2099-01"),
    ]);
    assert.equal(calls, 1, "parallel dashboard requests use one computation");
    assert.equal((bundleConsumer.bundle as any).marker, "bundle");
    assert.equal((weeklyConsumer.weekly as any).marker, "weekly");
    await getPlantMonitoringCached("2099-01");
    assert.equal(calls, 1, "warm request uses the completed monitoring cache");
  } finally {
    restore();
    invalidatePlantBundleCache();
  }
});

test("invalidating plant monitoring ignores an older in-flight result", async () => {
  invalidatePlantBundleCache();
  const first = deferred<any>();
  let calls = 0;
  const restore = _setPlantMonitoringComputeForTest(async () => {
    calls++;
    return calls === 1 ? first.promise : { bundle: { fresh: true }, weekly: { fresh: true } } as any;
  });
  try {
    const stalePromise = getPlantMonitoringCached("2099-02");
    invalidatePlantBundleCache("2099-02");
    const fresh = await getPlantMonitoringCached("2099-02");
    assert.equal(calls, 2, "post-invalidation request starts a fresh computation");
    assert.equal((fresh.bundle as any).fresh, true);

    first.resolve({ bundle: { stale: true }, weekly: { stale: true } });
    await stalePromise;
    const afterStaleCompletion = await getPlantMonitoringCached("2099-02");
    assert.equal((afterStaleCompletion.bundle as any).fresh, true, "older completion cannot overwrite fresh cache");
  } finally {
    restore();
    invalidatePlantBundleCache();
  }
});

test("the shared monitoring cache keeps PTMT and Plumbing bundles isolated", async () => {
  invalidatePlantBundleCache();
  let calls = 0;
  const restore = _setPlantMonitoringComputeForTest(async (_month) => {
    calls++;
    return {
      bundle: { segmentMarker: calls === 1 ? "PTMT" : "Plumbing" },
      weekly: { segmentMarker: calls === 1 ? "PTMT" : "Plumbing" },
    } as any;
  });
  try {
    const ptmt = await getPlantMonitoringCached("2099-03", "PTMT");
    const plumbing = await getPlantMonitoringCached("2099-03", "Plumbing");
    const ptmtAgain = await getPlantMonitoringCached("2099-03", "PTMT");
    assert.equal(calls, 2, "each segment computes once and then uses its own cache entry");
    assert.equal((ptmt.bundle as any).segmentMarker, "PTMT");
    assert.equal((plumbing.bundle as any).segmentMarker, "Plumbing");
    assert.equal((ptmtAgain.bundle as any).segmentMarker, "PTMT");
  } finally {
    restore();
    invalidatePlantBundleCache();
  }
});

test("the segment registry contains only the supported plant profiles", () => {
  assert.deepEqual(PLANT_SEGMENTS, ["PTMT", "Plumbing"]);
  assert.equal(normalizePlantSegment(undefined), "PTMT");
  for (const segment of PLANT_SEGMENTS) {
    assert.equal(normalizePlantSegment(segment.toLowerCase()), segment);
    assert.equal(normalizePlantSegment(segment.toUpperCase()), segment);
    assert.equal(normalizePlantSegment(segment), segment);
  }
  assert.equal(normalizePlantSegment("NOT_A_SEGMENT"), null);
  assert.equal(normalizePlantSegment(" cp "), null);
  assert.equal(isPlantSegment(" ptmt "), true);
  assert.equal(isPlantSegment("PLUMBING"), true);
  assert.equal(isPlantSegment("NOT_A_SEGMENT"), false);
  assert.equal(plantSegmentProfile("PTMT").orderGroup, "PTMT");
  assert.equal(plantSegmentProfile("Plumbing").orderGroup, "PLUMBING");
});

test("weekly plant summary maps the held MRP gate to a named 422", async () => {
  invalidatePlantBundleCache();
  const restore = _setPlantMonitoringComputeForTest(async () => {
    throw new PlanningInputError(
      "PTMT planning is held by authoritative MRP controls (source 1): approval required",
      undefined,
      "PTMT_MRP_APPROVAL_REQUIRED",
    );
  });
  const app = express();
  app.use("/api", plantRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/plant/weekly-summary?month=2026-09&segment=PTMT`);
    assert.equal(response.status, 422);
    assert.deepEqual(await response.json(), {
      error: "PTMT_MRP_APPROVAL_REQUIRED",
      message: "PTMT planning is held by authoritative MRP controls (source 1): approval required",
      kind: "PlanningInputError",
      month: "2026-09",
      segment: "PTMT",
    });
  } finally {
    server.close();
    restore();
    invalidatePlantBundleCache();
  }
});
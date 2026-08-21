import assert from "node:assert/strict";
import { test } from "node:test";
import {
  _setPlantMonitoringComputeForTest,
  getPlantMonitoringCached,
  invalidatePlantBundleCache,
} from "./plant.js";
import { normalizePlantSegment, PLANT_SEGMENTS, plantSegmentProfile } from "../lib/plant-segments.js";

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
  assert.equal(normalizePlantSegment("plumbing"), "Plumbing");
  assert.equal(normalizePlantSegment("CP"), null);
  assert.equal(plantSegmentProfile("PTMT").orderGroup, "PTMT");
  assert.equal(plantSegmentProfile("Plumbing").orderGroup, "PLUMBING");
});
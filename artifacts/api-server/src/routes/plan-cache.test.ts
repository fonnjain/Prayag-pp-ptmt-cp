/**
 * Unit tests for the Plumbing monitoring payload cache (getPlumbingMonitoringPayloadCached).
 *
 * Focus: invalidation during an in-flight computation must disregard that
 * computation — it must not be reused by later callers, and its completion
 * must not repopulate the cache with pre-sync data.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getPlumbingMonitoringPayloadCached,
  invalidatePlumbingMonitoringCache,
  _setPlumbingMonitoringComputeForTest,
} from "./plan.js";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

test("caches the computed payload and dedupes concurrent cold hits", async () => {
  invalidatePlumbingMonitoringCache();
  let calls = 0;
  const restore = _setPlumbingMonitoringComputeForTest(async (month) => {
    calls++;
    return { month, calls };
  });
  try {
    const [a, b] = await Promise.all([
      getPlumbingMonitoringPayloadCached("2099-01"),
      getPlumbingMonitoringPayloadCached("2099-01"),
    ]);
    assert.equal(calls, 1, "concurrent cold hits share one computation");
    assert.deepEqual(a, b);
    const c = await getPlumbingMonitoringPayloadCached("2099-01");
    assert.equal(calls, 1, "warm hit served from cache");
    assert.deepEqual(c, a);
  } finally {
    restore();
    invalidatePlumbingMonitoringCache();
  }
});

test("invalidate while a computation is pending: next getter runs fresh; old completion cannot populate the cache", async () => {
  invalidatePlumbingMonitoringCache();
  const first = deferred<unknown>();
  let calls = 0;
  const restore = _setPlumbingMonitoringComputeForTest(async () => {
    calls++;
    if (calls === 1) return first.promise; // stays pending across the invalidation
    return { fresh: true, call: calls };
  });
  try {
    // Start a computation, then invalidate while it is still in flight.
    const stalePromise = getPlumbingMonitoringPayloadCached("2099-02");
    assert.equal(calls, 1);
    invalidatePlumbingMonitoringCache();

    // A new getter must NOT reuse the pre-invalidation in-flight promise.
    const freshPromise = getPlumbingMonitoringPayloadCached("2099-02");
    assert.equal(calls, 2, "post-invalidation getter invokes a fresh computation");
    const fresh = await freshPromise;
    assert.deepEqual(fresh, { fresh: true, call: 2 });

    // Now let the OLD computation finish — it must not overwrite the cache.
    first.resolve({ stale: true });
    await stalePromise;
    const afterOldCompletes = await getPlumbingMonitoringPayloadCached("2099-02");
    assert.deepEqual(
      afterOldCompletes,
      { fresh: true, call: 2 },
      "old completion did not repopulate the cache with pre-sync data",
    );
    assert.equal(calls, 2, "no extra computation needed — fresh result stayed cached");
  } finally {
    restore();
    invalidatePlumbingMonitoringCache();
  }
});

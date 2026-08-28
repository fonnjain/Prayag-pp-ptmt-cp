import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateAlerts } from "./alerts";

test("unreadable required input is suppressed and never counted as green", async () => {
  const unreadable = new Error("current_stock: required C/Stock column is missing");
  const result = await evaluateAlerts("2099-01", "PTMT", {
    getMonitoring: async () => {
      throw unreadable;
    },
    buildPlanItems: async () => {
      throw unreadable;
    },
    readSourceProblems: async () => [
      "current_stock: required C/Stock column is missing",
    ],
  });

  const suppressed = result.alerts.filter((alert) => alert.state === "suppressed");
  const clear = result.alerts.filter((alert) => alert.state === "clear");
  const r5 = result.alerts.find((alert) => alert.code === "R5");

  assert.equal(result.summary.total, 7);
  assert.equal(result.summary.suppressed, suppressed.length);
  assert.equal(result.summary.clear, clear.length);
  assert.equal(result.summary.clear, 0);
  assert.ok(suppressed.length > 0);
  assert.equal(r5?.state, "suppressed");
  assert.match(r5?.message ?? "", /C\/Stock column is missing/);
  assert.equal(result.summary.suppressed, 6);
  assert.equal(result.alerts.some((alert) => alert.state === "clear" && alert.code === "R5"), false);
});
import assert from "node:assert/strict";
import test from "node:test";
import { governedExportFilename } from "./export-filename";

const exportDay = new Date("2026-09-12T12:00:00.000Z");

test("governed filename uses the exported run rather than UI state", () => {
  assert.equal(
    governedExportFilename({
      segment: "Plumbing",
      kind: "Temporary",
      month: "2026-09",
      runId: 42,
      extension: "xlsx",
      date: exportDay,
    }),
    "Plumbing_Temporary_2026-09_Run42_2026-09-12.xlsx",
  );
});

test("governed filename preserves a PTMT run identity", () => {
  assert.equal(
    governedExportFilename({
      segment: "PTMT",
      kind: "Production",
      month: "2026-09",
      runId: 43,
      extension: "xlsx",
      date: exportDay,
    }),
    "PTMT_Production_2026-09_Run43_2026-09-12.xlsx",
  );
});

test("weekly and PDF names use the same convention", () => {
  assert.equal(
    governedExportFilename({
      segment: "Plumbing",
      kind: "WeeklyRelease",
      month: "2026-09",
      runId: 42,
      extension: "pdf",
      date: exportDay,
    }),
    "Plumbing_WeeklyRelease_2026-09_Run42_2026-09-12.pdf",
  );
});

test("corrective Standard and Detail exports remain distinct", () => {
  const base = {
    segment: "PTMT",
    kind: "CorrectiveRePlan" as const,
    month: "2026-09",
    runId: 101,
    extension: "xlsx" as const,
    date: exportDay,
  };
  assert.equal(
    governedExportFilename({ ...base, variant: "Standard" }),
    "PTMT_CorrectiveRePlan_Standard_2026-09_Run101_2026-09-12.xlsx",
  );
  assert.equal(
    governedExportFilename({ ...base, variant: "Detail" }),
    "PTMT_CorrectiveRePlan_Detail_2026-09_Run101_2026-09-12.xlsx",
  );
});
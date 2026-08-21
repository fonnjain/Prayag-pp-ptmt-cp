import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildElapsedProductionDays, buildPlantBundle } from "./plant-engine";
import type { DailyActualRow, PlantTargetRow } from "./plant-ingestion";

type FixtureName = "ptmtJune" | "plumbingJune" | "ptmtAugust" | "plumbingAugust";

const fixtureFiles: Record<FixtureName, string> = {
  ptmtJune: "../../../../.agents/outputs/2026-08-20_ptmt-june-authoritative-production.csv",
  plumbingJune: "../../../../.agents/outputs/2026-08-20_plumbing-june-sheet3.csv",
  ptmtAugust: "../../../../.agents/outputs/2026-08-20_ptmt-august-production.csv",
  plumbingAugust: "../../../../.agents/outputs/2026-08-20_plumbing-august-sheet3.csv",
};

const fixtureExpectations: Record<FixtureName, { month: string; total: number; sundayTotal: number; snapshotDate: string; lifecycle: "open" | "closed" }> = {
  ptmtJune: { month: "2026-06", total: 933653, sundayTotal: 13146, snapshotDate: "2026-06-30", lifecycle: "closed" },
  plumbingJune: { month: "2026-06", total: 1463741, sundayTotal: 19072, snapshotDate: "2026-06-30", lifecycle: "closed" },
  ptmtAugust: { month: "2026-08", total: 573456, sundayTotal: 17153, snapshotDate: "2026-08-19", lifecycle: "open" },
  plumbingAugust: { month: "2026-08", total: 696179, sundayTotal: 31151, snapshotDate: "2026-08-13", lifecycle: "open" },
};

function readFixture(name: FixtureName): DailyActualRow[] {
  const text = readFileSync(new URL(fixtureFiles[name], import.meta.url), "utf8");
  const lines = text.trim().split(/\r?\n/);
  const isPtmt = name.startsWith("ptmt");
  return lines.slice(1).map((line) => {
    const fields = line.split(",");
    return {
      date: fields[0],
      itemCode: fields[1],
      colour: isPtmt ? fields[2] : "",
      qty: Number(isPtmt ? fields[3] : fields[2]),
      group: isPtmt ? "PTMT" : "PLUMBING",
    };
  });
}

function targetsFor(rows: DailyActualRow[]): PlantTargetRow[] {
  const keys = new Set<string>();
  return rows.reduce<PlantTargetRow[]>((targets, row) => {
    const key = `${row.itemCode}\u0000${row.colour}`;
    if (keys.has(key)) return targets;
    keys.add(key);
    targets.push({
      itemCode: row.itemCode,
      colour: row.colour,
      category: "Fixture",
      maxPcs: 1_000_000,
      minPcs: 800_000,
    });
    return targets;
  }, []);
}

function buildFixtureBundle(
  name: FixtureName,
  rows = readFixture(name),
  overrides: Partial<Parameters<typeof buildPlantBundle>[3]> = {},
) {
  const expectation = fixtureExpectations[name];
  return buildPlantBundle(
    expectation.month,
    rows,
    targetsFor(rows),
    {
      workingDays: 26,
      elapsed: 0,
      shiftsPerDay: 2,
      shiftHours: 12,
      snapshotDate: expectation.snapshotDate,
      lifecycle: expectation.lifecycle,
      workingDaysSource: "derived",
      ...overrides,
    },
  );
}

for (const name of Object.keys(fixtureFiles) as FixtureName[]) {
  test(`${name} counts every loaded production row, including Sundays`, () => {
    const rows = readFixture(name);
    const expectation = fixtureExpectations[name];
    const bundle = buildFixtureBundle(name, rows);
    const categoryProduced = bundle.categories.reduce((sum, category) => sum + category.producedToDate, 0);

    assert.equal(rows.reduce((sum, row) => sum + row.qty, 0), expectation.total);
    assert.equal(bundle.plant.producedToDate, expectation.total);
    assert.equal(categoryProduced, expectation.total);
    assert.equal(bundle.categories[0]?.producedToDate, expectation.total);
    assert.equal(
      rows.filter((row) => new Date(`${row.date}T00:00:00Z`).getUTCDay() === 0).reduce((sum, row) => sum + row.qty, 0),
      expectation.sundayTotal,
    );
  });
}

test("worked Sunday production keeps the final calendar day in elapsed production days", () => {
  const days = buildElapsedProductionDays(
    "2026-06",
    new Map([
      ["2026-06-28", 856],
      ["2026-06-29", 42386],
      ["2026-06-30", 34847],
    ]),
    "2026-06-30",
  );

  assert.deepEqual(days.slice(-3), ["2026-06-28", "2026-06-29", "2026-06-30"]);
});

test("a month with no Sunday production keeps the previous subtotal", () => {
  const allRows = readFixture("ptmtJune");
  const rows = allRows.filter((row) => new Date(`${row.date}T00:00:00Z`).getUTCDay() !== 0);
  const bundle = buildFixtureBundle("ptmtJune", rows);
  const expected = 933653 - 13146;

  assert.equal(bundle.plant.producedToDate, expected);
  assert.equal(bundle.categories.reduce((sum, category) => sum + category.producedToDate, 0), expected);
});

test("the plant guard throws when a loaded row is excluded by the snapshot date", () => {
  const rows = readFixture("ptmtJune").filter((row) => row.date === "2026-06-01" || row.date === "2026-06-30");

  assert.throws(
    () => buildPlantBundle(
      "2026-06",
      rows,
      targetsFor(rows),
      {
        workingDays: 26,
        elapsed: 0,
        shiftsPerDay: 2,
        shiftHours: 12,
        snapshotDate: "2026-06-29",
        lifecycle: "open",
        workingDaysSource: "derived",
      },
    ),
    /34847 pcs loaded but not counted for 2026-06/,
  );
});

test("unmatched production is reported as explicit unattributed quantity", () => {
  const matched = readFixture("ptmtJune")[0];
  const unmatched: DailyActualRow = {
    date: matched.date,
    itemCode: "UNMATCHED-FIXTURE-ROW",
    colour: "",
    qty: 7,
    group: "PTMT",
  };

  const bundle = buildPlantBundle(
    "2026-06",
    [matched, unmatched],
    targetsFor([matched]),
    {
      workingDays: 26,
      elapsed: 0,
      shiftsPerDay: 2,
      shiftHours: 12,
      snapshotDate: matched.date,
      lifecycle: "open",
      workingDaysSource: "derived",
    },
  );

  assert.equal(bundle.unattributedPcs, 7);
  assert.equal(bundle.categories.reduce((sum, category) => sum + category.producedToDate, 0), matched.qty);
  assert.match(bundle.caveats.at(-1) ?? "", /7 pcs excluded from category totals/);
});

test("closed-month working days include worked Sundays for both segments", () => {
  assert.equal(buildFixtureBundle("ptmtJune").context.workingDays, 29);
  assert.equal(buildFixtureBundle("ptmtJune").context.workingDaysSource, "observed");
  assert.equal(buildFixtureBundle("plumbingJune").context.workingDays, 27);
  assert.equal(buildFixtureBundle("plumbingJune").context.workingDaysSource, "observed");
});

test("open-month configured working days override observed Sundays", () => {
  const bundle = buildFixtureBundle("ptmtAugust", undefined, {
    workingDays: 25,
    workingDaysSource: "configured",
  });

  assert.equal(bundle.context.workingDays, 25);
  assert.equal(bundle.context.workingDaysSource, "configured");
  assert.equal(bundle.context.elapsed <= bundle.context.workingDays, true);
  assert.ok(Math.abs(bundle.plant.requiredPerDay * bundle.context.workingDays - bundle.plant.targetMax) < 2);
});

test("closed-month observed working days override configured values", () => {
  const bundle = buildFixtureBundle("ptmtJune", undefined, {
    workingDays: 25,
    workingDaysSource: "configured",
  });

  assert.equal(bundle.context.workingDays, 29);
  assert.equal(bundle.context.workingDaysSource, "observed");
});

test("open-month projection includes remaining calendar non-Sundays without shrinking for idle weekdays", () => {
  const bundle = buildFixtureBundle("ptmtAugust");
  const elapsedDays = buildElapsedProductionDays(
    "2026-08",
    new Map(readFixture("ptmtAugust").map((row) => [row.date, row.qty])),
    "2026-08-19",
  );

  assert.equal(bundle.context.workingDays, 28);
  assert.equal(bundle.context.workingDaysSource, "observed");
  assert.equal(bundle.context.elapsed, elapsedDays.length);
  assert.equal(bundle.context.remaining, 10);
  assert.ok(bundle.caveats.some((caveat) => /no production/.test(caveat)));
  assert.ok(Math.abs(bundle.plant.requiredPerDay * bundle.context.workingDays - bundle.plant.targetMax) < 2);
});

test("future month with no actuals uses the calendar-derived fallback", () => {
  const bundle = buildPlantBundle(
    "2026-09",
    [],
    [{ itemCode: "FUTURE", colour: "", category: "Fixture", maxPcs: 100, minPcs: 80 }],
    {
      workingDays: 26,
      elapsed: 0,
      shiftsPerDay: 2,
      shiftHours: 12,
      snapshotDate: null,
      lifecycle: "future",
      workingDaysSource: "derived",
    },
  );

  assert.equal(bundle.context.workingDays, 26);
  assert.equal(bundle.context.workingDaysSource, "derived");
  assert.equal(bundle.context.elapsed <= bundle.context.workingDays, true);
});

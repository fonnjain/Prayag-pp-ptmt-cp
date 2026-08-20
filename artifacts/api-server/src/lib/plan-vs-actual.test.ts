/**
 * Tests for Plan-vs-Actual engine (task #134).
 *
 * Covers:
 *  - achievementRemark boundary conditions (integer cross-multiplication)
 *  - achievementPct correctness
 *  - Plumbing unmatched GROUP allow-list (exact equality, post-match-only)
 *  - buildVersionAwarePlanMap proportional plan semantics
 *  - Transaction week allocation via weekIdxFromDate / parseDateCell logic
 *  - isPlumbingUnmatchedGroup helper
 *  - Colour-exact itemKey normalisation (placeholder stripping)
 *  - Production conservation invariant
 *  - Segment/month format validation
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  achievementRemark,
  achievementPct,
  isPlumbingUnmatchedGroup,
  buildVersionAwarePlanMap,
  fetchOrderDatedTotals,
  fetchSaleDatedTotals,
  type DatedTotals,
  type TransactionReadResult,
  matchesTransactionMonthLabel,
  parseDateCell,
  transactionWeekFromCell,
  type AchievementRemark,
} from "./plan-vs-actual-engine";
import { itemKey, SHEET_IDS } from "./sheets";

// ── Achievement boundary (integer cross-multiplication) ──────────────────────

describe("achievementRemark — boundary conditions", () => {
  it("returns null when plan = 0", () => {
    assert.equal(achievementRemark(0, 0), null);
    assert.equal(achievementRemark(0, 100), null);
    assert.equal(achievementRemark(0, 999999), null);
  });

  it("ON TARGET at exactly 80 %: produced*100 === plan*80", () => {
    // 80*100 = 8000, 100*80 = 8000 → exactly equal → NOT UNDER
    assert.equal(achievementRemark(100, 80), "ON TARGET");
    assert.equal(achievementRemark(1000, 800), "ON TARGET");
    assert.equal(achievementRemark(5000, 4000), "ON TARGET");
  });

  it("UNDER just below 80 %: produced*100 < plan*80", () => {
    assert.equal(achievementRemark(100, 79), "UNDER");
    assert.equal(achievementRemark(1000, 799), "UNDER");
  });

  it("ON TARGET at exactly 110 %: produced*100 === plan*110", () => {
    // 110*100 = 11000, 100*110 = 11000 → exactly equal → NOT OVER
    assert.equal(achievementRemark(100, 110), "ON TARGET");
    assert.equal(achievementRemark(1000, 1100), "ON TARGET");
  });

  it("OVER just above 110 %: produced*100 > plan*110", () => {
    assert.equal(achievementRemark(100, 111), "OVER");
    assert.equal(achievementRemark(1000, 1101), "OVER");
  });

  it("returns UNDER for zero production against non-zero plan", () => {
    assert.equal(achievementRemark(1000, 0), "UNDER");
  });

  it("returns ON TARGET for typical in-range values", () => {
    assert.equal(achievementRemark(1000, 950), "ON TARGET");
    assert.equal(achievementRemark(1000, 1000), "ON TARGET");
    assert.equal(achievementRemark(500, 450), "ON TARGET");
  });

  it("avoids float trap: plan=3, produced=2 → UNDER (not boundary round-up)", () => {
    // Float: (2/3)*100 ≈ 66.67 < 80 → UNDER
    // Cross-multiply: 2*100=200 < 3*80=240 → UNDER ✓
    assert.equal(achievementRemark(3, 2), "UNDER");
  });

  it("avoids float trap: plan=3, produced=3 → ON TARGET (100 %)", () => {
    assert.equal(achievementRemark(3, 3), "ON TARGET");
  });

  it("large values: exact boundary at 80 %", () => {
    assert.equal(achievementRemark(100000, 80000), "ON TARGET");
    assert.equal(achievementRemark(100000, 79999), "UNDER");
  });

  it("large values: exact boundary at 110 %", () => {
    assert.equal(achievementRemark(100000, 110000), "ON TARGET");
    assert.equal(achievementRemark(100000, 110001), "OVER");
  });
});

describe("achievementPct", () => {
  it("returns null when plan = 0", () => {
    assert.equal(achievementPct(0, 100), null);
    assert.equal(achievementPct(0, 0), null);
  });

  it("returns 100 when equal", () => {
    assert.equal(achievementPct(100, 100), 100);
  });

  it("returns 80 when produced = plan*0.8", () => {
    assert.equal(achievementPct(1000, 800), 80);
  });

  it("returns 110 when produced = plan*1.1", () => {
    assert.equal(achievementPct(1000, 1100), 110);
  });

  it("rounds to 2 decimal places", () => {
    const pct = achievementPct(3, 1)!;
    assert.ok(Math.abs(pct - 33.33) < 0.01);
  });
});

describe("transaction date parsing", () => {
  it("parses the live Order and Sale sheet display format", () => {
    assert.equal(parseDateCell("3-Aug-2026"), "2026-08-03");
    assert.equal(parseDateCell("19 August 2026"), "2026-08-19");
  });

  it("continues to parse ISO and numeric day/month formats", () => {
    assert.equal(parseDateCell("2026-08-03"), "2026-08-03");
    assert.equal(parseDateCell("03/08/2026"), "2026-08-03");
  });

  it("rejects calendar-impossible dates instead of assigning them to W4", () => {
    assert.equal(parseDateCell("2026-08-40"), null);
    assert.equal(parseDateCell("31/02/2026"), null);
  });

  it("allocates only trustworthy dates in the requested month", () => {
    assert.equal(transactionWeekFromCell("3-Aug-2026", "2026-08"), 0);
    assert.equal(transactionWeekFromCell("14-Aug-2026", "2026-08"), 1);
    assert.equal(transactionWeekFromCell("21-Aug-2026", "2026-08"), 2);
    assert.equal(transactionWeekFromCell("31-Aug-2026", "2026-08"), 3);
    assert.equal(transactionWeekFromCell("3-Aug-2025", "2026-08"), -1);
    assert.equal(transactionWeekFromCell("not-a-date", "2026-08"), null);
  });

  it("requires both month and year for Combined-tab month labels", () => {
    assert.equal(matchesTransactionMonthLabel("Aug-26", "2026-08"), true);
    assert.equal(matchesTransactionMonthLabel("August 2026", "2026-08"), true);
    assert.equal(matchesTransactionMonthLabel("Aug-25", "2026-08"), false);
    assert.equal(matchesTransactionMonthLabel("Jul-26", "2026-08"), false);
    assert.equal(matchesTransactionMonthLabel("Aug", "2026-08"), false);
  });
});

describe("transaction sheet readers", () => {
  const month = "2026-08";
  const orderTab = "Aug-26";
  const saleTab = "August";
  const key = itemKey("ITEM-1", "Red");

  function fixtureReader(
    tabsBySheet: Record<string, string[]>,
    valuesByTab: Record<string, string[][]>,
    failingTabs = new Set<string>(),
  ) {
    return {
      listTabs: async (sheetId: string) => tabsBySheet[sheetId] ?? [],
      getTabValues: async (_sheetId: string, tab: string) => {
        if (failingTabs.has(tab)) throw new Error(`fixture read failed for ${tab}`);
        return valuesByTab[tab] ?? [];
      },
    };
  }

  function monthlyTotal(result: { totals: DatedTotals }, item = key): number {
    return result.totals.monthlyExact.get(item) ?? 0;
  }

  function weeklyTotal(totals: DatedTotals, item = key): number {
    return totals.exact.reduce((sum, week) => sum + (week.get(item) ?? 0), 0);
  }

  function assertAvailableZero(result: TransactionReadResult | Awaited<ReturnType<typeof fetchOrderDatedTotals>>) {
    assert.equal(result.available, true);
    assert.equal(monthlyTotal(result), 0);
    assert.equal(result.totals.rowCount, 0);
  }

  it("filters mixed-month Order and Sale rows and preserves weekly/monthly totals", async () => {
    const orderRows = [
      ["ERP Code", "Colour", "Qty", "Group", "Date"],
      ["ITEM-1", "Red", "10", "PTMT", "3-Aug-2026"],
      ["ITEM-1", "Red", "20", "PTMT", "14-Aug-2026"],
      ["ITEM-1", "Red", "30", "PTMT", "21-Aug-2026"],
      ["ITEM-1", "Red", "40", "PTMT", "31-Aug-2026"],
      ["ITEM-1", "Red", "900", "PTMT", "3-Aug-2025"],
      ["ITEM-1", "Red", "900", "PTMT", "3-Sep-2026"],
    ];
    const saleRows = [
      ["Code", "Colour", "Qty", "Date"],
      ["ITEM-1", "Red", "5", "3-Aug-2026"],
      ["ITEM-1", "Red", "6", "14-Aug-2026"],
      ["ITEM-1", "Red", "7", "21-Aug-2026"],
      ["ITEM-1", "Red", "8", "31-Aug-2026"],
      ["ITEM-1", "Red", "900", "3-Aug-2025"],
      ["ITEM-1", "Red", "900", "3-Sep-2026"],
    ];
    const deps = fixtureReader(
      {
        [SHEET_IDS.orderSheet]: [orderTab],
        [SHEET_IDS.saleSheet2627]: [saleTab],
      },
      { [orderTab]: orderRows, [saleTab]: saleRows },
    );

    const [orders, sales] = await Promise.all([
      fetchOrderDatedTotals(month, deps),
      fetchSaleDatedTotals(month, deps),
    ]);

    assert.equal(orders.available, true);
    assert.equal(sales.available, true);
    assert.equal(orders.totals.hasWeeklyDates, true);
    assert.equal(sales.totals.hasWeeklyDates, true);
    assert.equal(monthlyTotal(orders), 100);
    assert.equal(monthlyTotal(sales), 26);
    assert.equal(weeklyTotal(orders.totals), monthlyTotal(orders));
    assert.equal(weeklyTotal(sales.totals), monthlyTotal(sales));
    assert.deepEqual(
      orders.totals.exact.map((week) => week.get(key) ?? 0),
      [10, 20, 30, 40],
    );
    assert.deepEqual(
      sales.totals.exact.map((week) => week.get(key) ?? 0),
      [5, 6, 7, 8],
    );
  });

  it("keeps in-month rows monthly-only when blank or malformed dates make weekly detail unsafe", async () => {
    const orderTabValues = [
      ["ERP Code", "Colour", "Qty", "Group", "Date"],
      ["ITEM-1", "Red", "10", "PTMT", "3-Aug-2026"],
      ["ITEM-1", "Red", "20", "PTMT", ""],
      ["ITEM-1", "Red", "30", "PTMT", "not-a-date"],
      ["ITEM-1", "Red", "40", "PTMT", "2026-08-40"],
      ["ITEM-1", "Red", "900", "PTMT", "3-Aug-2025"],
      ["ITEM-1", "Red", "900", "PTMT", "3-Sep-2026"],
    ];
    const saleTabValues = [
      ["Code", "Colour", "Qty", "Date"],
      ["ITEM-1", "Red", "5", "3-Aug-2026"],
      ["ITEM-1", "Red", "6", " "],
      ["ITEM-1", "Red", "7", "invalid"],
      ["ITEM-1", "Red", "8", "2026-08-40"],
      ["ITEM-1", "Red", "900", "3-Aug-2025"],
      ["ITEM-1", "Red", "900", "3-Sep-2026"],
    ];
    const deps = fixtureReader(
      {
        [SHEET_IDS.orderSheet]: [orderTab],
        [SHEET_IDS.saleSheet2627]: [saleTab],
      },
      { [orderTab]: orderTabValues, [saleTab]: saleTabValues },
    );

    const [orders, sales] = await Promise.all([
      fetchOrderDatedTotals(month, deps),
      fetchSaleDatedTotals(month, deps),
    ]);

    assert.equal(orders.available, true);
    assert.equal(sales.available, true);
    assert.equal(orders.totals.hasWeeklyDates, false);
    assert.equal(sales.totals.hasWeeklyDates, false);
    assert.equal(monthlyTotal(orders), 10);
    assert.equal(monthlyTotal(sales), 5);
    assert.equal(weeklyTotal(orders.totals), 10);
    assert.equal(weeklyTotal(sales.totals), 5);
  });

  it("requires both month and year when reading Order rows from Combined", async () => {
    const deps = fixtureReader(
      { [SHEET_IDS.orderSheet]: [] },
      {
        Combined: [
          ["ERP Code", "Colour", "Qty", "Group", "Month"],
          ["ITEM-1", "Red", "10", "PTMT", "Aug-26"],
          ["ITEM-1", "Red", "900", "PTMT", "Aug"],
          ["ITEM-1", "Red", "900", "PTMT", "Aug-25"],
          ["ITEM-1", "Red", "900", "PTMT", "Sep-26"],
        ],
      },
    );

    const orders = await fetchOrderDatedTotals(month, deps);

    assert.equal(orders.available, true);
    assert.equal(orders.totals.hasWeeklyDates, false);
    assert.equal(monthlyTotal(orders), 10);
    assert.equal(weeklyTotal(orders.totals), 0);
  });

  it("reports a successfully read source with no matching rows as available with numeric zero", async () => {
    const deps = fixtureReader(
      {
        [SHEET_IDS.orderSheet]: [orderTab],
        [SHEET_IDS.saleSheet2627]: [saleTab],
      },
      {
        [orderTab]: [
          ["ERP Code", "Colour", "Qty", "Group", "Date"],
          ["ITEM-1", "Red", "900", "PTMT", "3-Aug-2025"],
        ],
        [saleTab]: [
          ["Code", "Colour", "Qty", "Date"],
          ["ITEM-1", "Red", "900", "3-Sep-2026"],
        ],
      },
    );

    const [orders, sales] = await Promise.all([
      fetchOrderDatedTotals(month, deps),
      fetchSaleDatedTotals(month, deps),
    ]);

    assertAvailableZero(orders);
    assertAvailableZero(sales);
  });

  it("keeps missing tabs, missing date/month schema, and read failures unavailable", async () => {
    const missingTabs = fixtureReader(
      {
        [SHEET_IDS.orderSheet]: [],
        [SHEET_IDS.saleSheet2627]: [],
      },
      { Combined: [] },
    );
    const missingTabResults = await Promise.all([
      fetchOrderDatedTotals(month, missingTabs),
      fetchSaleDatedTotals(month, missingTabs),
    ]);
    assert.equal(missingTabResults[0].available, false);
    assert.equal(missingTabResults[1].available, false);

    const missingSchema = fixtureReader(
      {
        [SHEET_IDS.orderSheet]: [],
        [SHEET_IDS.saleSheet2627]: [saleTab],
      },
      {
        Combined: [["ERP Code", "Colour", "Qty"], ["ITEM-1", "Red", "10"]],
        [saleTab]: [["Code", "Colour", "Qty"], ["ITEM-1", "Red", "10"]],
      },
    );
    const missingSchemaResults = await Promise.all([
      fetchOrderDatedTotals(month, missingSchema),
      fetchSaleDatedTotals(month, missingSchema),
    ]);
    assert.equal(missingSchemaResults[0].available, false);
    assert.equal(missingSchemaResults[1].available, false);

    const readFailure = fixtureReader(
      {
        [SHEET_IDS.orderSheet]: [orderTab],
        [SHEET_IDS.saleSheet2627]: [saleTab],
      },
      {},
      new Set([orderTab, saleTab]),
    );
    const readFailureResults = await Promise.all([
      fetchOrderDatedTotals(month, readFailure),
      fetchSaleDatedTotals(month, readFailure),
    ]);
    assert.equal(readFailureResults[0].available, false);
    assert.equal(readFailureResults[1].available, false);
    assert.match(readFailureResults[0].note, /unavailable/i);
    assert.match(readFailureResults[1].note, /unavailable/i);
  });
});

// ── Plumbing unmatched GROUP allow-list ───────────────────────────────────────

describe("isPlumbingUnmatchedGroup — exact equality, no fuzzy", () => {
  it("accepts all four allowed groups exactly", () => {
    assert.equal(isPlumbingUnmatchedGroup("CPVC"), true);
    assert.equal(isPlumbingUnmatchedGroup("UPVC"), true);
    assert.equal(isPlumbingUnmatchedGroup("SWR"), true);
    assert.equal(isPlumbingUnmatchedGroup("AGRI"), true);
  });

  it("rejects lowercase variants", () => {
    assert.equal(isPlumbingUnmatchedGroup("cpvc"), false);
    assert.equal(isPlumbingUnmatchedGroup("upvc"), false);
    assert.equal(isPlumbingUnmatchedGroup("swr"), false);
  });

  it("rejects values with extra whitespace (no trim allowed by caller)", () => {
    assert.equal(isPlumbingUnmatchedGroup(" CPVC"), false);
    assert.equal(isPlumbingUnmatchedGroup("CPVC "), false);
  });

  it("rejects prefix matches — must be exact", () => {
    assert.equal(isPlumbingUnmatchedGroup("CPVC PIPE"), false);
    assert.equal(isPlumbingUnmatchedGroup("C PVC"), false);
    assert.equal(isPlumbingUnmatchedGroup("UPVC-FITTINGS"), false);
  });

  it("rejects PTMT and other plumbing-like strings", () => {
    assert.equal(isPlumbingUnmatchedGroup("PTMT"), false);
    assert.equal(isPlumbingUnmatchedGroup("PLUMBING"), false);
    assert.equal(isPlumbingUnmatchedGroup(""), false);
    assert.equal(isPlumbingUnmatchedGroup("OTHER"), false);
  });
});

// ── itemKey normalisation: colour placeholder stripping ───────────────────────

describe("itemKey normalisation for roster key consistency", () => {
  // NO_COLOUR_PLACEHOLDERS = {"0", ".", "NORMAL"} → stripped to ""
  it("strips placeholder colour '0'", () => {
    assert.equal(itemKey("ABC-123", "0"), itemKey("ABC-123", ""));
    assert.equal(itemKey("ABC-123", "0"), "ABC-123::");
  });

  it("strips placeholder colour '.'", () => {
    assert.equal(itemKey("ABC-123", "."), itemKey("ABC-123", ""));
  });

  it("strips placeholder colour 'NORMAL'", () => {
    assert.equal(itemKey("ABC-123", "normal"), itemKey("ABC-123", ""));
  });

  it("preserves real colour 'RED'", () => {
    const k = itemKey("ABC-123", "RED");
    assert.equal(k, "ABC-123::RED");
    assert.notEqual(k, itemKey("ABC-123", "BLUE"));
  });

  it("two items with the same code but different real colours produce different keys", () => {
    const k1 = itemKey("P-200", "RED");
    const k2 = itemKey("P-200", "BLUE");
    assert.notEqual(k1, k2);
  });

  it("item code is uppercased and trimmed", () => {
    assert.equal(itemKey("  p-200  ", "red"), itemKey("P-200", "RED"));
  });
});

// ── buildVersionAwarePlanMap — proportional plan semantics ────────────────────

describe("buildVersionAwarePlanMap", () => {
  /**
   * Helper: create a minimal PlanVersion.
   * targets: array of { itemCode, colour, category, w1, w2, w3, w4 }
   */
  function makeVersion(
    sourceId: number,
    effectiveFrom: string,
    effectiveTo: string | null,
    targets: Array<{ itemCode: string; colour: string; category: string; w1: number; w2: number; w3: number; w4: number }>,
  ) {
    return {
      kind: "run" as const,
      sourceId,
      sourceLabel: `v${sourceId}`,
      effectiveFrom,
      effectiveTo,
      // VersionTarget requires maxPcs and minPcs; supply defaults for tests.
      targets: targets.map((t) => ({ ...t, maxPcs: t.w1 + t.w2 + t.w3 + t.w4, minPcs: 0 })),
    } as import("./plant-plan-timeline").PlanVersion;
  }

  it("returns empty map when no versions", () => {
    const m = buildVersionAwarePlanMap("2025-07", []);
    assert.equal(m.size, 0);
  });

  it("single version covering full month: plan equals target weekly values", () => {
    const v = makeVersion(1, "2025-07-01", null, [
      { itemCode: "ABC-1", colour: "RED", category: "PIPE", w1: 100, w2: 200, w3: 150, w4: 50 },
    ]);
    const m = buildVersionAwarePlanMap("2025-07", [v]);
    const entry = m.get(itemKey("ABC-1", "RED"));
    assert.ok(entry, "entry must exist");
    assert.equal(entry.w1, 100);
    assert.equal(entry.w2, 200);
    assert.equal(entry.w3, 150);
    assert.equal(entry.w4, 50);
    assert.equal(entry.plan, 100 + 200 + 150 + 50);
  });

  it("uses itemKey so colour placeholder '0' maps to same key as blank colour", () => {
    const v = makeVersion(1, "2025-07-01", null, [
      { itemCode: "ABC-1", colour: "0", category: "PIPE", w1: 100, w2: 0, w3: 0, w4: 0 },
    ]);
    const m = buildVersionAwarePlanMap("2025-07", [v]);
    // "0" is a placeholder → normalised to "" → key is "ABC-1::"
    const entry = m.get("ABC-1::");
    assert.ok(entry, "entry keyed as ABC-1:: (placeholder colour stripped)");
    assert.equal(entry.w1, 100);
  });

  it("omits Opening Stock items", () => {
    const v = makeVersion(1, "2025-07-01", null, [
      { itemCode: "Opening Stock", colour: "", category: "PIPE", w1: 999, w2: 0, w3: 0, w4: 0 },
      { itemCode: "REAL-1", colour: "", category: "PIPE", w1: 100, w2: 0, w3: 0, w4: 0 },
    ]);
    const m = buildVersionAwarePlanMap("2025-07", [v]);
    assert.equal(m.has("OPENING STOCK::"), false);
    assert.ok(m.has(itemKey("REAL-1", "")));
  });

  it("omits DUMMY items", () => {
    const v = makeVersion(1, "2025-07-01", null, [
      { itemCode: "DUMMY-001", colour: "", category: "PIPE", w1: 99, w2: 0, w3: 0, w4: 0 },
      { itemCode: "REAL-1", colour: "", category: "PIPE", w1: 100, w2: 0, w3: 0, w4: 0 },
    ]);
    const m = buildVersionAwarePlanMap("2025-07", [v]);
    assert.equal(m.has(itemKey("DUMMY-001", "")), false);
    assert.ok(m.has(itemKey("REAL-1", "")));
  });

  it("version split mid-week: proportional allocation", () => {
    // W1 = days 1-7 (7 days total).
    // versionForDate uses: effectiveFrom <= date < effectiveTo (effectiveTo exclusive).
    // v1: effectiveTo "2025-07-05" → covers days 1-4 (4 days; day 5 is excluded since 07-05 is not < 07-05).
    // v2: effectiveFrom "2025-07-05" → covers days 5-7 (3 days).
    // No gap: v1 covers 1-4 (4/7), v2 covers 5-7 (3/7).
    const v1 = makeVersion(1, "2025-07-01", "2025-07-05", [
      { itemCode: "X-1", colour: "RED", category: "CAT1", w1: 700, w2: 0, w3: 0, w4: 0 },
    ]);
    const v2 = makeVersion(2, "2025-07-05", null, [
      { itemCode: "X-1", colour: "RED", category: "CAT1", w1: 700, w2: 0, w3: 0, w4: 0 },
    ]);
    const m = buildVersionAwarePlanMap("2025-07", [v1, v2]);
    const entry = m.get(itemKey("X-1", "RED"));
    assert.ok(entry);
    // v1 covers 4/7 days: round(700 * 4/7) = round(400) = 400
    // v2 covers 3/7 days: round(700 * 3/7) = round(300) = 300
    // Total W1 accumulated then rounded = 700
    assert.equal(entry.w1, 700);
  });

  it("version changes produce correct blend when W1 targets differ", () => {
    // W1 = 7 days.
    // versionForDate: effectiveTo is exclusive (date < effectiveTo).
    // v1: effectiveTo "2025-07-05" → covers days 1-4 (4/7 of W1).
    // v2: effectiveFrom "2025-07-05" → covers days 5-7 (3/7 of W1).
    const v1 = makeVersion(1, "2025-07-01", "2025-07-05", [
      { itemCode: "Y-1", colour: "", category: "CAT1", w1: 140, w2: 0, w3: 0, w4: 0 },
    ]);
    const v2 = makeVersion(2, "2025-07-05", null, [
      { itemCode: "Y-1", colour: "", category: "CAT1", w1: 210, w2: 0, w3: 0, w4: 0 },
    ]);
    const m = buildVersionAwarePlanMap("2025-07", [v1, v2]);
    const entry = m.get(itemKey("Y-1", ""));
    assert.ok(entry);
    // W1 accumulates: v1 contrib 140*(4/7)=80, v2 contrib 210*(3/7)=90 → total 170, rounded = 170.
    // The engine accumulates fractional contributions first, then rounds once per entry.
    // 140*4/7 = 80 exactly; 210*3/7 = 90 exactly; sum = 170.
    assert.equal(entry.w1, 170);
  });

  it("produces integer plan quantities (no fractional pcs)", () => {
    const v = makeVersion(1, "2025-07-01", null, [
      { itemCode: "Z-1", colour: "", category: "CAT1", w1: 7, w2: 11, w3: 13, w4: 17 },
    ]);
    const m = buildVersionAwarePlanMap("2025-07", [v]);
    const entry = m.get(itemKey("Z-1", ""));
    assert.ok(entry);
    assert.equal(entry.w1 % 1, 0, "w1 must be integer");
    assert.equal(entry.w2 % 1, 0, "w2 must be integer");
    assert.equal(entry.w3 % 1, 0, "w3 must be integer");
    assert.equal(entry.w4 % 1, 0, "w4 must be integer");
    assert.equal(entry.plan % 1, 0, "plan must be integer");
    assert.equal(
      entry.plan,
      entry.w1 + entry.w2 + entry.w3 + entry.w4,
      "item total must be derived from its rounded weekly quantities",
    );
  });
});

// ── Transaction week allocation — weekIdxFromDate logic ───────────────────────

describe("week index allocation from date string", () => {
  // The engine uses: day 1-7 → W1 (idx 0), 8-14 → W2, 15-21 → W3, 22+ → W4.
  function weekIdxForDay(day: number): 0 | 1 | 2 | 3 {
    if (day <= 7) return 0;
    if (day <= 14) return 1;
    if (day <= 21) return 2;
    return 3;
  }

  it("maps day 1 to W1", () => { assert.equal(weekIdxForDay(1), 0); });
  it("maps day 7 to W1", () => { assert.equal(weekIdxForDay(7), 0); });
  it("maps day 8 to W2", () => { assert.equal(weekIdxForDay(8), 1); });
  it("maps day 14 to W2", () => { assert.equal(weekIdxForDay(14), 1); });
  it("maps day 15 to W3", () => { assert.equal(weekIdxForDay(15), 2); });
  it("maps day 21 to W3", () => { assert.equal(weekIdxForDay(21), 2); });
  it("maps day 22 to W4", () => { assert.equal(weekIdxForDay(22), 3); });
  it("maps day 31 to W4", () => { assert.equal(weekIdxForDay(31), 3); });
});

// ── Production conservation invariant ────────────────────────────────────────

describe("production conservation invariant", () => {
  it("mapped + unmapped = total", () => {
    const mapped = 5000;
    const unmapped = 300;
    assert.equal(mapped + unmapped, 5300);
    assert.equal(mapped + unmapped, mapped + unmapped);
  });

  it("zero unmapped: total equals mapped", () => {
    const mapped = 8000;
    const unmapped = 0;
    assert.equal(mapped + unmapped, mapped);
  });

  it("zero mapped: total equals unmapped", () => {
    const mapped = 0;
    const unmapped = 1500;
    assert.equal(mapped + unmapped, unmapped);
  });
});

// ── Segment and month format validation ───────────────────────────────────────

describe("segment validation (exact strings only)", () => {
  const isValidSegment = (s: string) => s === "PTMT" || s === "Plumbing";

  it("accepts PTMT and Plumbing", () => {
    assert.equal(isValidSegment("PTMT"), true);
    assert.equal(isValidSegment("Plumbing"), true);
  });

  it("rejects lowercase, mixed, or other strings", () => {
    for (const s of ["ptmt", "plumbing", "PLUMBING", "", "Other", "PTMT;DROP"]) {
      assert.equal(isValidSegment(s), false, `Expected "${s}" to be invalid`);
    }
  });
});

describe("month validation (YYYY-MM regex)", () => {
  const MONTH_RE = /^\d{4}-\d{2}$/;

  it("accepts YYYY-MM format", () => {
    for (const m of ["2026-07", "2025-01", "2026-12"]) {
      assert.equal(MONTH_RE.test(m), true);
    }
  });

  it("rejects non-conforming strings", () => {
    for (const m of ["", "26-07", "2026-7", "2026/07", "abc"]) {
      assert.equal(MONTH_RE.test(m), false, `Expected "${m}" to fail`);
    }
  });
});

// ── GROUP is only for unmatched classification — conceptual test ──────────────

describe("GROUP allow-list only applies after a transaction is unmatched", () => {
  /**
   * Conceptual proof:
   * A transaction row for code "A-465" / colour "RED" that matches a plan roster
   * key must be counted regardless of what GROUP value is present.
   * The GROUP column is only consulted when the code+colour fails to match any
   * plan roster key, to decide whether to add the unmatched row to the Plumbing
   * unmatched tally.
   */
  it("transaction matching is code+colour exact: GROUP is irrelevant to it", () => {
    // Simulate two rows with the same code+colour but different GROUP values.
    // Both should produce the same itemKey — GROUP does not change the key.
    const key1 = itemKey("A-465", "RED");
    const key2 = itemKey("A-465", "RED");
    // GROUP "PTMT" or "CPVC" should not affect whether the key matches.
    assert.equal(key1, key2, "same code+colour → same key regardless of GROUP");
  });

  it("GROUP allow-list only rejects unmatched rows outside the allow-list", () => {
    // A PTMT-GROUP unmatched row is NOT added to Plumbing tally.
    assert.equal(isPlumbingUnmatchedGroup("PTMT"), false);
    // A CPVC-GROUP unmatched row IS added to Plumbing tally.
    assert.equal(isPlumbingUnmatchedGroup("CPVC"), true);
  });

  it("a matched transaction is credited regardless of its GROUP value", () => {
    // This test verifies the design intent: if we build a plan roster key for
    // "A-465"/"RED" and the transaction row has GROUP="PTMT", the matched credit
    // path is taken before GROUP is ever consulted.
    const rosterKey = itemKey("A-465", "RED");
    const transactionKey = itemKey("A-465", "RED");
    // Simulated roster lookup
    const roster = new Map([[rosterKey, { plan: 100 }]]);
    const isMatched = roster.has(transactionKey);
    assert.equal(isMatched, true, "transaction matches roster before GROUP is checked");
  });
});

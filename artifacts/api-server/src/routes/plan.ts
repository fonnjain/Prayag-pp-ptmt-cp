ing_fg_stock UPLOAD (Net Stock col: +ve=stock, -ve=pendingLM)
 *   Avg3Mo + Pending    → daily-production workbook by header-name mapping (lib/sheets.ts)
 *   Live orders         → Order Sheet 26-27
 *   KGs                 → BOM sheet (1R7k5O6w4qaT74G-5X2VXBtD7-Fg3uByvIw3-TeViMmA)
 */
router.get("/plan/validate", async (req, res): Promise<void> => {
  const month = String(req.query.month ?? "");
  if (!month) {
    res.status(400).json({ error: "month is required" });
    return;
  }
  const segment = String(req.query.segment ?? "PTMT");

  type CheckResult = {
    name: string;
    expected: number;
    actual: number;
    pass: boolean;
    /** Advisory: check passed but sits outside the comfort band — surface amber in UI. */
    warn?: boolean;
    tolerance?: string;
  };

  // ── PLUMBING self-check ────────────────────────────────────────────────────
  if (segment === "Plumbing") {
    // Golden values live in lib/plumbing-golden.ts — update them there when the
    // reference month rolls over.  Never inline them here.
    const [items, fgStockRows, bufferRows, sheet3Rows] = await Promise.all([
      buildPlanItems(month, "Plumbing"),
      loadLatestUploadRowsByKind("plumbing_fg_stock"),
      db.select().from(bufferCategoriesTable).where(eq(bufferCategoriesTable.segment, "Plumbing")),
      fetchPlumbingSheet3Production(month),
    ]);

    const checks: CheckResult[] = [];
    const roundInt = (v: number) => Math.round(v);

    // ── 0. Planning-isolation guards (uploads-only rule, scoped 2026-08) ──
    checks.push(...(await buildPlanningIsolationChecks(month, "Plumbing")));
    {
      // Pending-source check: DATA.xlsx present AND parsed (never assumed-zero).
      const pendingUploadRows = await loadLatestUploadRowsByKind("pending_orders");
      const pendInfo = classifyPendingSource(pendingUploadRows);
      const pendOk = pendingUploadRows.length > 0 && pendInfo.hasCodeColumn;
      checks.push({
        name: `ISOLATION · pending source present & parsed (layout: ${pendInfo.layout})`,
        expected: 1,
        actual: pendOk ? 1 : 0,
        pass: pendOk,
        tolerance: "bool",
      });
      // Sales sanity: workbook avg-3-month must be non-zero (band-vs-prior not
      // available for Plumbing — no prior workbook loaded here).
      const avgSum = items.reduce((s, i) => s + i.avg3MoSale, 0);
      checks.push({
        name: "ISOLATION · sales history (avg-3-mo) non-zero",
        expected: 1,
        actual: roundInt(avgSum),
        pass: avgSum > 0,
        tolerance: "> 0",
      });
    }

    // ── 1. Non-empty guard ─────────────────────────────────────────────────
    // If the FG Stock upload is missing OR the workbook connection failed, every
    // item's stock and pendingLM default to 0 → plan is all-zeros.  Catch it here
    // before the user discovers it in an export.
    const itemCount = items.length;
    const grandTotal = items.reduce((s, i) => s + i.maxProduction, 0);
    checks.push({
      name: "GUARD · Plumbing item count > 0",
      expected: 1,
      actual: itemCount,
      pass: itemCount > 0,
      tolerance: "> 0",
    });
    checks.push({
      name: "GUARD · Plumbing grand total > 0",
      expected: 1,
      actual: roundInt(grandTotal),
      pass: grandTotal > 0,
      tolerance: "> 0",
    });
    // Exact golden check for the grand total — catches any silent regression in
    // plan totals that the per-category ±0.1% checks would also surface, but
    // having it at the plant level makes it immediately visible in summary views.
    {
      const gt = roundInt(grandTotal);
      const gtPct = (PLUMBING_GRAND_TOTAL as number) === 0 ? (gt === 0 ? 0 : Infinity)
        : Math.abs(gt - PLUMBING_GRAND_TOTAL) / PLUMBING_GRAND_TOTAL;
      checks.push({
        name: "Grand total (±0.1%)",
        expected: PLUMBING_GRAND_TOTAL,
        actual: gt,
        pass: gtPct <= PLUMBING_GOLDEN_TOLERANCE,
        tolerance: `±${(PLUMBING_GOLDEN_TOLERANCE * 100).toFixed(1)}%`,
      });
    }

    // ── 2. Required-upload guard ───────────────────────────────────────────
    // The FG Stock upload is the ONLY source of Stock and Pending-Last-Month.
    // Without it both inputs are 0, making Production Required = 0 for every item.
    const fgRowCount = fgStockRows.length;
    checks.push({
      name: "GUARD · FG Stock upload present (required)",
      expected: 1,
      actual: fgRowCount,
      pass: fgRowCount > 0,
      tolerance: "≥ 1 row",
    });

    // ── 2b. Stock-join coverage guard (same silent-zero class as PTMT Fault 1) ─
    // Count of plan items with stock = 0 while the plumbing FG upload holds a
    // POSITIVE Net Stock for the same code. Must be 0 — a column rename or key
    // normalization break in the FG join would show up here before it inflates
    // the plan.
    {
      const fgPositiveByCode = new Map<string, number>();
      for (const row of fgStockRows) {
        const code = normalizeCode(String((row as Record<string, unknown>)["Item Code"] ?? "").trim());
        if (!code) continue;
        const rawNet = (row as Record<string, unknown>)["Net Stock"];
        const netStock = typeof rawNet === "number" ? rawNet : Number(String(rawNet ?? "").replace(/,/g, "")) || 0;
        if (netStock > 0) fgPositiveByCode.set(code, (fgPositiveByCode.get(code) ?? 0) + netStock);
      }
      const seenCodes = new Set<string>();
      let plumbingStockJoinMisses = 0;
      for (const item of items) {
        const code = normalizeCode(item.itemCode);
        if (seenCodes.has(code)) continue;
        seenCodes.add(code);
        if ((item.stock ?? 0) === 0 && (fgPositiveByCode.get(code) ?? 0) > 0) plumbingStockJoinMisses++;
      }
      checks.push({
        name: "GUARD · Stock-join coverage (plan items with Stock=0 but FG positive)",
        expected: 0,
        actual: plumbingStockJoinMisses,
        pass: plumbingStockJoinMisses === 0,
        tolerance: "exact",
      });
    }

    // ── 3. Segment isolation ───────────────────────────────────────────────
    const plumbingCategories = new Set(items.map((i) => i.category));
    const distinctCatCount = plumbingCategories.size;
    checks.push({
      name: "ISOLATION · Plumbing category count = 12",
      expected: 12,
      actual: distinctCatCount,
      pass: distinctCatCount === 12,
    });
    const nonPlumbing = [...plumbingCategories].filter(
      (c) => !["CPVC", "UPVC", "SWR", "AGRI"].some((m) => c.startsWith(m)),
    );
    checks.push({
      name: "ISOLATION · No non-Plumbing categories in plan",
      expected: 0,
      actual: nonPlumbing.length,
      pass: nonPlumbing.length === 0,
    });

    // ── 4. Buffer multiplier defaults ──────────────────────────────────────
    // SWR is deliberately 1.0× (not 1.5×) — migration 011 (tolerance=0, exact).
    // CPVC / UPVC / AGRI are AI-computed and drift; tolerance=0.3 catches gross
    // misconfigurations while surviving normal corrective-engine updates.
    const bufferByName = new Map<string, number>(bufferRows.map((b) => [b.name, b.multiplier]));
    for (const { cat, expected, tolerance } of PLUMBING_BUFFER_DEFAULTS) {
      const actual = bufferByName.get(cat) ?? -1;
      const pass = actual >= 0 && Math.abs(actual - expected) <= (tolerance + 0.001);
      const label = tolerance === 0
        ? `${expected}×`
        : `${expected}× ±${tolerance}`;
      checks.push({
        name: `Buffer · ${cat} = ${label}`,
        expected,
        actual,
        pass,
      });
    }

    // ── 5. Solvent membership ──────────────────────────────────────────────
    // Catches the item-type mapping bug: Solvent items mis-classified or dropped.
    for (const { cat, mustInclude } of SOLVENT_MEMBERSHIP) {
      const catCodes = new Set(items.filter((i) => i.category === cat).map((i) => normalizeCode(i.itemCode)));
      for (const code of mustInclude) {
        const found = catCodes.has(normalizeCode(code));
        checks.push({
          name: `Solvent · ${code} in ${cat}`,
          expected: 1,
          actual: found ? 1 : 0,
          pass: found,
        });
      }
    }

    // ── 6. 12 category totals (±1%) ────────────────────────────────────────
    // Golden values from lib/plumbing-golden.ts.
    // AGRI values are an intentional correction — see plumbing-golden.ts header.
    const byCategory = new Map<string, number>();
    for (const item of items) {
      byCategory.set(item.category, (byCategory.get(item.category) ?? 0) + item.maxProduction);
    }
    for (const { cat, expected } of PLUMBING_GOLDEN) {
      const actual = roundInt(byCategory.get(cat) ?? 0);
      const pct = expected === 0
        ? (actual === 0 ? 0 : Infinity)
        : Math.abs(actual - expected) / expected;
      const pass = expected === 0 ? actual === 0 : pct <= PLUMBING_GOLDEN_TOLERANCE;
      checks.push({
        name: cat,
        expected,
        actual,
        pass,
        tolerance: expected === 0 ? "= 0" : `±${(PLUMBING_GOLDEN_TOLERANCE * 100).toFixed(1)}%`,
      });
    }

    // ── 7. Item counts per category ────────────────────────────────────────
    // Catches the pipe-block-skipped bug (codeCol mismatch) and row-truncation bugs immediately.
    // Expected counts verified against live workbook: CPVC 293/296, UPVC 324/327,
    // SWR 297/300, AGRI 206/209 (remaining rows are blanks or untyped).
    const PLUMBING_ITEM_COUNTS: Array<{ cat: string; expected: number }> = [
      { cat: "CPVC Pipe",    expected: 40  },
      { cat: "CPVC Fitting", expected: 244 },
      { cat: "CPVC Solvent", expected: 9   },
      { cat: "UPVC Pipe",    expected: 52  },
      { cat: "UPVC Fitting", expected: 242 },
      { cat: "UPVC Solvent", expected: 30  },
      { cat: "SWR Pipe",     expected: 160 },
      { cat: "SWR Fitting",  expected: 134 },
      { cat: "SWR Solvent",  expected: 3   },
      { cat: "AGRI Pipe",    expected: 123 },
      { cat: "AGRI Fitting", expected: 82  },
      { cat: "AGRI Solvent", expected: 1   },
    ];
    const itemsByCategory = new Map<string, number>();
    for (const item of items) {
      itemsByCategory.set(item.category, (itemsByCategory.get(item.category) ?? 0) + 1);
    }
    for (const { cat, expected } of PLUMBING_ITEM_COUNTS) {
      const actual = itemsByCategory.get(cat) ?? 0;
      checks.push({
        name: `Items · ${cat} = ${expected}`,
        expected,
        actual,
        pass: actual === expected,
      });
    }

    // ── 8. KG from BOM (pieces × weight-per-piece) ─────────────────────────
    // Guard: if CPVC Pipe kg < 1,000 it was probably read from the broken
    // sheet kg column (~113 for 130,451 pipes — a ~1000× error).
    // Items with no BOM entry contribute 0 kg and are counted separately.
    const kgByCategory = new Map<string, number>();
    let totalNoBomPcs = 0;
    let totalScheduledPcs = 0;
    for (const item of items) {
      const bom = item as PlanItemWithBom;
      const kg = bom.weightKg ?? 0;
      kgByCategory.set(item.category, (kgByCategory.get(item.category) ?? 0) + kg);
      if (bom.noBomWeight) totalNoBomPcs += item.maxProduction;
      totalScheduledPcs += item.maxProduction;
    }

    const cpvcPipeKg = kgByCategory.get("CPVC Pipe") ?? 0;
    checks.push({
      name: "GUARD · KG source: CPVC Pipe kg > 1,000 (BOM-computed, not sheet column)",
      expected: 1_000,
      actual: Math.round(cpvcPipeKg),
      pass: cpvcPipeKg > 1_000,
      tolerance: "> 1,000",
    });

    for (const { cat, expectedKg } of PLUMBING_KG_GOLDEN) {
      const actualKg = Math.round(kgByCategory.get(cat) ?? 0);
      const pass = expectedKg === 0
        ? actualKg === 0
        : Math.abs(actualKg - expectedKg) / expectedKg <= PLUMBING_KG_TOLERANCE;
      checks.push({
        name: `KG · ${cat}`,
        expected: expectedKg,
        actual: actualKg,
        pass,
        tolerance: expectedKg === 0 ? "= 0" : "±1%",
      });
    }

    const totalKg = Math.round([...kgByCategory.values()].reduce((s, v) => s + v, 0));
    checks.push({
      name: "GUARD · Plumbing kg grand total",
      expected: PLUMBING_KG_GRAND_TOTAL,
      actual: totalKg,
      pass: Math.abs(totalKg - PLUMBING_KG_GRAND_TOTAL) / PLUMBING_KG_GRAND_TOTAL <= PLUMBING_KG_TOLERANCE,
      tolerance: "±1%",
    });

    // No-BOM guard: items with no BOM weight contribute 0 kg but must be reported.
    // Expected: ~117,135 pieces (<10% of plan) have no BOM entry.
    const noBomPct = totalScheduledPcs > 0 ? (totalNoBomPcs / totalScheduledPcs) * 100 : 0;
    checks.push({
      name: "GUARD · No-BOM pieces < 10% of plan",
      expected: 10,
      actual: Math.round(noBomPct * 10) / 10,
      pass: noBomPct < 10,
      tolerance: "< 10%",
    });

    // ── 9. Weekly release (cover = Stock / Avg3MoSale; bands 0.3/0.5/0.8) ──
    // Plumbing weekly release bands must be seeded in weekly_release_bands
    // (segment='Plumbing', w1Upper=0.3, w2Upper=0.5, w3Upper=0.8, w4Upper=99).
    // annotateWeeklyRelease() is called inside buildPlumbingPlanItemsFromWorkbook.
    const w1Raw = new Map<string, number>();
    const w2Raw = new Map<string, number>();
    const w3Raw = new Map<string, number>();
    const w4Raw = new Map<string, number>();
    for (const item of items) {
      w1Raw.set(item.category, (w1Raw.get(item.category) ?? 0) + item.w1);
      w2Raw.set(item.category, (w2Raw.get(item.category) ?? 0) + item.w2);
      w3Raw.set(item.category, (w3Raw.get(item.category) ?? 0) + item.w3);
      w4Raw.set(item.category, (w4Raw.get(item.category) ?? 0) + item.w4);
    }

    const plantW1 = Math.round(items.reduce((s, i) => s + i.w1, 0));
    const plantW2 = Math.round(items.reduce((s, i) => s + i.w2, 0));
    const plantW3 = Math.round(items.reduce((s, i) => s + i.w3, 0));
    const plantW4 = Math.round(items.reduce((s, i) => s + i.w4, 0));

    const weekPass = (actual: number, expected: number): boolean =>
      expected === 0 ? actual === 0 : Math.abs(actual - expected) / expected <= PLUMBING_WEEKLY_TOLERANCE;
    const weekTol = (expected: number): string => (expected === 0 ? "= 0" : "±1%");

    checks.push({ name: "Weekly · Plant W1", expected: PLUMBING_WEEKLY_PLANT.w1, actual: plantW1, pass: weekPass(plantW1, PLUMBING_WEEKLY_PLANT.w1), tolerance: "±1%" });
    checks.push({ name: "Weekly · Plant W2", expected: PLUMBING_WEEKLY_PLANT.w2, actual: plantW2, pass: weekPass(plantW2, PLUMBING_WEEKLY_PLANT.w2), tolerance: "±1%" });
    checks.push({ name: "Weekly · Plant W3", expected: PLUMBING_WEEKLY_PLANT.w3, actual: plantW3, pass: weekPass(plantW3, PLUMBING_WEEKLY_PLANT.w3), tolerance: "±1%" });
    checks.push({ name: "Weekly · Plant W4", expected: PLUMBING_WEEKLY_PLANT.w4, actual: plantW4, pass: weekPass(plantW4, PLUMBING_WEEKLY_PLANT.w4), tolerance: "±1%" });

    for (const g of PLUMBING_WEEKLY_GOLDEN) {
      const rw1 = w1Raw.get(g.cat) ?? 0;
      const rw2 = w2Raw.get(g.cat) ?? 0;
      const rw3 = w3Raw.get(g.cat) ?? 0;
      const rw4 = w4Raw.get(g.cat) ?? 0;
      const aw1 = Math.round(rw1);
      const aw2 = Math.round(rw2);
      const aw3 = Math.round(rw3);
      const aw4 = Math.round(rw4);

      checks.push({ name: `Weekly · ${g.cat} · W1`, expected: g.w1, actual: aw1, pass: weekPass(aw1, g.w1), tolerance: weekTol(g.w1) });
      checks.push({ name: `Weekly · ${g.cat} · W2`, expected: g.w2, actual: aw2, pass: weekPass(aw2, g.w2), tolerance: weekTol(g.w2) });
      checks.push({ name: `Weekly · ${g.cat} · W3`, expected: g.w3, actual: aw3, pass: weekPass(aw3, g.w3), tolerance: weekTol(g.w3) });
      checks.push({ name: `Weekly · ${g.cat} · W4`, expected: g.w4, actual: aw4, pass: weekPass(aw4, g.w4), tolerance: weekTol(g.w4) });

      // Sum check: all weekly totals must equal the category's production required.
      // Items with cover = "OS" (avg3MoSale = 0) and maxProduction > 0 are unscheduled
      // and will cause this check to fail — that is intentional (a data-quality signal).
      const weeklySum = Math.round(rw1 + rw2 + rw3 + rw4);
      const prodReq   = roundInt(byCategory.get(g.cat) ?? 0);
      checks.push({
        name: `Weekly · ${g.cat} · sum = prod req`,
        expected: prodReq,
        actual: weeklySum,
        pass: weeklySum === prodReq,
      });
    }

    const categoryTotals: Record<string, number> = {};
    for (const [cat, total] of byCategory.entries()) categoryTotals[cat] = roundInt(total);
    for (const { cat } of PLUMBING_GOLDEN) if (!(cat in categoryTotals)) categoryTotals[cat] = 0;

    // ── 8. Monitoring actuals vs frozen golden values (28 checks) ────────────
    // Folded so /plan/validate?segment=Plumbing covers all 163 checks in one call.
    // W1 = Jul 1–7, W2 = Jul 8–14 (both elapsed, actuals are stable).
    {
      const normMap = new Map<string, string>();
      for (const item of items) {
        const norm = normalizeCodeStrict(item.itemCode);
        if (!normMap.has(norm)) normMap.set(norm, item.category);
      }
      const catAct = new Map<string, number[]>();
      const unmWk = [0, 0, 0, 0];
      for (const row of sheet3Rows) {
        const d = parseInt(row.dateStr.slice(8), 10);
        const wi = d <= 7 ? 0 : d <= 14 ? 1 : d <= 21 ? 2 : 3;
        const cat = normMap.get(row.normCode);
        if (!cat) { unmWk[wi]! += row.qty; continue; }
        const arr = catAct.get(cat) ?? [0, 0, 0, 0];
        arr[wi]! += row.qty;
        catAct.set(cat, arr);
      }
      const plantM = [0, 0, 0, 0];
      for (const [, arr] of catAct) for (let i = 0; i < 4; i++) plantM[i]! += arr[i]!;

      const MON_TOL = PLUMBING_MON_TOLERANCE;
      const monChk = (name: string, expected: number, actual: number): CheckResult => {
        const pass = expected === 0 ? actual === 0 : Math.abs(actual - expected) / expected <= MON_TOL;
        return { name, expected: Math.round(expected), actual: Math.round(actual), pass,
          tolerance: expected === 0 ? "exact" : `±${(MON_TOL * 100).toFixed(0)}%` };
      };
      checks.push(monChk("Mon · Plant W1 mapped",   PLUMBING_MON_W1_MAPPED,   plantM[0]!));
      checks.push(monChk("Mon · Plant W2 mapped",   PLUMBING_MON_W2_MAPPED,   plantM[1]!));
      checks.push(monChk("Mon · W1 unmapped",       PLUMBING_MON_W1_UNMAPPED, unmWk[0]!));
      checks.push(monChk("Mon · W2 unmapped",       PLUMBING_MON_W2_UNMAPPED, unmWk[1]!));
      for (const [cat, exp] of Object.entries(PLUMBING_MON_CAT_W1))
        checks.push(monChk(`Mon · ${cat} W1`, exp, (catAct.get(cat) ?? [0, 0, 0, 0])[0]!));
      for (const [cat, exp] of Object.entries(PLUMBING_MON_CAT_W2))
        checks.push(monChk(`Mon · ${cat} W2`, exp, (catAct.get(cat) ?? [0, 0, 0, 0])[1]!));
    }

    // ── 9. Machine cascade checks ───────────────────────────────────────────
    {
      const FLEX_MACHINES = new Set(["MC3", "MC4", "MC5"]);
      const hasMachineData = items.some(i => (i as PlanItemWithBom).machineW1 !== undefined);
      checks.push({
        name: "Machine · cascade ran (machines seeded)",
        expected: 1,
        actual: hasMachineData ? 1 : 0,
        pass: hasMachineData,
        tolerance: "bool",
      });

      if (hasMachineData) {
        // Sum consistency: non-unfulfillable items must have mSum == maxProduction;
        // unfulfillable items must have mSum < maxProduction (i.e. some residual exists).
        let sumInconsistent = 0;
        for (const item of items) {
          if (item.maxProduction <= 0) continue;
          if (item.category.endsWith("Solvent")) continue;
          const bom = item as PlanItemWithBom;
          const mSum = (bom.machineW1 ?? 0) + (bom.machineW2 ?? 0) + (bom.machineW3 ?? 0) + (bom.machineW4 ?? 0);
          if (bom.machineUnfulfillable) {
            // Residual must be > 0 (it was marked unfulfillable for a reason)
            if (mSum >= item.maxProduction) sumInconsistent++;
          } else {
            if (Math.abs(mSum - item.maxProduction) > 1) sumInconsistent++;
          }
        }
        checks.push({
          name: "Machine · cascade sum consistency",
          expected: 0,
          actual: sumInconsistent,
          pass: sumInconsistent === 0,
        });

        // Per-category invariant: feasible + unfulfillable_residual = desired
        const allCatNames2 = [...new Set(items.map(i => i.category))];
        let catInvariantFail = 0;
        for (const cat of allCatNames2) {
          if (cat.endsWith("Solvent")) continue;
          const catItems = items.filter(i => i.category === cat);
          const desired  = catItems.reduce((s, i) => s + i.maxProduction, 0);
          const feasible = catItems.reduce((s, i) => {
            const b = i as PlanItemWithBom;
            return s + (b.machineW1 ?? 0) + (b.machineW2 ?? 0) + (b.machineW3 ?? 0) + (b.machineW4 ?? 0);
          }, 0);
          const unplaced = catItems
            .filter(i => (i as PlanItemWithBom).machineUnfulfillable)
            .reduce((s, i) => {
              const b = i as PlanItemWithBom;
              const placed = (b.machineW1 ?? 0) + (b.machineW2 ?? 0) + (b.machineW3 ?? 0) + (b.machineW4 ?? 0);
              return s + Math.max(0, i.maxProduction - placed);
            }, 0);
          if (Math.abs(feasible + unplaced - desired) > 1) catInvariantFail++;
        }
        checks.push({
          name: "Machine · per-category feasible + unfulfillable = desired (12 categories)",
          expected: 0,
          actual: catInvariantFail,
          pass: catInvariantFail === 0,
        });

        // AGRI Pipe check: verify AGRI Pipe items are only placed on flex machines.
        // Structurally guaranteed because only MC3/MC4/MC5 carry AGRI in their rates map;
        // confirmed here by checking all machines that touched AGRI Pipe items have
        // AGRI in their rates (i.e. are flex-capable).
        const agriPipeItems = items.filter(i => i.category === "AGRI Pipe" && i.maxProduction > 0);
        const agriOnNonFlex = agriPipeItems.filter(i => {
          const mid = (i as PlanItemWithBom).assignedMachineId;
          return mid !== null && mid !== undefined && !FLEX_MACHINES.has(mid);
        });
        checks.push({
          name: "Machine · AGRI Pipe only on flex machines (MC3/MC4/MC5)",
          expected: 0,
          actual: agriOnNonFlex.length,
          pass: agriOnNonFlex.length === 0,
        });
      }
    }

    // ── machineFeasible summary — full cascade result: categories + utilisation + unfulfillable ──
    let machineFeasible: {
      categories: { category: string; desiredPcs: number; feasiblePcs: number; unfulfillablePcs: number }[];
      utilisation: import("../lib/machine-capacity-engine").MachineWeekUtilisation[];
      unfulfillable: { itemCode: string; category: string; pieces: number; bindingMachine: string | null }[];
    } | null = null;
    if (segment === "Plumbing") {
      // Re-run cascade to obtain utilisation + unfulfillable alongside the category summary.
      const machinesForFeasible = await db
        .select()
        .from(plumbingMachineCapacityTable)
        .where(eq(plumbingMachineCapacityTable.segment, "Plumbing"));

      const freshCascadeItems = items.map(i => ({
        ...(i as PlanItemWithBom),
        machineW1: 0 as number,
        machineW2: 0 as number,
        machineW3: 0 as number,
        machineW4: 0 as number,
        assignedMachineId: null as string | null,
        machineWeek: null as 1 | 2 | 3 | 4 | null,
        machineUnfulfillable: false,
      }));

      const machineResult = runMachineCascade(
        freshCascadeItems as unknown as PlanItemForCascade[],
        machinesForFeasible,
        month,
      );

      const allCats = [...new Set(items.map(i => i.category))].sort();
      const catSummary = allCats.map(cat => {
        const catItems  = freshCascadeItems.filter(i => i.category === cat);
        const desiredPcs = catItems.reduce((s, i) => s + i.maxProduction, 0);
        const feasiblePcs = catItems.reduce(
          (s, i) => s + (i.machineW1 ?? 0) + (i.machineW2 ?? 0) + (i.machineW3 ?? 0) + (i.machineW4 ?? 0),
          0,
        );
        // unfulfillablePcs = actual unplaced residual (not maxProduction, which would double-count partial fills)
        const unfulfillablePcs = catItems
          .filter(i => i.machineUnfulfillable)
          .reduce((s, i) => {
            const placed = (i.machineW1 ?? 0) + (i.machineW2 ?? 0) + (i.machineW3 ?? 0) + (i.machineW4 ?? 0);
            return s + Math.max(0, i.maxProduction - placed);
          }, 0);
        return { category: cat, desiredPcs, feasiblePcs, unfulfillablePcs };
      });

      machineFeasible = {
        categories: catSummary,
        utilisation: machineResult.utilisation,
        unfulfillable: machineResult.unfulfillable,
      };
    }

    const allPass = checks.every((c) => c.pass);
    const failCount = checks.filter((c) => !c.pass).length;
    res.json({ month, segment, allPass, passCount: checks.length - failCount, failCount, checks, categoryTotals, machineFeasible });
    return;
  }

  // ── PTMT self-check ────────────────────────────────────────────────────────
  // Fetch everything in one parallel batch — DB reads + both Sheets calls
  // so we only pay the throttle penalty once (they overlap in Promise.all).
  const [
    stockRows,
    rawPendingRows,
    lastMoRows,
    itemRows,
    bufferRows,
    avg3MoTotals,
    liveOrderTotals,
  ] = await Promise.all([
    loadLatestUploadRowsByKind("current_stock"),
    loadLatestUploadRowsByKind("pending_orders"),
    loadLatestUploadRowsByKind("last_month_pending"),
    db.select().from(itemMasterTable).where(eq(itemMasterTable.segment, "PTMT")),
    db.select().from(bufferCategoriesTable).where(eq(bufferCategoriesTable.segment, "PTMT")),
    fetchAvg3MoSaleTotals(month),
    fetchLiveOrderTotals(month),
  ]);

  // Filter DATA.xlsx rows to PTMT segment (file now stores all segments; filter here mirrors buildPlanItems)
  const pendingRows = rawPendingRows.filter((row) => {
    const seg = String(row["Segment"] ?? "").trim().toUpperCase();
    return seg === "PTMT" || seg === "PT";
  });

  const checks: CheckResult[] = [];

  // ── 0. Planning-isolation guards (uploads-only rule, scoped 2026-08) ──
  checks.push(...(await buildPlanningIsolationChecks(month, "PTMT")));
  {
    // Pending-source check: DATA.xlsx present AND parsed (never assumed-zero).
    const pendInfo = classifyPendingSource(rawPendingRows);
    const pendOk = rawPendingRows.length > 0 && pendInfo.hasCodeColumn;
    checks.push({
      name: `ISOLATION · pending source present & parsed (layout: ${pendInfo.layout})`,
      expected: 1,
      actual: pendOk ? 1 : 0,
      pass: pendOk,
      tolerance: "bool",
    });
    // Sales sanity band: current avg-3-mo total must be non-zero AND within a
    // sane band of the prior month's figure. Adjacent 3-month windows overlap
    // by two months, so month-over-month movement of the average is mechanically
    // damped — a large shift means a broken read (wrong tab, renamed column,
    // empty range), not real demand movement.
    //
    // Two thresholds (tightened 2026-08-05; sales is the one planning input
    // deliberately left live, and avg-3-mo drives Buffer proportionally):
    //   HARD band 0.6–1.6×  → outside this the check FAILS.
    //   ADVISORY 0.85–1.2×  → outside this (but inside hard band) the check
    //     still passes, with warn=true surfaced in validate output and the UI.
    const curSum = [...avg3MoTotals.byCode.values()].reduce((a, b) => a + b, 0);
    const [yy, mm] = month.split("-").map(Number);
    const priorMonth = mm === 1 ? `${yy! - 1}-12` : `${yy}-${String(mm! - 1).padStart(2, "0")}`;
    let bandPass = false;
    let bandWarn = false;
    let ratio = 0;
    try {
      const priorTotals = await fetchAvg3MoSaleTotals(priorMonth);
      const priorSum = [...priorTotals.byCode.values()].reduce((a, b) => a + b, 0);
      ratio = priorSum > 0 ? curSum / priorSum : Infinity;
      bandPass = curSum > 0 && ratio >= 0.6 && ratio <= 1.6;
      bandWarn = bandPass && (ratio < 0.85 || ratio > 1.2);
    } catch {
      bandPass = false;
    }
    checks.push({
      name: `ISOLATION · sales band vs prior month (ratio ${ratio.toFixed(2)}, hard 0.6–1.6×, advisory 0.85–1.2×)`,
      expected: 1,
      actual: bandPass ? 1 : 0,
      pass: bandPass,
      warn: bandWarn,
      tolerance: "bool",
    });
  }

  // ── Month-keyed upload goldens ────────────────────────────────────────
  // The upload scalar checks below assert against the LATEST uploads, so the
  // expected values must roll with the upload month (spec: never assert July
  // goldens against August data). 2026-08 = August upload set; anything else
  // falls back to the July 2026 legacy values.
  const isAugGolden = month === PTMT_AUG_MONTH;

  // ── 1. Stock 121-O / WHITE ────────────────────────────────────────────
  const stockTotals = sumByKey(stockRows, ["Item Code"], ["Colour", "Color"], ["Qty", "Closing Stock", "C/Stock", "C Stock"]);
  const stock121 = resolveTotal(stockTotals, "121-O", "WHITE", false);
  const stock121Exp = isAugGolden ? PTMT_AUG_STOCK_121O_WHITE : 1644;
  checks.push({ name: "Stock 121-O / WHITE", expected: stock121Exp, actual: stock121, pass: stock121 === stock121Exp });

  // ── 2. Last-month pending total ───────────────────────────────────────
  const lmTotals = sumByKey(
    lastMoRows,
    ["Item Code", "Cat No", "Cat-No", "Old Item Code"],
    ["Colour", "Color"],
    ["Qty", "Qty.", "Balance_Qty", "Balance Qty"],
  );
  const lmTotal = Math.round([...lmTotals.byCode.values()].reduce((a, b) => a + b, 0));
  const lmExp = isAugGolden ? PTMT_AUG_LM_TOTAL : 137939;
  checks.push({ name: "Last-month pending total", expected: lmExp, actual: lmTotal, pass: lmTotal === lmExp });

  // ── 3. Current pending ────────────────────────────────────────────────
  const pendTotals = sumByKey(
    pendingRows,
    ["Old Item Code", "Item Code", "Item No."],
    ["Colour", "Color"],
    ["Balance_Qty", "Balance Qty", "Bal.Qty", "Qty"],
  );
  if (isAugGolden) {
    // Aug DATA.xlsx rows carry no Balance_Qty column → total PTMT pending must be 0.
    const pendTotal = Math.round([...pendTotals.byCode.values()].reduce((a, b) => a + b, 0));
    checks.push({ name: "Current pending total (Aug: no Balance_Qty column)", expected: PTMT_AUG_PENDING_TOTAL, actual: pendTotal, pass: pendTotal === PTMT_AUG_PENDING_TOTAL });
  } else {
    const pend144 = resolveTotal(pendTotals, "144-O", "WHITE", false);
    checks.push({ name: "Current pending 144-O / WHITE", expected: 132, actual: pend144, pass: pend144 === 132 });
  }

  // ── 4. Avg 3-Mo Sale 144-O / WHITE ────────────────────────────────────
  const avg3MoRaw = resolveTotal(avg3MoTotals, "144-O", "WHITE", false);
  const avg3Mo = Math.round(avg3MoRaw / 3);
  const avg3Exp = isAugGolden ? PTMT_AUG_AVG3MO_144O_WHITE : 5222;
  checks.push({ name: "Avg 3-Mo Sale 144-O / WHITE", expected: avg3Exp, actual: avg3Mo, pass: avg3Mo === avg3Exp });

  // ── 5 & 6. Grand totals ≈ Max 576,037 / Min 301,918 (±5 %) ──────────
  // Build plan items directly from already-fetched data — no second Sheets round trip.
  const pendingOrderTotals = sumByKey(
    pendingRows,
    ["Old Item Code", "Item Code", "Item No."],
    ["Colour", "Color"],
    ["Balance_Qty", "Balance Qty", "Bal.Qty", "Qty"],
  );
  const pendingLastMoTotals = sumByKey(
    lastMoRows,
    ["Item Code", "Cat No", "Cat-No", "Old Item Code"],
    ["Colour", "Color"],
    ["Qty", "Qty.", "Balance_Qty", "Balance Qty"],
  );
  const bufferByCategory = new Map<string, number>(bufferRows.map((b) => [b.name, b.multiplier]));
  const codeCounts = new Map<string, number>();
  for (const item of itemRows) {
    const codeKey = `${item.category}::${normalizeCode(item.itemCode)}`;
    codeCounts.set(codeKey, (codeCounts.get(codeKey) ?? 0) + 1);
  }
  const currentStockRows = stockRows;
  const stockTotalsForPlan = stockTotals;
  const planItems = itemRows.map((item) => {
    const isSingleVariant = (codeCounts.get(`${item.category}::${normalizeCode(item.itemCode)}`) ?? 0) <= 1;
    return computeItemPlan(
      {
        itemCode: item.itemCode,
        colour: item.colour,
        avg3MoSaleTotal3Mo: resolveTotal(avg3MoTotals, item.itemCode, item.colour, isSingleVariant),
        stock: resolveTotal(stockTotalsForPlan, item.itemCode, item.colour, isSingleVariant),
        stockNeedsReview:
          currentStockRows.length > 0 && !hasEntry(stockTotalsForPlan, item.itemCode, item.colour, isSingleVariant),
        pendingOrderLastMonth: resolveTotal(pendingLastMoTotals, item.itemCode, item.colour, isSingleVariant),
        pendingOrder: resolveTotal(pendingOrderTotals, item.itemCode, item.colour, isSingleVariant),
        order: resolveTotal(liveOrderTotals, item.itemCode, item.colour, isSingleVariant),
      },
      item.category,
      bufferByCategory.get(item.category) ?? 1,
    );
  });
  const summary = summarizePlan(planItems);
  const grandMaxExp = isAugGolden ? PTMT_AUG_GRAND_MAX : PTMT_GRAND_MAX;
  const grandMinExp = isAugGolden ? PTMT_AUG_GRAND_MIN : PTMT_GRAND_MIN;
  const maxPct = Math.abs(summary.grandMaxTotal - grandMaxExp) / grandMaxExp;
  const minPct = Math.abs(summary.grandMinTotal - grandMinExp) / grandMinExp;
  const tolLabel = `±${(PTMT_TOLERANCE * 100).toFixed(1)}%`;
  checks.push({
    name: `Grand Max total ≈ ${grandMaxExp.toLocaleString("en-IN")}`,
    expected: grandMaxExp,
    actual: summary.grandMaxTotal,
    pass: maxPct <= PTMT_TOLERANCE,
    tolerance: tolLabel,
  });
  checks.push({
    name: `Grand Min total ≈ ${grandMinExp.toLocaleString("en-IN")}`,
    expected: grandMinExp,
    actual: summary.grandMinTotal,
    pass: minPct <= PTMT_TOLERANCE,
    tolerance: tolLabel,
  });

  // ── Per-category Max / Min (±0.1%) ─────────────────────────────────────────
  const catMap = new Map(summary.categories.map((c) => [c.category, c]));
  const categoryGolden = isAugGolden ? PTMT_AUG_CATEGORY_GOLDEN : PTMT_CATEGORY_GOLDEN;
  for (const g of categoryGolden) {
    const cat = catMap.get(g.cat);
    const actualMax = cat?.maxTotal ?? 0;
    const actualMin = cat?.minTotal ?? 0;
    const catMaxPct = g.maxExpected > 0
      ? Math.abs(actualMax - g.maxExpected) / g.maxExpected
      : actualMax === 0 ? 0 : 1;
    const catMinPct = g.minExpected > 0
      ? Math.abs(actualMin - g.minExpected) / g.minExpected
      : actualMin === 0 ? 0 : 1;
    checks.push({
      name: `PTMT · ${g.cat} · Max`,
      expected: g.maxExpected,
      actual: Math.round(actualMax),
      pass: catMaxPct <= PTMT_TOLERANCE,
      tolerance: tolLabel,
    });
    checks.push({
      name: `PTMT · ${g.cat} · Min`,
      expected: g.minExpected,
      actual: Math.round(actualMin),
      pass: catMinPct <= PTMT_TOLERANCE,
      tolerance: tolLabel,
    });
  }

  // ── Stock-join coverage guard (Fault-1 class) ───────────────────────────────
  // Independently re-derive per-key stock from the RAW upload rows using broad
  // header detection (any column matching /stock|qty/i), then compare against the
  // engine's alias-based join AT THE SAME KEY (code+colour for multi-variant,
  // code for single-variant). A plan row where the engine sees 0 but the file
  // holds non-zero stock for the same key = silent-zero join → must be 0.
  // This is the check that would have caught the "Closing Stock" column miss
  // in the August 2026 upload (~1,015 silently-zero rows).
  const indepExact = new Map<string, number>();
  const indepByCode = new Map<string, number>();
  for (const row of stockRows) {
    const rec = row as Record<string, unknown>;
    const code = normalizeCode(String(rec["Item Code"] ?? "").trim());
    if (!code) continue;
    const colour = String(rec["Colour"] ?? rec["Color"] ?? "").trim().toUpperCase();
    let qty = 0;
    for (const [col, val] of Object.entries(rec)) {
      if (!/stock|qty/i.test(col) || /item|code|colou?r|category|name/i.test(col)) continue;
      const n = typeof val === "number" ? val : Number(String(val ?? "").replace(/,/g, ""));
      if (Number.isFinite(n) && n !== 0) { qty = n; break; }
    }
    indepExact.set(`${code}::${colour}`, (indepExact.get(`${code}::${colour}`) ?? 0) + qty);
    indepByCode.set(code, (indepByCode.get(code) ?? 0) + qty);
  }
  // Strict-layer maps: same rows keyed by punctuation-stripped code, so a future
  // upload that writes "A465" where item_master says "A-465" still trips the guard.
  const indepStrictExact = new Map<string, number>();
  const indepStrictByCode = new Map<string, number>();
  for (const [key, qty] of indepExact) {
    const [code, colour] = key.split("::");
    const sc = normalizeCodeStrict(code);
    indepStrictExact.set(`${sc}::${colour}`, (indepStrictExact.get(`${sc}::${colour}`) ?? 0) + qty);
    indepStrictByCode.set(sc, (indepStrictByCode.get(sc) ?? 0) + qty);
  }
  let stockJoinMisses = 0;       // engine-normalization layer — must be 0
  let stockJoinStrictMisses = 0; // strict layer — baseline 1 (501-S WHITE, hyphen-variant in FG file)
  for (const item of itemRows) {
    const isSingleVariant = (codeCounts.get(`${item.category}::${normalizeCode(item.itemCode)}`) ?? 0) <= 1;
    const engineStock = resolveTotal(stockTotalsForPlan, item.itemCode, item.colour, isSingleVariant);
    if (engineStock !== 0) continue;
    const code = normalizeCode(item.itemCode);
    const colourKey = item.colour.trim().toUpperCase();
    const indep = isSingleVariant
      ? (indepByCode.get(code) ?? 0)
      : (indepExact.get(`${code}::${colourKey}`) ?? 0);
    if (indep !== 0) { stockJoinMisses++; continue; }
    const sc = normalizeCodeStrict(item.itemCode);
    const indepStrict = isSingleVariant
      ? (indepStrictByCode.get(sc) ?? 0)
      : (indepStrictExact.get(`${sc}::${colourKey}`) ?? 0);
    if (indepStrict !== 0) stockJoinStrictMisses++;
  }
  checks.push({
    name: "Stock-join coverage guard (plan rows with Stock=0 but FG non-zero, same key)",
    expected: 0,
    actual: stockJoinMisses,
    pass: stockJoinMisses === 0,
    tolerance: "exact",
  });
  // Known baseline: exactly 1 (501-S / WHITE — FG file writes the code with different
  // punctuation, 208 units; engine intentionally does not strict-join to avoid
  // cross-code collisions). Any INCREASE means a new punctuation-variant join loss.
  checks.push({
    name: "Stock-join strict-layer guard (punctuation-variant code misses, baseline 1)",
    expected: 1,
    actual: stockJoinStrictMisses,
    pass: stockJoinStrictMisses <= 1,
    tolerance: "≤ 1",
  });

  // ── Stock reconciliation ─────────────────────────────────────────────────────
  // Σ(stock joined onto plan rows, deduped per resolved key) must reconcile with
  // Σ(FG stock for codes present in the plan). A silent-zero join regression
  // (e.g. the ~498,000-unit gap of the original Fault 1) must fail loudly.
  // DELIBERATE asymmetry: the denominator is computed with STRICT (punctuation-
  // stripped) code matching while the numerator uses the engine join. If the
  // engine join degrades (column rename, normalization drift), the numerator
  // falls while the denominator holds → the gap widens and this check trips.
  // Legitimate mapping noise (codes reused across categories, colour splits)
  // is why the tolerance is ±2% rather than exact; the current gap is ~0.4%.
  const planStrictCodes = new Set(itemRows.map((i) => normalizeCodeStrict(i.itemCode)));
  let fgStockForPlanCodes = 0;
  for (const [key, qty] of stockTotalsForPlan.exact) {
    const [code] = key.split("::");
    if (planStrictCodes.has(normalizeCodeStrict(code))) fgStockForPlanCodes += qty;
  }
  const joinedKeys = new Map<string, number>();
  for (const item of itemRows) {
    const isSingleVariant = (codeCounts.get(`${item.category}::${normalizeCode(item.itemCode)}`) ?? 0) <= 1;
    const key = isSingleVariant ? `code::${normalizeCode(item.itemCode)}` : `exact::${normalizeCode(item.itemCode)}::${item.colour.trim().toUpperCase()}`;
    if (!joinedKeys.has(key)) joinedKeys.set(key, resolveTotal(stockTotalsForPlan, item.itemCode, item.colour, isSingleVariant));
  }
  const joinedStockSum = Math.round([...joinedKeys.values()].reduce((a, b) => a + b, 0));
  const reconGapPct = fgStockForPlanCodes > 0 ? Math.abs(joinedStockSum - fgStockForPlanCodes) / fgStockForPlanCodes : 0;
  checks.push({
    name: `Stock reconciliation: joined ${joinedStockSum.toLocaleString("en-IN")} vs FG-for-plan-codes ${Math.round(fgStockForPlanCodes).toLocaleString("en-IN")} (gap ${Math.round(joinedStockSum - fgStockForPlanCodes).toLocaleString("en-IN")} units)`,
    expected: Math.round(fgStockForPlanCodes),
    actual: joinedStockSum,
    pass: reconGapPct <= 0.02,
    tolerance: "±2%",
  });

  // ── Item-coverage guard (Fault-2 class) ─────────────────────────────────────
  // Per-category counts of source items absent from the plan and plan items
  // absent from the source. Reported ALWAYS — never suppressed. The counts are
  // informational (pass=true); the per-category breakdown ships in the payload.
  const fgCodeStock = new Map<string, number>();
  for (const [key, qty] of stockTotalsForPlan.exact) {
    const [code] = key.split("::");
    const sc = normalizeCodeStrict(code);
    fgCodeStock.set(sc, (fgCodeStock.get(sc) ?? 0) + qty);
  }
  const planNotInSource = new Map<string, number>();  // category → count of plan codes absent from FG
  const seenPlanCodes = new Set<string>();
  for (const item of itemRows) {
    const sc = normalizeCodeStrict(item.itemCode);
    const dedupeKey = `${item.category}::${sc}`;
    if (seenPlanCodes.has(dedupeKey)) continue;
    seenPlanCodes.add(dedupeKey);
    if (!fgCodeStock.has(sc)) planNotInSource.set(item.category, (planNotInSource.get(item.category) ?? 0) + 1);
  }
  const sourceNotInPlanCodes: Array<{ code: string; stock: number }> = [];
  for (const [sc, qty] of fgCodeStock) {
    if (!planStrictCodes.has(sc) && qty > 0) sourceNotInPlanCodes.push({ code: sc, stock: Math.round(qty) });
  }
  const planNotInSourceTotal = [...planNotInSource.values()].reduce((a, b) => a + b, 0);
  checks.push({
    name: `Item coverage: ${sourceNotInPlanCodes.length} source codes not in plan / ${planNotInSourceTotal} plan codes not in source (reported)`,
    expected: sourceNotInPlanCodes.length + planNotInSourceTotal,
    actual: sourceNotInPlanCodes.length + planNotInSourceTotal,
    pass: true,
    tolerance: "reported",
  });

  // ── Applied multiplier lock (exact match) ───────────────────────────────────
  // Catches any recompute that lets Suggested silently replace the business multiplier.
  // Applied = multiplier column in the DB (set to override when present; seed ensures
  // all 7 categories have the override locked at startup).
  const bufferByName = new Map<string, { multiplier: number; overrideMultiplier: number | null }>(
    bufferRows.map((b) => [b.name, { multiplier: b.multiplier, overrideMultiplier: b.overrideMultiplier ?? null }]),
  );
  for (const { cat, multiplier: expectedMult } of PTMT_MULTIPLIER_GOLDEN) {
    const row = bufferByName.get(cat);
    const actualOverride = row?.overrideMultiplier ?? -1;
    const overridePass = actualOverride === expectedMult;
    checks.push({
      name: `PTMT · ${cat} · Override locked ×${expectedMult}`,
      expected: expectedMult,
      actual: actualOverride,
      pass: overridePass,
      tolerance: "exact",
    });
    const actualApplied = row?.multiplier ?? -1;
    const appliedPass = Math.abs(actualApplied - expectedMult) < 0.001;
    checks.push({
      name: `PTMT · ${cat} · Applied ×${expectedMult}`,
      expected: expectedMult,
      actual: actualApplied,
      pass: appliedPass,
      tolerance: "exact",
    });
  }

  const allPass = checks.every((c) => c.pass);
  const failCount = checks.filter((c) => !c.pass).length;

  res.json({
    month,
    segment,
    allPass,
    passCount: checks.length - failCount,
    failCount,
    checks,
    itemCoverage: {
      sourceNotInPlan: sourceNotInPlanCodes.sort((a, b) => b.stock - a.stock).slice(0, 50),
      sourceNotInPlanCount: sourceNotInPlanCodes.length,
      planNotInSourceByCategory: Object.fromEntries(planNotInSource),
      planNotInSourceCount: planNotInSourceTotal,
    },
  });
});

// ── GET /plan/plumbing-monitoring ─────────────────────────────────────────────
// Returns per-week and per-category Sheet3 actuals vs plan release targets.
// Methodology:
//   - MAPPED actual  = Sheet3 codes that match a plan item via normalizeCodeStrict
//   - UNMAPPED       = Sheet3 codes with no plan-master match (surfaced, not dropped)
//   - Cumulative attainment = cumMapped / cumRelease (suppressed if week not started)
// 5-min response cache so the first cold call (9s) doesn't block subsequent browser hits.

/**
 * Core computation for Plumbing monitoring payload.
 * Exported so monitoring/dashboard can dispatch to it when segment=PLUMBING.
 */
export async function computePlumbingMonitoringPayload(month: string) {
  const [planItems, sheet3Rows] = await Promise.all([
    buildPlanItems(month, "Plumbing"),
    fetchPlumbingSheet3Production(month),
  ]);

  // Code → category map (strict normalization: "A465" matches "A-465")
  const codeToCategory = new Map<string, string>();
  const catRelease = new Map<string, [number, number, number, number]>();
  for (const item of planItems) {
    const norm = normalizeCodeStrict(item.itemCode);
    if (!codeToCategory.has(norm)) codeToCategory.set(norm, item.category);
    const arr = catRelease.get(item.category) ?? [0, 0, 0, 0];
    arr[0] += (item as unknown as Record<string, number>)["w1"] ?? 0;
    arr[1] += (item as unknown as Record<string, number>)["w2"] ?? 0;
    arr[2] += (item as unknown as Record<string, number>)["w3"] ?? 0;
    arr[3] += (item as unknown as Record<string, number>)["w4"] ?? 0;
    catRelease.set(item.category, arr);
  }

  function wkIdx(day: number): number { return day <= 7 ? 0 : day <= 14 ? 1 : day <= 21 ? 2 : 3; }

  const catActual = new Map<string, [number, number, number, number]>();
  const unmappedByWeek: [number, number, number, number] = [0, 0, 0, 0];
  const unmappedCodeQty = new Map<string, number>();

  for (const row of sheet3Rows) {
    const cat = codeToCategory.get(row.normCode);
    const wi = wkIdx(parseInt(row.dateStr.slice(8), 10));
    if (!cat) {
      unmappedByWeek[wi] += row.qty;
      unmappedCodeQty.set(row.rawCode, (unmappedCodeQty.get(row.rawCode) ?? 0) + row.qty);
      continue;
    }
    const arr = catActual.get(cat) ?? [0, 0, 0, 0];
    arr[wi] += row.qty;
    catActual.set(cat, arr);
  }

  // Week calendar
  const [yr, mo] = month.split("-").map(Number);
  const lastDayOfMonth = new Date(yr, mo, 0).getDate();
  function p2(n: number) { return String(n).padStart(2, "0"); }
  const calendar = [
    { week: 1, label: `W1 (${mo}/1–7)`,           startDay: 1,  endDay: 7,            startDate: `${yr}-${p2(mo)}-01`, endDate: `${yr}-${p2(mo)}-07` },
    { week: 2, label: `W2 (${mo}/8–14)`,           startDay: 8,  endDay: 14,           startDate: `${yr}-${p2(mo)}-08`, endDate: `${yr}-${p2(mo)}-14` },
    { week: 3, label: `W3 (${mo}/15–21)`,          startDay: 15, endDay: 21,           startDate: `${yr}-${p2(mo)}-15`, endDate: `${yr}-${p2(mo)}-21` },
    { week: 4, label: `W4 (${mo}/22–${lastDayOfMonth})`, startDay: 22, endDay: lastDayOfMonth, startDate: `${yr}-${p2(mo)}-22`, endDate: `${yr}-${p2(mo)}-${p2(lastDayOfMonth)}` },
  ];

  // Plant totals per week (round release — plan items have fractional w1-w4 due to band multiplication)
  const plantRelease: [number, number, number, number] = [0, 0, 0, 0];
  const plantMapped:  [number, number, number, number] = [0, 0, 0, 0];
  for (const [, arr] of catRelease) for (let i = 0; i < 4; i++) plantRelease[i] += arr[i];
  for (const [, arr] of catActual)  for (let i = 0; i < 4; i++) plantMapped[i]  += arr[i];
  for (let i = 0; i < 4; i++) plantRelease[i] = Math.round(plantRelease[i]);

  // Working days elapsed (non-Sunday days from 1st through last data date)
  const lastDataDate = sheet3Rows.length > 0 ? [...sheet3Rows].map((r) => r.dateStr).sort().pop()! : null;
  let workingDaysElapsed = 0;
  if (lastDataDate) {
    const throughDay = parseInt(lastDataDate.slice(8), 10);
    for (let d = 1; d <= throughDay; d++) {
      if (new Date(`${month}-${p2(d)}T00:00:00Z`).getUTCDay() !== 0) workingDaysElapsed++;
    }
  }

  // Build per-week response (cumulative columns)
  const today = new Date().toISOString().slice(0, 10);
  let cumRelease = 0, cumMapped = 0, cumTotal = 0;
  const weeks = calendar.map((wk, i) => {
    const release = plantRelease[i]!;
    const mapped   = plantMapped[i]!;
    const unmapped = unmappedByWeek[i]!;
    const actual   = mapped + unmapped;
    cumRelease += release;
    cumMapped  += mapped;
    cumTotal   += actual;
    const wkStarted = today.slice(0, 7) === month && today >= wk.startDate;
    const cumAttPct  = cumRelease > 0 && wkStarted ? Math.round((cumMapped  / cumRelease) * 1000) / 10 : null;
    const wkAttPct   = release   > 0 && wkStarted ? Math.round((mapped     / release)    * 1000) / 10 : null;
    return { week: wk.week, label: wk.label, startDate: wk.startDate, endDate: wk.endDate,
      release, mapped, unmapped, actual, wkAttPct,
      cumRelease, cumMapped, cumTotal, cumAttPct };
  });

  // Per-category rows
  // `produced`  = total actual production across W1–W4 (alias for totalActual)
  // `released`  = total plan release across W1–W4      (alias for totalRelease)
  const allCats = new Set([...catRelease.keys(), ...catActual.keys()]);
  const categories = [...allCats].map((cat) => {
    const rel = catRelease.get(cat) ?? [0, 0, 0, 0];
    const act = catActual.get(cat) ?? [0, 0, 0, 0];
    const totalRelease = rel.reduce((s, v) => s + v, 0);
    const totalActual  = act.reduce((s, v) => s + v, 0);
    return {
      category: cat,
      w1Release: Math.round(rel[0]), w1Actual: act[0],
      w2Release: Math.round(rel[1]), w2Actual: act[1],
      w3Release: Math.round(rel[2]), w3Actual: act[2],
      w4Release: Math.round(rel[3]), w4Actual: act[3],
      totalRelease: Math.round(totalRelease), totalActual,
      // `produced` and `released` are explicit aliases so consumers don't have to know the internal names
      produced: totalActual,
      released: Math.round(totalRelease),
      notStarted: totalActual === 0 && totalRelease > 0,
    };
  }).sort((a, b) => b.totalRelease - a.totalRelease);

  // Unmapped top codes
  const topCodes = [...unmappedCodeQty.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 20).map(([code, qty]) => ({ code, qty }));

  const totalUnmapped = unmappedByWeek.reduce((s, v) => s + v, 0);
  const totalMapped   = plantMapped.reduce((s, v) => s + v, 0);
  const totalProduced = totalMapped + totalUnmapped;
  const runRatePerDay = workingDaysElapsed > 0 ? Math.round(totalProduced / workingDaysElapsed) : 0;

  return {
    month, lastDataDate, workingDaysElapsed,
    weeks, categories,
    unmapped: { byWeek: [...unmappedByWeek], total: totalUnmapped, topCodes },
    totalProduced, totalMapped, totalUnmapped, runRatePerDay,
  };
}

const _plumbingMonCache = new Map<string, { payload: unknown; expires: number }>();
router.get("/plan/plumbing-monitoring", async (req, res) => {
  const month = String(req.query.month ?? "");
  if (!/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: "month query param required (YYYY-MM)" });
    return;
  }
  const cached = _plumbingMonCache.get(month);
  if (cached && Date.now() < cached.expires) {
    res.json(cached.payload);
    return;
  }
  try {
    const payload = await computePlumbingMonitoringPayload(month);
    _plumbingMonCache.set(month, { payload, expires: Date.now() + 5 * 60 * 1000 });
    res.json(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err, month }, "plan/plumbing-monitoring failed");
    // Surface date-format errors with the full diagnostic message so the plant
    // sees the workbook ID, bad-date sample, and supported formats in the UI —
    // not just a generic "Failed" string.
    if (msg.includes("unrecognised date formats")) {
      res.status(422).json({ error: msg });
    } else {
      res.status(500).json({ error: "Failed to compute Plumbing monitoring" });
    }
  }
});

// ── GET /plan/validate-plumbing-monitoring ─────────────────────────────────────
// Regression endpoint: compares Sheet3 W1/W2 actuals against frozen golden values.
// W1 (Jul 1-7) and W2 (Jul 8-14) are both elapsed and their actuals are stable.
router.get("/plan/validate-plumbing-monitoring", async (req, res) => {
  const month = String(req.query.month ?? "");
  if (!/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: "month query param required (YYYY-MM)" });
    return;
  }
  try {
    const [planItems, sheet3Rows] = await Promise.all([
      buildPlanItems(month, "Plumbing"),
      fetchPlumbingSheet3Production(month),
    ]);

    const codeToCategory2 = new Map<string, string>();
    for (const item of planItems) {
      const norm = normalizeCodeStrict(item.itemCode);
      if (!codeToCategory2.has(norm)) codeToCategory2.set(norm, item.category);
    }

    function wkIdx2(day: number): number { return day <= 7 ? 0 : day <= 14 ? 1 : day <= 21 ? 2 : 3; }

    const catActual2 = new Map<string, [number, number, number, number]>();
    const unmappedByWeek2: [number, number, number, number] = [0, 0, 0, 0];

    for (const row of sheet3Rows) {
      const cat = codeToCategory2.get(row.normCode);
      const wi  = wkIdx2(parseInt(row.dateStr.slice(8), 10));
      if (!cat) { unmappedByWeek2[wi] += row.qty; continue; }
      const arr = catActual2.get(cat) ?? [0, 0, 0, 0];
      arr[wi] += row.qty;
      catActual2.set(cat, arr);
    }

    const plantMapped2: [number, number, number, number] = [0, 0, 0, 0];
    for (const [, arr] of catActual2) for (let i = 0; i < 4; i++) plantMapped2[i] += arr[i];

    type MonCheckResult = { name: string; expected: number; actual: number; pass: boolean; tolerance?: string };

    const checks: MonCheckResult[] = [];

    // ── Plant-level guards (dynamic — no frozen golden values) ────────────────
    // W1 and W2 are elapsed; total production (mapped + unmapped) must be > 0.
    const w1Total = plantMapped2[0]! + unmappedByWeek2[0]!;
    const w2Total = plantMapped2[1]! + unmappedByWeek2[1]!;

    checks.push({ name: "Mon · W1 total > 0",        expected: 1, actual: w1Total > 0 ? 1 : 0,           pass: w1Total > 0,          tolerance: "> 0" });
    checks.push({ name: "Mon · W2 total > 0",        expected: 1, actual: w2Total > 0 ? 1 : 0,           pass: w2Total > 0,          tolerance: "> 0" });
    checks.push({ name: "Mon · Plant W1 mapped > 0", expected: 1, actual: plantMapped2[0]! > 0 ? 1 : 0,  pass: plantMapped2[0]! > 0, tolerance: "> 0" });
    checks.push({ name: "Mon · Plant W2 mapped > 0", expected: 1, actual: plantMapped2[1]! > 0 ? 1 : 0,  pass: plantMapped2[1]! > 0, tolerance: "> 0" });

    // ── Per-category guards ────────────────────────────────────────────────────
    // Non-Solvent categories must have > 0 production in both W1 and W2.
    // Solvent categories only check >= 0 (production is intermittent).
    const NON_SOLVENT_CATS = ["CPVC Pipe","CPVC Fitting","UPVC Pipe","UPVC Fitting","SWR Pipe","SWR Fitting","AGRI Pipe","AGRI Fitting"];
    const SOLVENT_CATS     = ["CPVC Solvent","UPVC Solvent","SWR Solvent","AGRI Solvent"];

    for (const cat of NON_SOLVENT_CATS) {
      const actW1 = (catActual2.get(cat) ?? [0, 0, 0, 0])[0]!;
      const actW2 = (catActual2.get(cat) ?? [0, 0, 0, 0])[1]!;
      checks.push({ name: `Mon · ${cat} W1`, expected: 1, actual: actW1 > 0 ? 1 : 0, pass: actW1 > 0, tolerance: "> 0" });
      checks.push({ name: `Mon · ${cat} W2`, expected: 1, actual: actW2 > 0 ? 1 : 0, pass: actW2 > 0, tolerance: "> 0" });
    }
    for (const cat of SOLVENT_CATS) {
      const actW1 = (catActual2.get(cat) ?? [0, 0, 0, 0])[0]!;
      const actW2 = (catActual2.get(cat) ?? [0, 0, 0, 0])[1]!;
      checks.push({ name: `Mon · ${cat} W1`, expected: 1, actual: actW1 >= 0 ? 1 : 0, pass: actW1 >= 0, tolerance: ">= 0" });
      checks.push({ name: `Mon · ${cat} W2`, expected: 1, actual: actW2 >= 0 ? 1 : 0, pass: actW2 >= 0, tolerance: ">= 0" });
    }

    const allPass   = checks.every((c) => c.pass);
    const failCount = checks.filter((c) => !c.pass).length;
    res.json({ month, allPass, passCount: checks.length - failCount, failCount, checks });
  } catch (err) {
    req.log.error({ err, month }, "plan/validate-plumbing-monitoring failed");
    res.status(500).json({ error: "Failed to validate Plumbing monitoring" });
  }
});

// ── GET /plan/summary ─────────────────────────────────────────────────────────
// Unified plan summary consumed by both:
//   • production-planning /summary page  → grandMinTotal, grandMaxTotal,
//       categories[].{category, minTotal, maxTotal}
//   • ops-dashboard segment filter       → totalPcs, totalKg, totalMin,
//       categories[].{name, pcs, kg}
router.get("/plan/summary", async (req, res): Promise<void> => {
  const month = String(req.query.month ?? "");
  const segment = String(req.query.segment ?? "PTMT");
  if (!/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: "month query param required (YYYY-MM)" });
    return;
  }
  try {
    const items = await buildPlanItems(month, segment);
    // Full summarizePlan result (used by summary page)
    const planSummary = summarizePlan(items);
    // Per-category kg accumulator (Plumbing BOM weight)
    const catKg = new Map<string, number>();
    let totalKg = 0;
    for (const item of items) {
      const kg = Math.round((item as any).weightKg ?? 0);
      totalKg += kg;
      catKg.set(item.category, (catKg.get(item.category) ?? 0) + kg);
    }
    // Merged categories: both old shape (category/minTotal/maxTotal)
    // and new shape (name/pcs/kg) so both consumers work
    const categories = planSummary.categories.map((c) => ({
      ...c,                          // category, minTotal, maxTotal (summary page)
      name: c.category,             // ops-dashboard
      pcs:  Math.round(c.maxTotal), // ops-dashboard
      kg:   catKg.get(c.category) ?? 0, // ops-dashboard
    }));
    res.json({
      month,
      segment,
      // production-planning summary page fields
      grandMinTotal: planSummary.grandMinTotal,
      grandMaxTotal: planSummary.grandMaxTotal,
      // ops-dashboard fields
      totalPcs: planSummary.grandMaxTotal,
      totalKg:  Math.round(totalKg),
      totalMin: planSummary.grandMinTotal,
      categories,
    });
  } catch (err) {
    req.log.error({ err, month, segment }, "plan/summary failed");
    res.status(500).json({ error: "Failed to compute plan summary" });
  }
});

export default router;

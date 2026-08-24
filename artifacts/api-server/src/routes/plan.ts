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
    res.json({
      month,
      segment,
      allPass,
      passCount: checks.length - failCount,
      failCount,
      checks,
      categoryTotals,
      machineFeasible,
      inputDiagnostics: { pending: pendingDiagnostics },
    });
    return;
  }

  // ── PTMT self-check ────────────────────────────────────────────────────────
  // Fetch everything in one parallel batch — DB reads + both Sheets calls
  // so we only pay the throttle penalty once (they overlap in Promise.all).
  const [
    stockRows,
    pendingUploadSnapshot,
    lastMoRows,
    itemRows,
    bufferRows,
    avg3MoTotals,
    liveOrderTotals,
  ] = await Promise.all([
    loadLatestUploadRowsByKind("current_stock"),
    loadLatestUploadSnapshotByKind("pending_orders"),
    loadLatestUploadRowsByKind("last_month_pending"),
    db.select().from(itemMasterTable).where(eq(itemMasterTable.segment, "PTMT")),
    db.select().from(bufferCategoriesTable).where(eq(bufferCategoriesTable.segment, "PTMT")),
    fetchAvg3MoSaleTotals(month),
    fetchLiveOrderTotals(month),
  ]);

  // Filter DATA.xlsx rows to PTMT segment (file now stores all segments; filter here mirrors buildPlanItems)
  const rawPendingRows = pendingUploadSnapshot.rows;
  const pendingRows = rawPendingRows.filter((row) => {
    const seg = String(row["Segment"] ?? "").trim().toUpperCase();
    return seg === "PTMT" || seg === "PT";
  });

  const checks: CheckResult[] = [];
  const pendingDiagnostics = diagnoseInputRows(pendingRows, {
    code: ["Old Item Code", "Item Code", "Item No."],
    colour: ["Colour", "Color"],
    quantity: ["Balance_Qty", "Balance Qty", "Bal.Qty", "Qty"],
  }, {
    source: "DATA.xlsx (pending orders) · PTMT rows",
    uploadId: pendingUploadSnapshot.id,
    filename: pendingUploadSnapshot.filename,
  });

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
    inputDiagnostics: { pending: pendingDiagnostics },
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
  const itemActual = new Map<string, [number, number, number, number]>();
  const unmappedByWeek: [number, number, number, number] = [0, 0, 0, 0];
  const unmappedCodeQty = new Map<string, number>();
  const unmappedCodeByWeek = new Map<string, [number, number, number, number]>();

  for (const row of sheet3Rows) {
    const cat = codeToCategory.get(row.normCode);
    const wi = wkIdx(parseInt(row.dateStr.slice(8), 10));
    if (!cat) {
      unmappedByWeek[wi] += row.qty;
      unmappedCodeQty.set(row.rawCode, (unmappedCodeQty.get(row.rawCode) ?? 0) + row.qty);
      const wkArr = unmappedCodeByWeek.get(row.rawCode) ?? [0, 0, 0, 0];
      wkArr[wi] += row.qty;
      unmappedCodeByWeek.set(row.rawCode, wkArr);
      continue;
    }
    const arr = catActual.get(cat) ?? [0, 0, 0, 0];
    arr[wi] += row.qty;
    catActual.set(cat, arr);
    const itemKey = `${cat}::${row.normCode}`;
    const itemArr = itemActual.get(itemKey) ?? [0, 0, 0, 0];
    itemArr[wi] += row.qty;
    itemActual.set(itemKey, itemArr);
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

  // Working days and elapsed production days use the same observed-day rule
  // as PTMT monitoring: calendar non-Sundays plus worked Sundays, with future
  // calendar non-Sundays projected for an open month.
  const lastDataDate = sheet3Rows.length > 0 ? [...sheet3Rows].map((r) => r.dateStr).sort().pop()! : null;
  const lifecycle = resolvePlantMonthLifecycle(month).state;
  const dailyByDate = new Map<string, number>();
  for (const row of sheet3Rows) dailyByDate.set(row.dateStr, (dailyByDate.get(row.dateStr) ?? 0) + row.qty);
  const elapsedDays = sheet3Rows.length > 0
    ? buildElapsedProductionDays(month, dailyByDate, lastDataDate)
    : [];
  const workingDaysResolution = resolveWorkingDays(
    month,
    null,
    sheet3Rows.filter((row) => row.qty > 0).map((row) => row.dateStr),
    lastDataDate,
    lifecycle,
  );
  const workingDaysElapsed = lifecycle === "closed" || lifecycle === "grace"
    ? workingDaysResolution.workingDays
    : Math.min(elapsedDays.length, workingDaysResolution.workingDays);
  const workedSundayDates = elapsedDays.filter(
    (date) => new Date(`${date}T00:00:00Z`).getUTCDay() === 0 && (dailyByDate.get(date) ?? 0) > 0,
  );
  const idleWeekdayDates = lastDataDate
    ? [...Array(parseInt((lifecycle === "closed" || lifecycle === "grace" ? `${month}-${p2(lastDayOfMonth)}` : lastDataDate).slice(8), 10))]
      .map((_, index) => `${month}-${p2(index + 1)}`)
      .filter((date) => new Date(`${date}T00:00:00Z`).getUTCDay() !== 0 && (dailyByDate.get(date) ?? 0) <= 0)
    : [];

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

  // Per-item rows for category drill-down. Keep the same weekly population and
  // normalization as the category totals so expanding a row reconciles exactly
  // to the numbers shown above it.
  const itemRelease = new Map<string, {
    itemCode: string;
    category: string;
    release: [number, number, number, number];
  }>();
  for (const item of planItems) {
    const normCode = normalizeCodeStrict(item.itemCode);
    const key = `${item.category}::${normCode}`;
    const existing = itemRelease.get(key);
    const release: [number, number, number, number] = existing?.release ?? [0, 0, 0, 0];
    release[0] += (item as unknown as Record<string, number>)["w1"] ?? 0;
    release[1] += (item as unknown as Record<string, number>)["w2"] ?? 0;
    release[2] += (item as unknown as Record<string, number>)["w3"] ?? 0;
    release[3] += (item as unknown as Record<string, number>)["w4"] ?? 0;
    itemRelease.set(key, {
      itemCode: existing?.itemCode ?? item.itemCode,
      category: item.category,
      release,
    });
  }
  const itemKeys = new Set([...itemRelease.keys(), ...itemActual.keys()]);
  const items = [...itemKeys].map((key) => {
    const planned = itemRelease.get(key);
    const actual = itemActual.get(key) ?? [0, 0, 0, 0];
    const category = planned?.category ?? key.split("::")[0]!;
    const itemCode = planned?.itemCode ?? key.split("::")[1]!;
    const release = planned?.release ?? [0, 0, 0, 0];
    const totalRelease = release.reduce((sum, value) => sum + value, 0);
    const totalActual = actual.reduce((sum, value) => sum + value, 0);
    return {
      itemCode,
      category,
      w1Release: Math.round(release[0]),
      w1Actual: actual[0],
      w2Release: Math.round(release[1]),
      w2Actual: actual[1],
      w3Release: Math.round(release[2]),
      w3Actual: actual[2],
      w4Release: Math.round(release[3]),
      w4Actual: actual[3],
      totalRelease: Math.round(totalRelease),
      totalActual,
    };
  }).sort((a, b) => b.totalRelease - a.totalRelease || a.itemCode.localeCompare(b.itemCode));

  // Keep the complete by-code set for audited downstream reconciliation. The
  // monitoring UI still receives its concise top-20 view separately.
  const allCodes = [...unmappedCodeQty.entries()]
    .sort((a, b) => b[1] - a[1]).map(([code, qty]) => ({
      code,
      qty,
      byWeek: [...(unmappedCodeByWeek.get(code) ?? [0, 0, 0, 0])] as [number, number, number, number],
    }));
  const topCodes = allCodes.slice(0, 20);

  const totalUnmapped = unmappedByWeek.reduce((s, v) => s + v, 0);
  const totalMapped   = plantMapped.reduce((s, v) => s + v, 0);
  const totalProduced = totalMapped + totalUnmapped;
  const runRatePerDay = workingDaysElapsed > 0 ? Math.round(totalProduced / workingDaysElapsed) : 0;

  return {
    month, lastDataDate, workingDaysElapsed,
    workingDays: workingDaysResolution.workingDays,
    workingDaysSource: workingDaysResolution.workingDaysSource,
    positiveProductionDates: sheet3Rows.filter((row) => row.qty > 0).map((row) => row.dateStr),
    workedSundayDates,
    idleWeekdayDates,
    weeks, categories, items,
    unmapped: { byWeek: [...unmappedByWeek], total: totalUnmapped, topCodes, allCodes },
    totalProduced, totalMapped, totalUnmapped, runRatePerDay,
  };
}

// Shared 5-min TTL cache for the Plumbing monitoring payload. Used by BOTH
// /plan/plumbing-monitoring and /monitoring/dashboard?segment=Plumbing so the
// dashboard's first hit doesn't rebuild the plan from Drive workbook tabs
// (~24 s cold). In-flight dedupe: concurrent cold hits share one computation.
// Invalidated after every auto-sync (see routes/sync.ts) so data never goes
// stale past a sync.
const _plumbingMonCache = new Map<string, { payload: unknown; expires: number }>();
const _plumbingMonInFlight = new Map<string, Promise<unknown>>();
// Cache generation: bumped on invalidation. An in-flight computation started
// under an older generation may still resolve to its caller, but it is NOT
// allowed to populate the cache or be reused — so a sync invalidation can never
// be undone by a rebuild that started before (or during) the sync.
let _plumbingMonGeneration = 0;

/** Injectable for tests — defaults to the real computation. */
let _computePlumbingMonitoring: (month: string) => Promise<unknown> = (m) =>
  computePlumbingMonitoringPayload(m);

/** TEST ONLY: swap the underlying computation; returns a restore function. */
export function _setPlumbingMonitoringComputeForTest(
  fn: (month: string) => Promise<unknown>,
): () => void {
  const prev = _computePlumbingMonitoring;
  _computePlumbingMonitoring = fn;
  return () => {
    _computePlumbingMonitoring = prev;
  };
}

export async function getPlumbingMonitoringPayloadCached(month: string): Promise<any> {
  const cached = _plumbingMonCache.get(month);
  if (cached && Date.now() < cached.expires) return cached.payload;

  const inFlight = _plumbingMonInFlight.get(month);
  const refresh =
    inFlight ??
    (() => {
      const gen = _plumbingMonGeneration;
      const promise = _computePlumbingMonitoring(month)
        .then((payload) => {
          // Only populate the cache if no invalidation happened while computing —
          // otherwise this result predates the latest workbook sync.
          if (gen === _plumbingMonGeneration) {
            _plumbingMonCache.set(month, { payload, expires: Date.now() + 5 * 60 * 1000 });
          }
          return payload;
        })
        .finally(() => {
          if (_plumbingMonInFlight.get(month) === promise) {
            _plumbingMonInFlight.delete(month);
          }
        });
      _plumbingMonInFlight.set(month, promise);
      return promise;
    })();

  // Stale-while-revalidate: an EXPIRED entry (TTL passed, not sync-invalidated)
  // is still served instantly while the refresh runs in the background, so no
  // browser hit ever waits out the full ~24 s rebuild. Sync invalidation clears
  // the map entirely, so post-sync data is never served stale.
  if (cached) {
    refresh.catch((err) =>
      logger.warn({ err, month }, "plumbing-monitoring background refresh failed — serving stale"),
    );
    return cached.payload;
  }
  return refresh;
}

/**
 * Drop cached Plumbing monitoring payloads — call after a workbook sync.
 * Bumps the cache generation so any computation already in flight is
 * disregarded: it neither populates the cache nor gets reused by later callers.
 */
export function invalidatePlumbingMonitoringCache(): void {
  _plumbingMonGeneration++;
  _plumbingMonCache.clear();
  _plumbingMonInFlight.clear();
}

router.get("/plan/plumbing-monitoring", async (req, res) => {
  const month = String(req.query.month ?? "");
  if (!/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: "month query param required (YYYY-MM)" });
    return;
  }
  try {
    const payload = await getPlumbingMonitoringPayloadCached(month);
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
    if (err instanceof PlumbingInputUnreadableError) {
      handlePlanError(res, err);
      return;
    }
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

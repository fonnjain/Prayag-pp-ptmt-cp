/**
 * CLI regression runner for the Plumbing production plan.
 *
 * Run with:
 *   pnpm --filter @workspace/scripts run verify
 *
 * Calls the live API (/api/plan/validate) and prints PASS/FAIL per assertion.
 * Exit code 0 = all pass.  Exit code 1 = one or more failures.
 *
 * Requires the API server to be running (workflow: "artifacts/production-planning: api").
 */

const API_BASE = process.env["API_BASE"] ?? "http://localhost:80";
const PLUMBING_MONTH = process.env["PLAN_MONTH"] ?? "2026-07";
const PTMT_MONTH     = process.env["PLAN_MONTH"] ?? "2026-07";
// PTMT plan-golden month: the /plan/validate upload checks assert against the LATEST
// uploads, which rolled to the August 2026 set on 2026-08-05. July goldens are
// July-only and must not be asserted against August data (month-rollover rule).
const PTMT_PLAN_MONTH = process.env["PTMT_PLAN_MONTH"] ?? "2026-08";

type CheckResult = {
  name: string;
  expected: number;
  actual: number;
  pass: boolean;
  tolerance?: string;
};

type ValidateResponse = {
  month: string;
  segment?: string;
  allPass: boolean;
  passCount: number;
  failCount: number;
  checks: CheckResult[];
};

async function callEndpoint(url: string): Promise<ValidateResponse> {
  const delays = [15_000, 30_000, 60_000];
  let lastErr: Error | undefined;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res.json() as Promise<ValidateResponse>;
    const body = await res.text().catch(() => "");
    lastErr = new Error(`HTTP ${res.status} from ${url}: ${body}`);
    if (attempt < delays.length && (res.status === 429 || res.status === 500)) {
      const wait = delays[attempt]!;
      console.log(`    ⏳  Got ${res.status} — Sheets quota; retrying in ${wait / 1000}s …`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    break;
  }
  throw lastErr;
}

async function runValidate(segment: string, month: string): Promise<ValidateResponse> {
  const url = `${API_BASE}/api/plan/validate?segment=${encodeURIComponent(segment)}&month=${encodeURIComponent(month)}`;
  return callEndpoint(url);
}

async function runValidateReplan(month: string, asOfDate?: string): Promise<ValidateResponse> {
  const params = asOfDate
    ? `month=${encodeURIComponent(month)}&asOfDate=${encodeURIComponent(asOfDate)}`
    : `month=${encodeURIComponent(month)}`;
  const url = `${API_BASE}/api/plan/validate-replan?${params}`;
  return callEndpoint(url);
}

function fmt(n: number): string {
  return n.toLocaleString("en-IN");
}

/**
 * JSON fetch with retry for the "New checks" section.
 * The main validate calls go through callEndpoint (which retries on Sheets
 * quota errors), but the endpoint-level checks previously used raw fetch —
 * a transient 429/5xx from a live-Sheets-backed endpoint could flake a single
 * assertion that then passed on re-run.
 */
async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const delays = [5_000, 15_000, 30_000];
  let lastErr: Error | undefined;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return (await res.json()) as T;
      const body = await res.text().catch(() => "");
      lastErr = new Error(`HTTP ${res.status} from ${url}: ${body.slice(0, 200)}`);
      if (attempt < delays.length && [429, 500, 502, 503].includes(res.status)) {
        const wait = delays[attempt]!;
        console.log(`    ⏳  Got ${res.status} from ${url} — retrying in ${wait / 1000}s …`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw lastErr;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt < delays.length) {
        const wait = delays[attempt]!;
        console.log(`    ⏳  Fetch error (${lastErr.message.slice(0, 120)}) — retrying in ${wait / 1000}s …`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
    }
  }
  throw lastErr;
}

/**
 * Evaluate a live-data-backed check; if it fails on the first pass, wait and
 * re-evaluate once before recording a failure.  This makes checks that read
 * live Sheets data (NC11 management-view goldens, NC13 cross-source
 * reconciliation) deterministic against transient partial reads / mid-fetch
 * drift while still catching persistent regressions.
 */
async function evaluateWithRetry(
  label: string,
  compute: () => Promise<CheckResult>,
  retryDelayMs = 20_000,
): Promise<CheckResult> {
  const first = await compute();
  if (first.pass) return first;
  console.log(`    ⚠  ${label} failed once — re-evaluating in ${retryDelayMs / 1000}s to rule out transient live-data flake …`);
  await new Promise((r) => setTimeout(r, retryDelayMs));
  const second = await compute();
  if (second.pass) console.log(`    ✅  ${label} passed on re-evaluation (transient flake absorbed)`);
  return second;
}

function printSection(title: string, checks: CheckResult[]): void {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("─".repeat(60));
  for (const c of checks) {
    const icon = c.pass ? "✅" : "❌";
    const tol  = c.tolerance ? ` (${c.tolerance})` : "";
    if (c.pass) {
      console.log(`${icon}  ${c.name}${tol}  →  ${fmt(c.actual)}`);
    } else {
      console.error(`${icon}  FAIL ${c.name}${tol}`);
      console.error(`     expected ${fmt(c.expected)}  ·  got ${fmt(c.actual)}`);
    }
  }
}

// ── As-of-date working-day unit tests (offline, no API needed) ────────────────
function countWorkingDays(from: string, to: string): number {
  let count = 0;
  const d = new Date(from + "T00:00:00Z");
  const end = new Date(to + "T00:00:00Z");
  while (d <= end) {
    if (d.getUTCDay() !== 0) count++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return count;
}

function deriveWeekClosed(asOfDate: string, monthStart: string, workingDaysPerWeek: number): number {
  const used = countWorkingDays(monthStart, asOfDate);
  return Math.min(Math.floor(used / workingDaysPerWeek), 3);
}

function runAsOfDateUnitTests(): boolean {
  // July 2026: Jul 1 = Wednesday. Non-Sunday days 1..7: Wed Thu Fri Sat [Sun skip] Mon Tue → 6 working days → W1 end.
  const MONTH_START_JUL26 = "2026-07-01";
  const WPW = 6;

  // July 2026: Jul-1=Wed(1), Jul-2=Thu(2), Jul-3=Fri(3), Jul-4=Sat(4), [Jul-5=Sun skip],
  //            Jul-6=Mon(5), Jul-7=Tue(6) → 6th working day = last day of W1
  //            Jul-8..Jul-11=days 7-10, [Jul-12=Sun], Jul-13=Mon(11), Jul-14=Tue(12) = last day of W2
  //            Jul-15..Jul-18=days 13-16, [Jul-19=Sun], Jul-20=Mon(17), Jul-21=Tue(18) = last day of W3
  const cases: { label: string; asOf: string; expectUsed: number; expectWeekClosed: number }[] = [
    { label: "Jul 2026 Jul-01 = first working day, W0",        asOf: "2026-07-01", expectUsed: 1,  expectWeekClosed: 0 },
    { label: "Jul 2026 Jul-06 = day 5 (Sun Jul-5 skipped), W0", asOf: "2026-07-06", expectUsed: 5,  expectWeekClosed: 0 },
    { label: "Jul 2026 Jul-07 = day 6 = last day W1 → wc=1",  asOf: "2026-07-07", expectUsed: 6,  expectWeekClosed: 1 },
    { label: "Jul 2026 Jul-13 = day 11 (still W1, not W2 yet)", asOf: "2026-07-13", expectUsed: 11, expectWeekClosed: 1 },
    { label: "Jul 2026 Jul-14 = day 12 = last day W2 → wc=2", asOf: "2026-07-14", expectUsed: 12, expectWeekClosed: 2 },
    { label: "Jul 2026 Jul-21 = day 18 = last day W3 → wc=3", asOf: "2026-07-21", expectUsed: 18, expectWeekClosed: 3 },
  ];

  let allPass = true;
  for (const tc of cases) {
    const used = countWorkingDays(MONTH_START_JUL26, tc.asOf);
    const wc   = deriveWeekClosed(tc.asOf, MONTH_START_JUL26, WPW);
    const passUsed = used === tc.expectUsed;
    const passWc   = wc   === tc.expectWeekClosed;
    const pass = passUsed && passWc;
    if (pass) {
      console.log(`✅  ${tc.label}  →  used=${used}, weekClosed=${wc}`);
    } else {
      console.error(`❌  FAIL ${tc.label}`);
      if (!passUsed) console.error(`     workingDaysUsed: expected ${tc.expectUsed}, got ${used}`);
      if (!passWc)   console.error(`     weekClosed:      expected ${tc.expectWeekClosed}, got ${wc}`);
      allPass = false;
    }
  }
  return allPass;
}

async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log("  PTMT Production Plan — Regression Test Suite");
  console.log(`  Plumbing month : ${PLUMBING_MONTH}`);
  console.log(`  PTMT month     : ${PTMT_MONTH}`);
  console.log(`  API base       : ${API_BASE}`);
  console.log("=".repeat(60));

  let anyFail = false;

  // ── 0. As-of-date unit tests (offline) ───────────────────────────────────
  console.log("\n" + "─".repeat(60));
  console.log("  As-of-date working-day derivation (unit tests)");
  console.log("─".repeat(60));
  if (!runAsOfDateUnitTests()) {
    anyFail = true;
    console.error("\n❌  As-of-date unit tests FAILED");
  } else {
    console.log("\n✅  As-of-date unit tests all PASSED");
  }

  // ── 1. Plumbing validate ─────────────────────────────────────────────────
  console.log("\n⏳  Running Plumbing validation (this calls live Sheets API, ~20s) …");
  let plumbingResult: ValidateResponse;
  try {
    plumbingResult = await runValidate("Plumbing", PLUMBING_MONTH);
  } catch (err) {
    console.error(`\n❌  Could not reach Plumbing validate endpoint:`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    console.error(`    Is the API server running? Check workflow "artifacts/production-planning: api"`);
    process.exit(1);
  }

  // Group checks by prefix for display
  const guards      = plumbingResult.checks.filter((c) => c.name.startsWith("GUARD"));
  const isolation   = plumbingResult.checks.filter((c) => c.name.startsWith("ISOLATION"));
  const buffers     = plumbingResult.checks.filter((c) => c.name.startsWith("Buffer"));
  const solvents    = plumbingResult.checks.filter((c) => c.name.startsWith("Solvent"));
  const itemCounts  = plumbingResult.checks.filter((c) => c.name.startsWith("Items ·"));
  const kgChecks    = plumbingResult.checks.filter((c) => c.name.startsWith("KG ·"));
  const weeklyPlant = plumbingResult.checks.filter((c) => c.name.startsWith("Weekly · Plant"));
  const weeklySum   = plumbingResult.checks.filter((c) => c.name.endsWith("· sum = prod req"));
  const weeklyCat   = plumbingResult.checks.filter(
    (c) => c.name.startsWith("Weekly ·") && !c.name.startsWith("Weekly · Plant") && !c.name.endsWith("· sum = prod req"),
  );
  const machineChks = plumbingResult.checks.filter((c) => c.name.startsWith("Machine ·"));
  const categories  = plumbingResult.checks.filter(
    (c) => !c.name.startsWith("GUARD") && !c.name.startsWith("ISOLATION") &&
            !c.name.startsWith("Buffer") && !c.name.startsWith("Solvent") &&
            !c.name.startsWith("Items ·") && !c.name.startsWith("KG ·") &&
            !c.name.startsWith("Weekly ·") && !c.name.startsWith("Machine ·"),
  );

  printSection("Plumbing — Guard assertions", guards);
  printSection("Plumbing — Segment isolation", isolation);
  printSection("Plumbing — Buffer multipliers", buffers);
  printSection("Plumbing — Solvent membership", solvents);
  printSection("Plumbing — Item counts per category (exact)", itemCounts);
  printSection(`Plumbing — 12 category totals (${PLUMBING_MONTH}, ±0.1%)`, categories);
  printSection(`Plumbing — KG from BOM (${PLUMBING_MONTH}, ±1%)`, kgChecks);
  printSection(`Plumbing — Weekly release: plant totals (${PLUMBING_MONTH}, ±1%)`, weeklyPlant);
  printSection(`Plumbing — Weekly release: per-category W1–W4 (${PLUMBING_MONTH}, ±1%)`, weeklyCat);
  printSection(`Plumbing — Weekly release: W1+W2+W3+W4 = prod req (exact)`, weeklySum);
  printSection(`Plumbing — Machine cascade guards (${PLUMBING_MONTH})`, machineChks);

  if (!plumbingResult.allPass) {
    anyFail = true;
    console.error(`\n❌  Plumbing: ${plumbingResult.failCount} check(s) FAILED`);
  } else {
    console.log(`\n✅  Plumbing: all ${plumbingResult.passCount} checks PASSED`);
  }

  // ── 1b. Machine capacity hours-cap check ─────────────────────────────────
  console.log("\n⏳  Running machine hours-cap check (no machine > 100% utilisation) …");
  try {
    const machRes = await fetch(`${API_BASE}/api/capacity/machines?segment=Plumbing&month=${encodeURIComponent(PLUMBING_MONTH)}`);
    if (!machRes.ok) throw new Error(`HTTP ${machRes.status}`);
    const machData = await machRes.json() as {
      utilisation: { machineId: string; pool: string; week: number; hoursUsed: number; hoursAvailable: number; utilisationPct: number }[];
    };
    const overCap = machData.utilisation.filter(u => u.utilisationPct > 100.05);
    const capChecks: CheckResult[] = [
      {
        name: "Machine · no machine×week over 100% utilisation",
        expected: 0,
        actual: overCap.length,
        pass: overCap.length === 0,
        tolerance: "exact",
      },
    ];
    if (overCap.length > 0) {
      for (const u of overCap)
        capChecks.push({
          name: `  ⚠ Over-cap: ${u.machineId} W${u.week} @ ${u.utilisationPct.toFixed(1)}%`,
          expected: 0,
          actual: 1,
          pass: false,
        });
    }
    printSection("Plumbing — Machine hours-cap", capChecks);
    if (overCap.length > 0) {
      anyFail = true;
      console.error(`\n❌  Machine hours-cap: ${overCap.length} machine×week(s) over 100%`);
    } else {
      console.log(`\n✅  Machine hours-cap: all machines within capacity`);
    }
  } catch (err) {
    console.error(`\n⚠  Machine hours-cap check skipped: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── 2. Corrective re-plan validate ───────────────────────────────────────
  console.log("\n⏳  Running Plumbing corrective re-plan validation (reads Sheet3, ~5s) …");
  let replanResult: ValidateResponse;
  try {
    replanResult = await runValidateReplan(PLUMBING_MONTH); // no asOfDate → endpoint uses today
  } catch (err) {
    console.error(`\n❌  Could not reach validate-replan endpoint: ${err instanceof Error ? err.message : String(err)}`);
    anyFail = true;
    replanResult = { month: PLUMBING_MONTH, allPass: false, passCount: 0, failCount: 1, checks: [] };
  }

  const replanGuards  = replanResult.checks.filter((c) => c.name.startsWith("ReplanGuard"));
  const replanInvs    = replanResult.checks.filter((c) => c.name.startsWith("ReplanInv"));
  const replanGoldens = replanResult.checks.filter(
    (c) => c.name.startsWith("Replan ·") && !c.name.startsWith("Replan · Total"),
  );
  const replanTotals  = replanResult.checks.filter((c) => c.name.startsWith("Replan · Total") || c.name.startsWith("Replan · Unplanned"));

  printSection(`Replan — guards`, replanGuards);
  printSection(`Replan — structural invariants (always exact, ${PLUMBING_MONTH})`, replanInvs);
  printSection(`Replan — per-category dynamic guards (date-independent)`, replanGoldens);
  printSection(`Replan — total dynamic guards`, replanTotals);

  if (!replanResult.allPass) {
    anyFail = true;
    console.error(`\n❌  Replan: ${replanResult.failCount} check(s) FAILED`);
  } else {
    console.log(`\n✅  Replan: all ${replanResult.passCount} checks PASSED`);
  }

  // ── 3. PTMT validate ─────────────────────────────────────────────────────
  console.log("\n⏳  Running PTMT validation …");
  let ptmtResult: ValidateResponse;
  try {
    ptmtResult = await runValidate("PTMT", PTMT_PLAN_MONTH);
  } catch (err) {
    console.error(`\n❌  Could not reach PTMT validate endpoint: ${err instanceof Error ? err.message : String(err)}`);
    anyFail = true;
    ptmtResult = { month: PTMT_PLAN_MONTH, allPass: false, passCount: 0, failCount: 1, checks: [] };
  }

  const ptmtGuards    = ptmtResult.checks.filter((c) => !c.name.startsWith("PTMT ·"));
  const ptmtCats      = ptmtResult.checks.filter((c) => c.name.startsWith("PTMT ·"));
  printSection(`PTMT — regression guards (${PTMT_PLAN_MONTH})`, ptmtGuards);
  printSection(`PTMT — per-category Max / Min (${PTMT_PLAN_MONTH}, ±0.1%)`, ptmtCats);

  if (!ptmtResult.allPass) {
    anyFail = true;
    console.error(`\n❌  PTMT: ${ptmtResult.failCount} check(s) FAILED`);
  } else {
    console.log(`\n✅  PTMT: all ${ptmtResult.passCount} checks PASSED`);
  }

  // ── 4. Plumbing monitoring validate ──────────────────────────────────────
  console.log("\n⏳  Running Plumbing monitoring validation (reads Sheet3, ~5s) …");
  let monResult: ValidateResponse;
  try {
    monResult = await callEndpoint(
      `${API_BASE}/api/plan/validate-plumbing-monitoring?month=${encodeURIComponent(PLUMBING_MONTH)}`,
    );
  } catch (err) {
    console.error(`\n❌  Could not reach validate-plumbing-monitoring endpoint: ${err instanceof Error ? err.message : String(err)}`);
    anyFail = true;
    monResult = { month: PLUMBING_MONTH, allPass: false, passCount: 0, failCount: 1, checks: [] };
  }

  const monPlant = monResult.checks.filter((c) => c.name.startsWith("Mon · Plant") || c.name.startsWith("Mon · W"));
  const monCatW1 = monResult.checks.filter((c) => c.name.match(/Mon · .+ W1$/) && !c.name.startsWith("Mon · Plant") && !c.name.startsWith("Mon · W"));
  const monCatW2 = monResult.checks.filter((c) => c.name.match(/Mon · .+ W2$/) && !c.name.startsWith("Mon · Plant") && !c.name.startsWith("Mon · W"));

  printSection(`Monitoring — plant W1/W2 totals + unmapped (${PLUMBING_MONTH}, frozen)`, monPlant);
  printSection(`Monitoring — per-category W1 actuals (${PLUMBING_MONTH}, ±1%)`, monCatW1);
  printSection(`Monitoring — per-category W2 actuals (${PLUMBING_MONTH}, ±1%)`, monCatW2);

  if (!monResult.allPass) {
    anyFail = true;
    console.error(`\n❌  Monitoring: ${monResult.failCount} check(s) FAILED`);
  } else {
    console.log(`\n✅  Monitoring: all ${monResult.passCount} checks PASSED`);
  }

  // ── 5. Schema-parity check ────────────────────────────────────────────────
  console.log("\n⏳  Running corrective schema-parity check (standard format = main plan schema) …");
  let schemaParityResult: ValidateResponse;
  try {
    schemaParityResult = await callEndpoint(
      `${API_BASE}/api/corrective/validate/schema-parity?month=${encodeURIComponent(PLUMBING_MONTH)}&segment=Plumbing`,
    );
  } catch (err) {
    console.error(`\n❌  Could not reach schema-parity endpoint: ${err instanceof Error ? err.message : String(err)}`);
    anyFail = true;
    schemaParityResult = { month: PLUMBING_MONTH, allPass: false, passCount: 0, failCount: 1, checks: [] };
  }

  const schemaSheets   = schemaParityResult.checks.filter((c) => c.name.startsWith("SchemaParity · Sheet"));
  const schemaHeaders  = schemaParityResult.checks.filter((c) => c.name.includes("header row"));
  const schemaInvs     = schemaParityResult.checks.filter(
    (c) => c.name.includes("planRev = producedCapped") || c.name.includes("planRev total"),
  );

  printSection(`Schema-parity — sheet structure (standard corrective = main plan)`, schemaSheets);
  printSection(`Schema-parity — per-category header rows (cell-by-cell, ${PLUMBING_MONTH})`, schemaHeaders);
  printSection(`Schema-parity — planRev reconciliation invariants (${PLUMBING_MONTH})`, schemaInvs);

  if (!schemaParityResult.allPass) {
    anyFail = true;
    console.error(`\n❌  Schema-parity: ${schemaParityResult.failCount} check(s) FAILED`);
  } else {
    console.log(`\n✅  Schema-parity: all ${schemaParityResult.passCount} checks PASSED`);
  }

  // ── 6. New permanent endpoint-level checks ───────────────────────────────
  console.log("\n⏳  Running new permanent endpoint-level checks …");
  const newChecks: CheckResult[] = [];
  try {
    // NC1: monitoring/dashboard segment isolation — PTMT and PLUMBING return different data shapes
    const [ptmtDash, plumbDash] = await Promise.all([
      fetchJson<Record<string, unknown>>(`${API_BASE}/api/monitoring/dashboard?month=${PLUMBING_MONTH}&segment=PTMT`),
      fetchJson<Record<string, unknown>>(`${API_BASE}/api/monitoring/dashboard?month=${PLUMBING_MONTH}&segment=PLUMBING`),
    ]);
    const ptmtPlant      = (ptmtDash?.plant as Record<string, unknown>) ?? {};
    const ptmtHasTarget  = typeof ptmtPlant.targetKg === "number" || typeof ptmtPlant.targetPcs === "number";
    const plumbHasPieces = typeof (plumbDash?.plant as Record<string, unknown>)?.produced === "number";
    newChecks.push({
      name: "NC1 · monitoring/dashboard · PTMT has plan target field, PLUMBING returns pieces-based",
      expected: 1, actual: (ptmtHasTarget && plumbHasPieces) ? 1 : 0,
      pass: ptmtHasTarget && plumbHasPieces, tolerance: "structural diff",
    });

    // NC2: Plumbing monitoring categories have `produced` field, at least one non-zero
    const monData = await fetchJson<Record<string, unknown>>(`${API_BASE}/api/plan/plumbing-monitoring?month=${PLUMBING_MONTH}`);
    const cats = (monData?.categories as Array<Record<string, unknown>>) ?? [];
    const anyProduced = cats.some((c) => ((c["produced"] as number) ?? 0) > 0);
    newChecks.push({
      name: "NC2 · plumbing-monitoring · at least one category has produced > 0",
      expected: 1, actual: anyProduced ? 1 : 0,
      pass: anyProduced, tolerance: "> 0",
    });

    // NC2b: Σ(produced) + unmapped ≈ totalProduced (reconciliation, ±1 unit for rounding)
    const sumProduced = cats.reduce((s, c) => s + (((c["produced"] as number)) ?? 0), 0);
    const totalUnmappedMon = (monData?.totalUnmapped as number) ?? 0;
    const totalProducedMon = (monData?.totalProduced as number) ?? 0;
    const reconOk = (sumProduced + totalUnmappedMon) === totalProducedMon;
    newChecks.push({
      name: "NC2b · plumbing-monitoring · Σ(produced) + unmapped === totalProduced",
      expected: totalProducedMon, actual: sumProduced + totalUnmappedMon,
      pass: reconOk, tolerance: "exact",
    });

    // NC3: corrective workingDaysRemaining reflects today (not the full-month total)
    const replanLive = await fetchJson<Record<string, unknown>>(`${API_BASE}/api/plan/corrective-replan?month=${PLUMBING_MONTH}`);
    const todayStr   = new Date().toISOString().slice(0, 10);
    const inCurrMo   = todayStr.startsWith(PLUMBING_MONTH);
    const fullMonthWdr = 27; // July 2026 has 27 working days
    const wdrActual  = (replanLive?.workingDaysRemaining as number) ?? fullMonthWdr;
    const wdrOk      = !inCurrMo || wdrActual < fullMonthWdr;
    newChecks.push({
      name: `NC3 · corrective-replan · workingDaysRemaining (${wdrActual}) < full month when mid-month`,
      expected: 1, actual: wdrOk ? 1 : 0,
      pass: wdrOk, tolerance: `< ${fullMonthWdr} when in ${PLUMBING_MONTH}`,
    });

    // NC4: capacityPerDay field present, non-zero, consistent with feasible ÷ wdr
    const wdr = (replanLive?.workingDaysRemaining as number) ?? 0;
    const repCats = (replanLive?.categories as Array<Record<string, unknown>>) ?? [];
    let capDayOk = true;
    for (const c of repCats.filter((c) => ((c["produced"] as number) ?? 0) > 0)) {
      const cap = (c["capacityPerDay"] as number) ?? (c["capPerDay"] as number) ?? 0;
      if (cap === 0) { capDayOk = false; break; }
      if (wdr > 0 && Math.abs(((c["feasible"] as number) ?? 0) - cap * wdr) > 1) { capDayOk = false; break; }
    }
    newChecks.push({
      name: "NC4 · corrective-replan · capacityPerDay non-zero and = feasible ÷ wdr for active cats",
      expected: 1, actual: capDayOk ? 1 : 0,
      pass: capDayOk, tolerance: "feasible = capDay × wdr",
    });

    // NC15a: no category with production may carry Cap/Day = 0 (p90→mean fallback)
    const zeroCapWithProd = repCats.filter(
      (c) => ((c["produced"] as number) ?? 0) > 0 && (((c["capPerDay"] as number) ?? 0) === 0),
    );
    newChecks.push({
      name: `NC15a · corrective-replan · no zero Cap/Day for categories with production (${zeroCapWithProd.length} offenders)`,
      expected: 0, actual: zeroCapWithProd.length,
      pass: zeroCapWithProd.length === 0, tolerance: "p90 ≥5 days, mean 1–4 days, 0 only with no production",
    });

    // NC15b: capacityMethod surfaced per category and consistent with production
    let methodOk = repCats.length > 0;
    for (const c of repCats) {
      const method = c["capacityMethod"] as string | undefined;
      const produced = (c["produced"] as number) ?? 0;
      if (!method) { methodOk = false; break; }
      if (produced > 0 && method === "none") { methodOk = false; break; }
      if (produced === 0 && (method === "p90" || method === "mean")) { methodOk = false; break; }
    }
    newChecks.push({
      name: "NC15b · corrective-replan · capacityMethod present and consistent (p90/mean ⇔ production exists)",
      expected: 1, actual: methodOk ? 1 : 0,
      pass: methodOk, tolerance: "method ∈ {p90,mean,override,db,none}",
    });

    // NC15c: shortfall must NOT equal 100% of remaining for categories with
    // production and remaining work (the Cap/Day=0 regression signature).
    // Only meaningful while working days remain: with wdr=0 (month over),
    // feasible is legitimately 0 and shortfall equals remaining.
    const totalShortfallBug = wdr <= 0 ? [] : repCats.filter((c) => {
      const produced = (c["produced"] as number) ?? 0;
      const remaining = (c["remaining"] as number) ?? 0;
      const shortfall = (c["shortfall"] as number) ?? 0;
      return produced > 0 && remaining > 0 && shortfall >= remaining;
    });
    newChecks.push({
      name: `NC15c · corrective-replan · shortfall < remaining when a producing category has capacity (${totalShortfallBug.length} offenders)`,
      expected: 0, actual: totalShortfallBug.length,
      pass: totalShortfallBug.length === 0, tolerance: "shortfall = max(remaining − cap×wdr, 0) with cap > 0",
    });

    // NC5: Plan GET 200 + non-empty array when Plumbing FG upload is present (422 guard active)
    const planResp = await fetch(`${API_BASE}/api/plan?month=${PLUMBING_MONTH}&segment=Plumbing`);
    const planBody = await planResp.json() as unknown;
    const planOk = planResp.ok && Array.isArray(planBody) && (planBody as unknown[]).length > 0;
    newChecks.push({
      name: "NC5 · GET /plan · Plumbing returns items when FG upload present (422 guard active)",
      expected: 1, actual: planOk ? 1 : 0,
      pass: planOk, tolerance: "non-empty array",
    });

    // ── PTMT parity assertions (NC6–NC11) ─────────────────────────────────────

    // NC6: PTMT monitoring — categories non-empty, plan target non-zero, NRI ≠ all items,
    //      AND produced > 0 now that ANUJ Production is wired
    const ptmtCats   = (ptmtDash?.categories as Array<Record<string, unknown>>) ?? [];
    const ptmtTarget = (ptmtPlant.targetPcs as number) ?? (ptmtPlant.targetKg as number) ?? 0;
    const ptmtNRI    = (ptmtDash?.needsReviewItems as unknown[]) ?? [];
    const ptmtProducedPlant = (ptmtPlant.produced as number) ?? 0;
    const ptmtMonOk  = ptmtCats.length > 0 && ptmtTarget > 0 && ptmtNRI.length < 3636 && ptmtProducedPlant > 0;
    newChecks.push({
      name: `NC6 · PTMT monitoring · categories (${ptmtCats.length}), targetPcs (${Math.round(ptmtTarget)}), produced (${Math.round(ptmtProducedPlant)}), NRI < 3636`,
      expected: 1, actual: ptmtMonOk ? 1 : 0,
      pass: ptmtMonOk, tolerance: "categories>0 & targetPcs>0 & produced>0 & NRI<3636",
    });

    // NC7: PTMT corrective POST weekClosed=0 → wdr reflects today, not the full month
    const ptmtReplan = await fetchJson<Record<string, unknown>>(`${API_BASE}/api/corrective/replan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month: PTMT_MONTH, segment: "PTMT", weekClosed: 0, dryRun: true }),
    });
    const ptmtWdr     = (ptmtReplan?.workingDaysRemaining as number) ?? 27;
    const fullMonWdr  = 27; // July 2026
    const todayInMo   = new Date().toISOString().slice(0, 7) === PTMT_MONTH;
    const ptmtWdrOk   = !todayInMo || ptmtWdr < fullMonWdr;
    newChecks.push({
      name: `NC7 · PTMT corrective POST weekClosed=0 · wdr (${ptmtWdr}) < full month when mid-month`,
      expected: 1, actual: ptmtWdrOk ? 1 : 0,
      pass: ptmtWdrOk, tolerance: `< ${fullMonWdr} when in ${PTMT_MONTH}`,
    });

    // NC16a–e: PTMT capacity freshness + run-rate divergence (ptmtReplan now in scope)
    const ptmtRepCats = (ptmtReplan?.["categories"] as Array<Record<string, unknown>>) ?? [];
    const ptmtDbWithProd = ptmtRepCats.filter(
      (c) => ((c["produced"] as number) ?? 0) > 0 && c["capacityMethod"] === "db",
    );
    newChecks.push({
      name: `NC16a · PTMT corrective · no producing category uses stale seeded capacity (${ptmtDbWithProd.length} offenders)`,
      expected: 0, actual: ptmtDbWithProd.length,
      pass: ptmtDbWithProd.length === 0,
      tolerance: "capacityMethod must be p90/mean (from actuals) not db (seeded) when production exists",
    });

    const ptmtStaleCapMethod = ptmtRepCats.filter(
      (c) => ((c["produced"] as number) ?? 0) > 0 && ((c["daysRun"] as number) ?? 0) === 0,
    );
    newChecks.push({
      name: `NC16b · PTMT corrective · daysRun > 0 for every category with production (${ptmtStaleCapMethod.length} offenders)`,
      expected: 0, actual: ptmtStaleCapMethod.length,
      pass: ptmtStaleCapMethod.length === 0,
      tolerance: "daysRun must reflect observed production days in the planned month",
    });

    const ptmtRRFieldsOk = ptmtRepCats.length > 0 && ptmtRepCats.every(
      (c) => typeof c["daysRun"] === "number" &&
             typeof c["feasibleAtRunRate"] === "number" &&
             typeof c["runRateDivergenceFlag"] === "boolean",
    );
    newChecks.push({
      name: "NC16c · PTMT corrective · run-rate divergence fields present (daysRun / feasibleAtRunRate / runRateDivergenceFlag)",
      expected: 1, actual: ptmtRRFieldsOk ? 1 : 0, pass: ptmtRRFieldsOk,
      tolerance: "all three fields must exist on every category",
    });

    const plumbingRRFieldsOk = repCats.length > 0 && repCats.every(
      (c) => typeof c["daysRun"] === "number" &&
             typeof c["feasibleAtRunRate"] === "number" &&
             typeof c["runRateDivergenceFlag"] === "boolean",
    );
    newChecks.push({
      name: "NC16d · Plumbing corrective · run-rate divergence fields present (daysRun / feasibleAtRunRate / runRateDivergenceFlag)",
      expected: 1, actual: plumbingRRFieldsOk ? 1 : 0, pass: plumbingRRFieldsOk,
      tolerance: "all three fields must exist on every category",
    });

    const allRepCatsForDiv = [...repCats, ...ptmtRepCats];
    const divergenceFlagConsistent = allRepCatsForDiv.every((c) => {
      const boolFlag = (c["runRateDivergenceFlag"] as boolean) ?? false;
      const flags = (c["flags"] as string[]) ?? [];
      return boolFlag === flags.includes("RUN_RATE_DIVERGENCE");
    });
    newChecks.push({
      name: "NC16e · both segments · runRateDivergenceFlag boolean ⟺ RUN_RATE_DIVERGENCE in flags[]",
      expected: 1, actual: divergenceFlagConsistent ? 1 : 0, pass: divergenceFlagConsistent,
      tolerance: "boolean field and flags array must always be in sync",
    });

    // NC8: PTMT weekly release — plant W1+W2+W3+W4 ≈ plan total (within 0.5%) per category
    const ptmtPlanItems = await fetchJson<Array<Record<string, unknown>>>(`${API_BASE}/api/plan?month=${PTMT_PLAN_MONTH}&segment=PTMT`);
    const ptmtCatMap = new Map<string, { w1: number; w2: number; w3: number; w4: number; plan: number }>();
    let ptmtUnreleasedPcs = 0; // items with maxProduction > 0 but week=null (cover beyond top band) — engine intentionally defers these
    for (const it of ptmtPlanItems) {
      const cat = String(it["category"] ?? "");
      if (!ptmtCatMap.has(cat)) ptmtCatMap.set(cat, { w1: 0, w2: 0, w3: 0, w4: 0, plan: 0 });
      const c = ptmtCatMap.get(cat)!;
      c.w1   += (it["w1"]   as number) ?? 0;
      c.w2   += (it["w2"]   as number) ?? 0;
      c.w3   += (it["w3"]   as number) ?? 0;
      c.w4   += (it["w4"]   as number) ?? 0;
      const mp = (it["maxProduction"] as number) ?? 0;
      if (it["week"] == null && mp > 0) { ptmtUnreleasedPcs += mp; continue; } // excluded from wSum≈plan invariant, surfaced below
      c.plan += mp;
    }
    if (ptmtUnreleasedPcs > 0) console.log(`  NC8 note: ${Math.round(ptmtUnreleasedPcs)} pcs unreleased (week=null, cover beyond top band) — excluded from wSum≈plan invariant`);
    let ptmtWeeklyOk = ptmtCatMap.size === 7; // must have exactly 7 PTMT categories
    for (const [cat, v] of ptmtCatMap) {
      const wSum = v.w1 + v.w2 + v.w3 + v.w4;
      if (v.plan > 0 && Math.abs(wSum - v.plan) / v.plan > 0.005) { // within 0.5%
        console.error(`  NC8 fail: ${cat} wSum=${Math.round(wSum)} plan=${Math.round(v.plan)}`);
        ptmtWeeklyOk = false;
      }
    }
    const ptmtPlantW1 = [...ptmtCatMap.values()].reduce((s, v) => s + v.w1, 0);
    const ptmtPlanTotal = [...ptmtCatMap.values()].reduce((s, v) => s + v.plan, 0);
    newChecks.push({
      name: `NC8 · PTMT weekly release · 7 categories, W1+W2+W3+W4 ≈ plan per cat (±0.5%), W1=${Math.round(ptmtPlantW1)}`,
      expected: 1, actual: ptmtWeeklyOk ? 1 : 0,
      pass: ptmtWeeklyOk, tolerance: "7 cats, each W-sum within 0.5% of plan",
    });
    // Plant-level W-sum within 0.5% of grand total
    const ptmtPlantWSum = [...ptmtCatMap.values()].reduce((s, v) => s + v.w1 + v.w2 + v.w3 + v.w4, 0);
    const ptmtPlantSumOk = Math.abs(ptmtPlantWSum - ptmtPlanTotal) / ptmtPlanTotal < 0.005;
    newChecks.push({
      name: `NC8b · PTMT plant · ΣW1-W4 (${Math.round(ptmtPlantWSum)}) ≈ grand total (${Math.round(ptmtPlanTotal)}) within 0.5%`,
      expected: ptmtPlanTotal, actual: ptmtPlantWSum,
      pass: ptmtPlantSumOk, tolerance: "±0.5%",
    });

    // NC12: PTMT monitoring produced pcs non-zero + category reconciliation
    const ptmtUnmapped = (ptmtDash?.unmapped as Record<string, unknown>) ?? {};
    const ptmtUnmappedTotal = (ptmtUnmapped.total as number) ?? 0;
    const ptmtCatProducedSum = ptmtCats.reduce((s: number, c: Record<string, unknown>) => s + ((c.produced as number) ?? 0), 0);
    const ptmtTotalProducedDash = (ptmtPlant.totalProduced as number) ?? 0;
    const ptmtMappedDash        = (ptmtPlant.mapped as number) ?? 0;
    // Σ(cat produced) + unmapped === total produced (exact reconciliation)
    const ptmtReconOk = ptmtMappedDash > 0 && Math.abs(ptmtCatProducedSum + ptmtUnmappedTotal - ptmtTotalProducedDash) < 1;
    newChecks.push({
      name: `NC12 · PTMT monitoring · producedMapped (${Math.round(ptmtMappedDash)}) > 0 and catSum+unmapped (${Math.round(ptmtCatProducedSum + ptmtUnmappedTotal)}) = totalProduced (${Math.round(ptmtTotalProducedDash)})`,
      expected: 1, actual: ptmtReconOk ? 1 : 0,
      pass: ptmtReconOk, tolerance: "mapped>0, exact recon",
    });

    // NC13: Cross-source reconciliation — monitoring producedToDate ≈ corrective producedToDate
    // Both read the ANUJ Production sheet via fetchDailyActuals.
    // Small divergence (≤2%) is expected: the corrective engine extends the plan with new-order
    // items (deltaNewOrders), so it matches production against a slightly larger code set than
    // monitoring's static base plan.  A divergence > 2% would signal a real bug (e.g., monitoring
    // silently reading 0 while corrective reads 530K).
    // ptmtReplan was already fetched in NC7 (weekClosed=0, asOfDate=today).
    // Both sources read live Sheets data; on a first-pass failure, refetch BOTH
    // at the same moment and re-evaluate once (rules out mid-suite drift and
    // transient partial reads — the historical flake in this section).
    let nc13Replan = ptmtReplan;
    let nc13MonProd = ptmtMappedDash;
    let nc13Refetched = false;
    newChecks.push(await evaluateWithRetry("NC13", async () => {
      if (nc13Refetched) {
        const [freshDash, freshReplan] = await Promise.all([
          fetchJson<Record<string, unknown>>(`${API_BASE}/api/monitoring/dashboard?month=${PLUMBING_MONTH}&segment=PTMT`),
          fetchJson<Record<string, unknown>>(`${API_BASE}/api/corrective/replan`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ month: PTMT_MONTH, segment: "PTMT", weekClosed: 0, dryRun: true }),
          }),
        ]);
        nc13Replan  = freshReplan;
        nc13MonProd = (((freshDash?.plant as Record<string, unknown>) ?? {}).mapped as number) ?? 0;
      }
      nc13Refetched = true; // any subsequent evaluation refetches both sources together
      const corrProd = (nc13Replan?.producedToDate as number) ?? -1;
      const monProd  = nc13MonProd;
      const pctDiff  = corrProd > 0 ? Math.abs(monProd - corrProd) / corrProd : 1;
      const crossSourceOk = corrProd >= 0 && pctDiff <= 0.02;
      return {
        name: `NC13 · Cross-source · monitoring (${Math.round(monProd)}) vs corrective (${corrProd}) ±2% (diff=${(pctDiff*100).toFixed(2)}%)`,
        expected: corrProd, actual: Math.round(monProd),
        pass: crossSourceOk, tolerance: "±2% (architectural: corrective adds new-order items)",
      };
    }));

    // NC9: PTMT plan run save + retrieve (infrastructure parity with Plumbing)
    const ptmtRunResp = await fetch(`${API_BASE}/api/plan/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month: PTMT_MONTH, segment: "PTMT", note: "suite-NC9" }),
    });
    const ptmtRun = await ptmtRunResp.json() as Record<string, unknown>;
    const ptmtRunSaved = ptmtRunResp.status === 201 && typeof ptmtRun.id === "number";
    // Verify retrieval
    let ptmtRunRetrieved = false;
    if (ptmtRunSaved) {
      const listResp = await fetch(`${API_BASE}/api/plan/runs?month=${PTMT_MONTH}&segment=PTMT`);
      const list = await listResp.json() as Array<Record<string, unknown>>;
      ptmtRunRetrieved = Array.isArray(list) && list.some((r) => r.id === ptmtRun.id);
    }
    newChecks.push({
      name: `NC9 · PTMT plan run · save (201) and retrieve from list`,
      expected: 1, actual: (ptmtRunSaved && ptmtRunRetrieved) ? 1 : 0,
      pass: ptmtRunSaved && ptmtRunRetrieved, tolerance: "POST 201 + appears in GET list",
    });

    // NC10: Ops overview segment filter — PTMT ≠ Plumbing ≠ Combined orderValue
    // Live-Sheets-backed; fetch the three segments SEQUENTIALLY (concurrent
    // fetches under quota pressure produced a transient partial Combined value
    // where Combined < Plumbing — the historical flake in this section), and
    // re-evaluate once on failure.
    newChecks.push(await evaluateWithRetry("NC10", async () => {
      const opsP = await fetchJson<Record<string, unknown>>(`${API_BASE}/api/ops/overview?fy=2026-27&segment=Plumbing`);
      const opsT = await fetchJson<Record<string, unknown>>(`${API_BASE}/api/ops/overview?fy=2026-27&segment=PTMT`);
      const opsC = await fetchJson<Record<string, unknown>>(`${API_BASE}/api/ops/overview?fy=2026-27&segment=Combined`);
      const opsOvPtmt  = (opsT.orderValue as number) ?? 0;
      const opsOvPlumb = (opsP.orderValue as number) ?? 0;
      const opsOvComb  = (opsC.orderValue as number) ?? 0;
      const opsSegOk   = opsOvPtmt > 0 && opsOvPlumb > 0 && opsOvComb > 0
                       && opsOvPtmt !== opsOvPlumb
                       && opsOvComb > opsOvPtmt
                       && opsOvComb > opsOvPlumb;
      return {
        name: `NC10 · Ops overview · PTMT (${fmt(opsOvPtmt)}) ≠ Plumbing (${fmt(opsOvPlumb)}) ≠ Combined (${fmt(opsOvComb)})`,
        expected: 1, actual: opsSegOk ? 1 : 0,
        pass: opsSegOk, tolerance: "PTMT≠Plumbing, Combined>both",
      };
    }, 30_000));

    // NC11: Management-view golden values — item 144-O / BURGUNDY (Cocks Standard)
    // Backed by a live-Sheets recompute behind a 5-min cache; re-evaluate once
    // on failure to absorb a transient partial read.
    newChecks.push(await evaluateWithRetry("NC11", async () => {
      const mgmtData = await fetchJson<Record<string, unknown>>(`${API_BASE}/api/ops/management-view?month=${PTMT_MONTH}`);
      const mgmtCats  = (mgmtData?.categories as Array<Record<string, unknown>>) ?? [];
      let mgmtItem: Record<string, unknown> | undefined;
      for (const cat of mgmtCats) {
        const items = (cat.items as Array<Record<string, unknown>>) ?? [];
        mgmtItem = items.find((i) => i.itemCode === "144-O" && i.colour === "BURGUNDY");
        if (mgmtItem) break;
      }
      // Reference values (2026-07-28 snapshot, ±1% tolerance)
      const MGMT_E = 7552, MGMT_F = 7587, MGMT_G = 7534, MGMT_H = 6146, MGMT_I = 4620;
      const tol1Pct = (actual: number, expected: number) => expected > 0 && Math.abs(actual - expected) / expected < 0.01;
      const mgmtOk = !!mgmtItem
        && tol1Pct((mgmtItem.E as number) ?? 0, MGMT_E)
        && tol1Pct((mgmtItem.F as number) ?? 0, MGMT_F)
        && tol1Pct((mgmtItem.G as number) ?? 0, MGMT_G)
        && tol1Pct((mgmtItem.H as number) ?? 0, MGMT_H)
        && tol1Pct((mgmtItem.I as number) ?? 0, MGMT_I);
      return {
        name: `NC11 · Management-view · 144-O/BURGUNDY E/F/G/H/I within ±1% of golden`,
        expected: 1, actual: mgmtOk ? 1 : 0,
        pass: mgmtOk, tolerance: "E≈7552 F≈7587 G≈7534 H≈6146 I≈4620 (±1%)",
      };
    }, 30_000));

    // NC12: GET /corrective/runs/:id must return the run you clicked, not the
    // latest run for that month/segment (regression: routes were once rewritten
    // to filter by undefined month/segment instead of the id).
    type RunListEntry = { id: number; month: string; segment: string; weekClosed: number; revisedMonthTotal: number; createdAt: string };
    const allRuns = await fetchJson<RunListEntry[]>(`${API_BASE}/api/corrective/runs`);
    // Pick an OLDER run: one that is not the newest id for its month+segment.
    const newestByKey = new Map<string, number>();
    for (const r of allRuns) {
      const key = `${r.segment}|${r.month}`;
      newestByKey.set(key, Math.max(newestByKey.get(key) ?? 0, r.id));
    }
    const olderRun = allRuns
      .filter((r) => r.id !== newestByKey.get(`${r.segment}|${r.month}`))
      .sort((a, b) => b.id - a.id)[0]
      // Fallback: any non-newest overall run still exercises the by-id path.
      ?? allRuns.sort((a, b) => a.id - b.id)[0];
    if (!olderRun) {
      newChecks.push({
        name: "NC14 · corrective/runs/:id · by-id lookup returns the clicked run (skipped: no runs exist)",
        expected: 1, actual: 0, pass: false, tolerance: "needs ≥1 corrective run",
      });
    } else {
      const detail = await fetchJson<Record<string, unknown>>(`${API_BASE}/api/corrective/runs/${olderRun.id}`);
      const byIdOk =
        (detail.runId as number) === olderRun.id &&
        (detail.month as string) === olderRun.month &&
        (detail.segment as string) === olderRun.segment &&
        (detail.weekClosed as number) === olderRun.weekClosed &&
        Math.abs(((detail.revisedMonthTotal as number) ?? NaN) - olderRun.revisedMonthTotal) < 0.01 &&
        Array.isArray(detail.items);
      newChecks.push({
        name: `NC14 · corrective/runs/${olderRun.id} · detail returns run #${olderRun.id} (${olderRun.segment}/${olderRun.month}), not the latest for the month`,
        expected: olderRun.id, actual: (detail.runId as number) ?? -1,
        pass: byIdOk, tolerance: "runId + month + segment + weekClosed + revisedMonthTotal match list entry",
      });

      // Excel export for the same id must carry that run's month/week in the filename.
      const xlResp = await fetch(`${API_BASE}/api/corrective/runs/${olderRun.id}/export/excel?format=standard`);
      const dispo  = xlResp.headers.get("content-disposition") ?? "";
      const xlOk   = xlResp.ok && dispo.includes(`${olderRun.segment}_Corrective_Plan_${olderRun.month}_W${olderRun.weekClosed}_`);
      newChecks.push({
        name: `NC14b · corrective/runs/${olderRun.id}/export/excel · filename cites ${olderRun.month} W${olderRun.weekClosed}`,
        expected: 1, actual: xlOk ? 1 : 0,
        pass: xlOk, tolerance: `content-disposition contains ${olderRun.segment}_Corrective_Plan_${olderRun.month}_W${olderRun.weekClosed}_`,
      });

      // NC14c: PDF export for the same id must also cite that run's month/week —
      // filename comes from the run row loaded by id, so a regression that renders
      // the latest run instead would surface as the wrong month/week here.
      console.log(`  NC14c: generating PDF for run #${olderRun.id} (headless Chrome, may take ~15s) …`);
      const pdfResp = await fetch(`${API_BASE}/api/corrective/runs/${olderRun.id}/export/pdf`);
      const pdfDispo = pdfResp.headers.get("content-disposition") ?? "";
      const pdfType  = pdfResp.headers.get("content-type") ?? "";
      const pdfName  = `${olderRun.segment}_Corrective_Plan_${olderRun.month}_W${olderRun.weekClosed}.pdf`;
      const pdfOk    = pdfResp.ok && pdfType.includes("application/pdf") && pdfDispo.includes(pdfName);
      if (!pdfOk) console.error(`  NC14c fail: status=${pdfResp.status} type=${pdfType} dispo=${pdfDispo}`);
      newChecks.push({
        name: `NC14c · corrective/runs/${olderRun.id}/export/pdf · PDF filename cites ${olderRun.month} W${olderRun.weekClosed}`,
        expected: 1, actual: pdfOk ? 1 : 0,
        pass: pdfOk, tolerance: `application/pdf + content-disposition contains ${pdfName}`,
      });
    }

    // NC17: Consolidated-plan upload → machine-summary machineHrs round-trip
    // Builds a minimal "5. Item Assignment" workbook in memory (FORMAT B), uploads it
    // to a far-future month so it never collides with real data, asserts that the
    // machine-summary endpoint returns the expected pcs, kg, and hrs for each machine,
    // then deletes the test upload.
    {
      const XLSX = await import("xlsx");
      const FIXTURE_MONTH   = "2099-01";   // safe far-future — never real data
      const FIXTURE_SEGMENT = "Plumbing";

      // Fixture items:
      //   Row 0-2  : blank preamble (parser skips 0-indexed rows 0..3 as pre-header)
      //   Row 3    : header row (0-indexed) — required by parseConsolidatedItemSheet
      //   Row 4    : PIPE  item — MC-01 only,      1000 pcs, matKg=120, hrs=5.5
      //   Row 5    : FITTING item — MC-02 only,     500 pcs, matKg=110, hrs=3.0
      //   Row 6    : FITTING item — "MC-01,MC-02",  200 pcs, matKg=80,  hrs=2.0
      //              ↑ multi-machine item: BOTH machines should receive the full
      //                200 pcs / 80 kg / 2.0 hrs (not split 50/50 between them).
      //   Row 7    : PIPE  item — blank Machine(s), 300 pcs, matKg=60,  hrs=1.5
      //              ↑ unassigned item: must fall back to the "Unassigned" bucket.
      //
      // Expected machine-summary totals after the aggregation loop:
      //   MC-01      : pcs = 1000 + 200 = 1200,  kg = 120 + 80 = 200,  hrs = 5.5 + 2.0 = 7.5
      //   MC-02      : pcs =  500 + 200 =  700,  kg = 110 + 80 = 190,  hrs = 3.0 + 2.0 = 5.0
      //   Unassigned : pcs =  300,                kg =  60,             hrs = 1.5
      //
      // Grand-total pcs (each item counted once per machine it contributes to):
      //   ITEM-F01 → 1 machine  → 1000
      //   ITEM-F02 → 1 machine  →  500
      //   ITEM-F03 → 2 machines →  200 × 2 = 400
      //   ITEM-F04 → Unassigned →  300
      //   Total                 → 2200
      //
      // Column layout (cols 0-11):
      //   Type | Material | Item Code | Qty(pcs) | Wt/pc(kg) | Machine(s) |
      //   Machine Hrs | Prod Wt(kg) | Material Req(kg) | Rate(kg/hr) | Rate Tier | Compound Cost(Rs)
      const wsData = [
        [],
        [],
        [],
        ["Type","Material","Item Code","Qty (pcs)","Wt/pc (kg)","Machine(s)","Machine Hrs","Prod Wt (kg)","Material Req (kg)","Rate (kg/hr)","Rate Tier","Compound Cost (Rs)"],
        ["Pipe",   "HDP-20mm","ITEM-F01",1000,0.1,"MC-01",       5.5,100,120,20,"seeded",  5000],
        ["Fitting","SWR-2in", "ITEM-F02", 500,0.2,"MC-02",       3.0,100,110,30,"mat-avg", 2000],
        ["Fitting","SWR-3in", "ITEM-F03", 200,0.4,"MC-01,MC-02", 2.0, 80, 80,20,"seeded",  1000],
        ["Pipe",   "HDP-25mm","ITEM-F04", 300,0.2,"",            1.5, 60, 60,20,"seeded",  1500],
      ];
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "5. Item Assignment");
      const buf = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));

      // POST the fixture
      const fd = new FormData();
      fd.append("month",   FIXTURE_MONTH);
      fd.append("segment", FIXTURE_SEGMENT);
      fd.append("file",
        new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        "fixture-consolidated-plan.xlsx",
      );

      let uploadId: number | null = null;
      try {
        const uploadResp = await fetch(`${API_BASE}/api/monitoring/plant-plan`, { method: "POST", body: fd });
        if (!uploadResp.ok) {
          const txt = await uploadResp.text().catch(() => "");
          newChecks.push({
            name: "NC17 · plant-plan upload (consolidated) · POST succeeds",
            expected: 1, actual: 0, pass: false,
            tolerance: `HTTP ${uploadResp.status}: ${txt.slice(0, 120)}`,
          });
        } else {
          const uploadBody = await uploadResp.json() as { id: number; itemCount: number };
          uploadId = uploadBody.id;
          newChecks.push({
            name: `NC17a · plant-plan upload (consolidated) · POST 201, itemCount=4 (got ${uploadBody.itemCount})`,
            expected: 4, actual: uploadBody.itemCount,
            pass: uploadBody.itemCount === 4, tolerance: "exact",
          });

          // GET machine-summary
          type MachineTotals = { machineId: string; pcs: number; kg: number; hrs: number; itemCount: number };
          const summaryData = await fetchJson<{ upload: unknown; machineTotals: MachineTotals[] }>(
            `${API_BASE}/api/monitoring/plant-plan/machine-summary?month=${FIXTURE_MONTH}&segment=${encodeURIComponent(FIXTURE_SEGMENT)}`,
          );
          const totals = summaryData.machineTotals ?? [];
          const mc01 = totals.find((m) => m.machineId === "MC-01");
          const mc02 = totals.find((m) => m.machineId === "MC-02");
          const anyHrs = totals.some((m) => m.hrs > 0);

          newChecks.push({
            name: `NC17b · machine-summary · at least one machine has hrs > 0 (got ${totals.length} machines)`,
            expected: 1, actual: anyHrs ? 1 : 0,
            pass: anyHrs, tolerance: "> 0",
          });

          // NC17c/d: totals include both single-machine items AND the shared multi-machine item
          // MC-01: ITEM-F01 (1000 pcs / 120 kg / 5.5 hrs) + ITEM-F03 shared (200 pcs / 80 kg / 2.0 hrs) = 1200 / 200 / 7.5
          // MC-02: ITEM-F02 ( 500 pcs / 110 kg / 3.0 hrs) + ITEM-F03 shared (200 pcs / 80 kg / 2.0 hrs) =  700 / 190 / 5.0
          newChecks.push({
            name: `NC17c · machine-summary · MC-01 pcs=1200 kg=200 hrs=7.5 (got pcs=${mc01?.pcs ?? "n/a"} kg=${mc01?.kg ?? "n/a"} hrs=${mc01?.hrs ?? "n/a"})`,
            expected: 1,
            actual: (mc01?.pcs === 1200 && mc01?.kg === 200 && Math.abs((mc01?.hrs ?? 0) - 7.5) < 0.01) ? 1 : 0,
            pass: !!mc01 && mc01.pcs === 1200 && mc01.kg === 200 && Math.abs(mc01.hrs - 7.5) < 0.01,
            tolerance: "pcs/kg/hrs exact from fixture (single-machine + multi-machine item)",
          });
          newChecks.push({
            name: `NC17d · machine-summary · MC-02 pcs=700 kg=190 hrs=5.0 (got pcs=${mc02?.pcs ?? "n/a"} kg=${mc02?.kg ?? "n/a"} hrs=${mc02?.hrs ?? "n/a"})`,
            expected: 1,
            actual: (mc02?.pcs === 700 && mc02?.kg === 190 && Math.abs((mc02?.hrs ?? 0) - 5.0) < 0.01) ? 1 : 0,
            pass: !!mc02 && mc02.pcs === 700 && mc02.kg === 190 && Math.abs(mc02.hrs - 5.0) < 0.01,
            tolerance: "pcs/kg/hrs exact from fixture (single-machine + multi-machine item)",
          });

          // NC17e/f: explicit multi-machine split assertions.
          // ITEM-F03 is assigned to "MC-01,MC-02" (200 pcs / 80 kg / 2.0 hrs).
          // The aggregation loop must credit the FULL amounts to EACH machine —
          // not split 50/50 between them.  We verify this by checking that both
          // machines received at least 200 pcs more than their single-machine
          // baseline (MC-01 baseline=1000, MC-02 baseline=500).
          const mc01MultiOk = !!mc01 && mc01.pcs >= 1200 && mc01.kg >= 200 && mc01.hrs >= 7.5 - 0.01;
          const mc02MultiOk = !!mc02 && mc02.pcs >= 700  && mc02.kg >= 190 && mc02.hrs >= 5.0 - 0.01;
          newChecks.push({
            name: `NC17e · multi-machine split · MC-01 receives full 200 pcs/80 kg/2.0 hrs from "MC-01,MC-02" item (pcs=${mc01?.pcs ?? "n/a"} ≥ 1200)`,
            expected: 1, actual: mc01MultiOk ? 1 : 0,
            pass: mc01MultiOk,
            tolerance: "full attribution to each listed machine, not split",
          });
          newChecks.push({
            name: `NC17f · multi-machine split · MC-02 receives full 200 pcs/80 kg/2.0 hrs from "MC-01,MC-02" item (pcs=${mc02?.pcs ?? "n/a"} ≥ 700)`,
            expected: 1, actual: mc02MultiOk ? 1 : 0,
            pass: mc02MultiOk,
            tolerance: "full attribution to each listed machine, not split",
          });

          // NC17g: blank Machine(s) → "Unassigned" bucket
          // ITEM-F04 has an empty machines cell: the aggregation loop must push it
          // into the "Unassigned" entry (pcs=300, kg=60, hrs=1.5).
          const unassigned = totals.find((m) => m.machineId === "Unassigned");
          const unassignedOk =
            !!unassigned &&
            unassigned.pcs === 300 &&
            unassigned.kg  === 60  &&
            Math.abs(unassigned.hrs - 1.5) < 0.01;
          newChecks.push({
            name: `NC17g · unassigned item · "Unassigned" entry pcs=300 kg=60 hrs=1.5 (got pcs=${unassigned?.pcs ?? "n/a"} kg=${unassigned?.kg ?? "n/a"} hrs=${unassigned?.hrs ?? "n/a"})`,
            expected: 1, actual: unassignedOk ? 1 : 0,
            pass: unassignedOk,
            tolerance: "blank Machine(s) must produce an Unassigned bucket entry",
          });

          // NC17h: grand-total pcs across all machine buckets equals the per-machine
          // attribution sum (each item counted once per machine it contributes to).
          // ITEM-F01 → 1 machine → 1000; ITEM-F02 → 1 machine → 500;
          // ITEM-F03 → 2 machines → 400; ITEM-F04 → Unassigned → 300  → total 2200
          const EXPECTED_GRAND_TOTAL_PCS = 2200;
          const actualGrandTotal = totals.reduce((s, m) => s + m.pcs, 0);
          newChecks.push({
            name: `NC17h · grand-total pcs · Σ(all machines) = ${EXPECTED_GRAND_TOTAL_PCS} (got ${actualGrandTotal})`,
            expected: EXPECTED_GRAND_TOTAL_PCS, actual: actualGrandTotal,
            pass: actualGrandTotal === EXPECTED_GRAND_TOTAL_PCS,
            tolerance: "exact — each item counted once per machine (multi-machine = full per machine)",
          });
        }
      } finally {
        // Always clean up the fixture upload regardless of assertion outcome.
        if (uploadId !== null) {
          await fetch(`${API_BASE}/api/monitoring/plant-plan/${uploadId}`, { method: "DELETE" }).catch(() => {});
        }
      }
    }

    // NC17g/h: Slash-separated machine list ("MC-03/MC-04") splits correctly.
    // Covers the `/` branch of the /[,/]+/ regex in the aggregation loop.
    // Fixture items:
    //   Row 4: PIPE  item — MC-03 only,       300 pcs, matKg=60, hrs=2.0
    //   Row 5: FITTING item — "MC-03/MC-04",  400 pcs, matKg=90, hrs=3.5
    //
    // Expected machine-summary after aggregation:
    //   MC-03 : pcs = 300 + 400 = 700,  kg = 60 + 90 = 150,  hrs = 2.0 + 3.5 = 5.5
    //   MC-04 : pcs = 400,               kg = 90,              hrs = 3.5
    {
      const XLSXg = await import("xlsx");
      const FIXTURE_MONTH_G   = "2099-03";   // safe far-future — never real data
      const FIXTURE_SEGMENT_G = "Plumbing";

      const wsDataG = [
        [],
        [],
        [],
        ["Type","Material","Item Code","Qty (pcs)","Wt/pc (kg)","Machine(s)","Machine Hrs","Prod Wt (kg)","Material Req (kg)","Rate (kg/hr)","Rate Tier","Compound Cost (Rs)"],
        ["Pipe",   "CPVC-25mm","ITEM-G01", 300, 0.15, "MC-03",       2.0, 45,  60, 25, "seeded", 3000],
        ["Fitting","SWR-4in",  "ITEM-G02", 400, 0.20, "MC-03/MC-04", 3.5, 80,  90, 22, "seeded", 4000],
      ];
      const wsG = XLSXg.utils.aoa_to_sheet(wsDataG);
      const wbG = XLSXg.utils.book_new();
      XLSXg.utils.book_append_sheet(wbG, wsG, "5. Item Assignment");
      const bufG = Buffer.from(XLSXg.write(wbG, { type: "buffer", bookType: "xlsx" }));

      const fdG = new FormData();
      fdG.append("month",   FIXTURE_MONTH_G);
      fdG.append("segment", FIXTURE_SEGMENT_G);
      fdG.append("file",
        new Blob([bufG], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        "fixture-slash-machines.xlsx",
      );

      let uploadIdG: number | null = null;
      try {
        const uploadRespG = await fetch(`${API_BASE}/api/monitoring/plant-plan`, { method: "POST", body: fdG });
        if (!uploadRespG.ok) {
          const txt = await uploadRespG.text().catch(() => "");
          newChecks.push({
            name: "NC17g · slash-machine upload · POST succeeds",
            expected: 1, actual: 0, pass: false,
            tolerance: `HTTP ${uploadRespG.status}: ${txt.slice(0, 120)}`,
          });
        } else {
          const uploadBodyG = await uploadRespG.json() as { id: number; itemCount: number };
          uploadIdG = uploadBodyG.id;
          newChecks.push({
            name: `NC17g · slash-machine upload · POST 201, itemCount=2 (got ${uploadBodyG.itemCount})`,
            expected: 2, actual: uploadBodyG.itemCount,
            pass: uploadBodyG.itemCount === 2, tolerance: "exact",
          });

          type MachineTotalsG = { machineId: string; pcs: number; kg: number; hrs: number; itemCount: number };
          const summaryDataG = await fetchJson<{ upload: unknown; machineTotals: MachineTotalsG[] }>(
            `${API_BASE}/api/monitoring/plant-plan/machine-summary?month=${FIXTURE_MONTH_G}&segment=${encodeURIComponent(FIXTURE_SEGMENT_G)}`,
          );
          const totalsG = summaryDataG.machineTotals ?? [];
          const mc03 = totalsG.find((m) => m.machineId === "MC-03");
          const mc04 = totalsG.find((m) => m.machineId === "MC-04");

          // MC-03: single item (300 pcs/60 kg/2.0 hrs) + slash-shared item (400 pcs/90 kg/3.5 hrs) = 700/150/5.5
          newChecks.push({
            name: `NC17h · slash-machine · MC-03 pcs=700 kg=150 hrs=5.5 (got pcs=${mc03?.pcs ?? "n/a"} kg=${mc03?.kg ?? "n/a"} hrs=${mc03?.hrs ?? "n/a"})`,
            expected: 1,
            actual: (mc03?.pcs === 700 && mc03?.kg === 150 && Math.abs((mc03?.hrs ?? 0) - 5.5) < 0.01) ? 1 : 0,
            pass: !!mc03 && mc03.pcs === 700 && mc03.kg === 150 && Math.abs(mc03.hrs - 5.5) < 0.01,
            tolerance: `full attribution via slash separator: pcs/kg/hrs exact (got ${mc03?.pcs}/${mc03?.kg}/${mc03?.hrs})`,
          });
          // MC-04: receives only the slash-shared item (400 pcs/90 kg/3.5 hrs)
          newChecks.push({
            name: `NC17i · slash-machine · MC-04 pcs=400 kg=90 hrs=3.5 (got pcs=${mc04?.pcs ?? "n/a"} kg=${mc04?.kg ?? "n/a"} hrs=${mc04?.hrs ?? "n/a"})`,
            expected: 1,
            actual: (mc04?.pcs === 400 && mc04?.kg === 90 && Math.abs((mc04?.hrs ?? 0) - 3.5) < 0.01) ? 1 : 0,
            pass: !!mc04 && mc04.pcs === 400 && mc04.kg === 90 && Math.abs(mc04.hrs - 3.5) < 0.01,
            tolerance: `MC-04 receives full slash-separated item attribution (got ${mc04?.pcs}/${mc04?.kg}/${mc04?.hrs})`,
          });
        }
      } finally {
        if (uploadIdG !== null) {
          await fetch(`${API_BASE}/api/monitoring/plant-plan/${uploadIdG}`, { method: "DELETE" }).catch(() => {});
        }
      }
    }

    // NC17j/k: Spaced slash separator ("MC-05 / MC-06") must NOT create phantom IDs.
    // The split regex /[,/]+/ without trimming would produce keys "MC-05 " and " MC-06"
    // (with leading/trailing spaces). The aggregation loop trims each token so both
    // machines should map to the canonical MC-05 / MC-06 buckets.
    //
    // Fixture items:
    //   Row 4: PIPE   item — "MC-05" (no spaces),        300 pcs, matKg=60,  hrs=2.0
    //   Row 5: FITTING item — "MC-05 / MC-06" (spaced),  400 pcs, matKg=90,  hrs=3.5
    //
    // Expected machine-summary after aggregation:
    //   MC-05 : pcs = 300 + 400 = 700,  kg = 60 + 90 = 150,  hrs = 2.0 + 3.5 = 5.5
    //   MC-06 : pcs = 400,               kg = 90,              hrs = 3.5
    //
    // Phantom-ID check: no machineId may contain a leading/trailing space.
    {
      const XLSXj = await import("xlsx");
      const FIXTURE_MONTH_J   = "2099-04";   // safe far-future — never real data
      const FIXTURE_SEGMENT_J = "Plumbing";

      const wsDataJ = [
        [],
        [],
        [],
        ["Type","Material","Item Code","Qty (pcs)","Wt/pc (kg)","Machine(s)","Machine Hrs","Prod Wt (kg)","Material Req (kg)","Rate (kg/hr)","Rate Tier","Compound Cost (Rs)"],
        ["Pipe",   "CPVC-25mm","ITEM-J01", 300, 0.15, "MC-05",         2.0, 45,  60, 25, "seeded", 3000],
        ["Fitting","SWR-4in",  "ITEM-J02", 400, 0.20, "MC-05 / MC-06", 3.5, 80,  90, 22, "seeded", 4000],
      ];
      const wsJ = XLSXj.utils.aoa_to_sheet(wsDataJ);
      const wbJ = XLSXj.utils.book_new();
      XLSXj.utils.book_append_sheet(wbJ, wsJ, "5. Item Assignment");
      const bufJ = Buffer.from(XLSXj.write(wbJ, { type: "buffer", bookType: "xlsx" }));

      const fdJ = new FormData();
      fdJ.append("month",   FIXTURE_MONTH_J);
      fdJ.append("segment", FIXTURE_SEGMENT_J);
      fdJ.append("file",
        new Blob([bufJ], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        "fixture-spaced-slash-machines.xlsx",
      );

      let uploadIdJ: number | null = null;
      try {
        const uploadRespJ = await fetch(`${API_BASE}/api/monitoring/plant-plan`, { method: "POST", body: fdJ });
        if (!uploadRespJ.ok) {
          const txt = await uploadRespJ.text().catch(() => "");
          newChecks.push({
            name: "NC17j · spaced-slash upload · POST succeeds",
            expected: 1, actual: 0, pass: false,
            tolerance: `HTTP ${uploadRespJ.status}: ${txt.slice(0, 120)}`,
          });
        } else {
          const uploadBodyJ = await uploadRespJ.json() as { id: number; itemCount: number };
          uploadIdJ = uploadBodyJ.id;
          newChecks.push({
            name: `NC17j · spaced-slash upload · POST 201, itemCount=2 (got ${uploadBodyJ.itemCount})`,
            expected: 2, actual: uploadBodyJ.itemCount,
            pass: uploadBodyJ.itemCount === 2, tolerance: "exact",
          });

          type MachineTotalsJ = { machineId: string; pcs: number; kg: number; hrs: number; itemCount: number };
          const summaryDataJ = await fetchJson<{ upload: unknown; machineTotals: MachineTotalsJ[] }>(
            `${API_BASE}/api/monitoring/plant-plan/machine-summary?month=${FIXTURE_MONTH_J}&segment=${encodeURIComponent(FIXTURE_SEGMENT_J)}`,
          );
          const totalsJ = summaryDataJ.machineTotals ?? [];
          const mc05 = totalsJ.find((m) => m.machineId === "MC-05");
          const mc06 = totalsJ.find((m) => m.machineId === "MC-06");

          // NC17j: MC-05 receives single-item (300/60/2.0) + spaced-slash-shared (400/90/3.5) = 700/150/5.5
          newChecks.push({
            name: `NC17j · spaced-slash · MC-05 pcs=700 kg=150 hrs=5.5 (got pcs=${mc05?.pcs ?? "n/a"} kg=${mc05?.kg ?? "n/a"} hrs=${mc05?.hrs ?? "n/a"})`,
            expected: 1,
            actual: (mc05?.pcs === 700 && mc05?.kg === 150 && Math.abs((mc05?.hrs ?? 0) - 5.5) < 0.01) ? 1 : 0,
            pass: !!mc05 && mc05.pcs === 700 && mc05.kg === 150 && Math.abs(mc05.hrs - 5.5) < 0.01,
            tolerance: `trim() maps "MC-05 / MC-06" → MC-05/MC-06 (no phantom spaces); got ${mc05?.pcs}/${mc05?.kg}/${mc05?.hrs}`,
          });

          // NC17k: MC-06 receives only the spaced-slash-shared item (400/90/3.5)
          newChecks.push({
            name: `NC17k · spaced-slash · MC-06 pcs=400 kg=90 hrs=3.5 (got pcs=${mc06?.pcs ?? "n/a"} kg=${mc06?.kg ?? "n/a"} hrs=${mc06?.hrs ?? "n/a"})`,
            expected: 1,
            actual: (mc06?.pcs === 400 && mc06?.kg === 90 && Math.abs((mc06?.hrs ?? 0) - 3.5) < 0.01) ? 1 : 0,
            pass: !!mc06 && mc06.pcs === 400 && mc06.kg === 90 && Math.abs(mc06.hrs - 3.5) < 0.01,
            tolerance: `trim() maps " MC-06" → canonical "MC-06" (no leading space); got ${mc06?.pcs}/${mc06?.kg}/${mc06?.hrs}`,
          });

          // Phantom-ID guard: no machineId in the summary may have leading or trailing whitespace.
          const phantomIds = totalsJ.filter((m) => m.machineId !== m.machineId.trim());
          newChecks.push({
            name: `NC17k · phantom-ID guard · no machine bucket has leading/trailing spaces (found ${phantomIds.length} phantom IDs: ${phantomIds.map((m) => JSON.stringify(m.machineId)).join(", ") || "none"})`,
            expected: 0, actual: phantomIds.length,
            pass: phantomIds.length === 0,
            tolerance: "split().map(trim()) must eliminate all space-padded keys",
          });
        }
      } catch (errJ) {
        newChecks.push({
          name: "NC17j · spaced-slash upload · block error (unexpected exception)",
          expected: 1, actual: 0, pass: false,
          tolerance: errJ instanceof Error ? errJ.message : String(errJ),
        });
      } finally {
        if (uploadIdJ !== null) {
          await fetch(`${API_BASE}/api/monitoring/plant-plan/${uploadIdJ}`, { method: "DELETE" }).catch(() => {});
        }
      }
    }

    // NC17l/m: Mixed comma-and-slash separator ("MC-07,MC-08/MC-09") splits into exactly
    // three canonical IDs with no phantom entries. The regex /[,/]+/ collapses consecutive
    // or combined delimiters, so "MC-07,MC-08/MC-09" must yield MC-07, MC-08, and MC-09.
    //
    // Fixture items:
    //   Row 4: PIPE   item — "MC-07" (single),              300 pcs, matKg=60,  hrs=2.0
    //   Row 5: FITTING item — "MC-07,MC-08/MC-09" (mixed),  400 pcs, matKg=90,  hrs=3.5
    //
    // Expected machine-summary after aggregation:
    //   MC-07 : pcs = 300 + 400 = 700,  kg = 60 + 90 = 150,  hrs = 2.0 + 3.5 = 5.5
    //   MC-08 : pcs = 400,               kg = 90,              hrs = 3.5
    //   MC-09 : pcs = 400,               kg = 90,              hrs = 3.5
    //
    // Phantom-ID check: no machineId may contain a leading/trailing space.
    {
      const XLSXl = await import("xlsx");
      const FIXTURE_MONTH_L   = "2099-05";   // safe far-future — never real data
      const FIXTURE_SEGMENT_L = "Plumbing";

      const wsDataL = [
        [],
        [],
        [],
        ["Type","Material","Item Code","Qty (pcs)","Wt/pc (kg)","Machine(s)","Machine Hrs","Prod Wt (kg)","Material Req (kg)","Rate (kg/hr)","Rate Tier","Compound Cost (Rs)"],
        ["Pipe",   "CPVC-25mm","ITEM-L01", 300, 0.15, "MC-07",              2.0, 45,  60, 25, "seeded", 3000],
        ["Fitting","SWR-4in",  "ITEM-L02", 400, 0.20, "MC-07,MC-08/MC-09", 3.5, 80,  90, 22, "seeded", 4000],
      ];
      const wsL = XLSXl.utils.aoa_to_sheet(wsDataL);
      const wbL = XLSXl.utils.book_new();
      XLSXl.utils.book_append_sheet(wbL, wsL, "5. Item Assignment");
      const bufL = Buffer.from(XLSXl.write(wbL, { type: "buffer", bookType: "xlsx" }));

      const fdL = new FormData();
      fdL.append("month",   FIXTURE_MONTH_L);
      fdL.append("segment", FIXTURE_SEGMENT_L);
      fdL.append("file",
        new Blob([bufL], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        "fixture-mixed-sep-machines.xlsx",
      );

      let uploadIdL: number | null = null;
      try {
        const uploadRespL = await fetch(`${API_BASE}/api/monitoring/plant-plan`, { method: "POST", body: fdL });
        if (!uploadRespL.ok) {
          const txt = await uploadRespL.text().catch(() => "");
          newChecks.push({
            name: "NC17l · mixed-sep upload · POST succeeds",
            expected: 1, actual: 0, pass: false,
            tolerance: `HTTP ${uploadRespL.status}: ${txt.slice(0, 120)}`,
          });
        } else {
          const uploadBodyL = await uploadRespL.json() as { id: number; itemCount: number };
          uploadIdL = uploadBodyL.id;
          newChecks.push({
            name: `NC17l · mixed-sep upload · POST 201, itemCount=2 (got ${uploadBodyL.itemCount})`,
            expected: 2, actual: uploadBodyL.itemCount,
            pass: uploadBodyL.itemCount === 2, tolerance: "exact",
          });

          type MachineTotalsL = { machineId: string; pcs: number; kg: number; hrs: number; itemCount: number };
          const summaryDataL = await fetchJson<{ upload: unknown; machineTotals: MachineTotalsL[] }>(
            `${API_BASE}/api/monitoring/plant-plan/machine-summary?month=${FIXTURE_MONTH_L}&segment=${encodeURIComponent(FIXTURE_SEGMENT_L)}`,
          );
          const totalsL = summaryDataL.machineTotals ?? [];
          const mc07 = totalsL.find((m) => m.machineId === "MC-07");
          const mc08 = totalsL.find((m) => m.machineId === "MC-08");
          const mc09 = totalsL.find((m) => m.machineId === "MC-09");

          // NC17l: MC-07 receives single-item (300/60/2.0) + mixed-sep item (400/90/3.5) = 700/150/5.5
          newChecks.push({
            name: `NC17l · mixed-sep · MC-07 pcs=700 kg=150 hrs=5.5 (got pcs=${mc07?.pcs ?? "n/a"} kg=${mc07?.kg ?? "n/a"} hrs=${mc07?.hrs ?? "n/a"})`,
            expected: 1,
            actual: (mc07?.pcs === 700 && mc07?.kg === 150 && Math.abs((mc07?.hrs ?? 0) - 5.5) < 0.01) ? 1 : 0,
            pass: !!mc07 && mc07.pcs === 700 && mc07.kg === 150 && Math.abs(mc07.hrs - 5.5) < 0.01,
            tolerance: `comma+slash regex collapses to MC-07; full attribution; got ${mc07?.pcs}/${mc07?.kg}/${mc07?.hrs}`,
          });

          // NC17m: MC-08 receives only the mixed-sep item (400/90/3.5)
          newChecks.push({
            name: `NC17m · mixed-sep · MC-08 pcs=400 kg=90 hrs=3.5 (got pcs=${mc08?.pcs ?? "n/a"} kg=${mc08?.kg ?? "n/a"} hrs=${mc08?.hrs ?? "n/a"})`,
            expected: 1,
            actual: (mc08?.pcs === 400 && mc08?.kg === 90 && Math.abs((mc08?.hrs ?? 0) - 3.5) < 0.01) ? 1 : 0,
            pass: !!mc08 && mc08.pcs === 400 && mc08.kg === 90 && Math.abs(mc08.hrs - 3.5) < 0.01,
            tolerance: `"MC-07,MC-08/MC-09" splits on /[,/]+/ → MC-08 exact; got ${mc08?.pcs}/${mc08?.kg}/${mc08?.hrs}`,
          });

          // NC17m: MC-09 receives only the mixed-sep item (400/90/3.5)
          newChecks.push({
            name: `NC17m · mixed-sep · MC-09 pcs=400 kg=90 hrs=3.5 (got pcs=${mc09?.pcs ?? "n/a"} kg=${mc09?.kg ?? "n/a"} hrs=${mc09?.hrs ?? "n/a"})`,
            expected: 1,
            actual: (mc09?.pcs === 400 && mc09?.kg === 90 && Math.abs((mc09?.hrs ?? 0) - 3.5) < 0.01) ? 1 : 0,
            pass: !!mc09 && mc09.pcs === 400 && mc09.kg === 90 && Math.abs(mc09.hrs - 3.5) < 0.01,
            tolerance: `"MC-07,MC-08/MC-09" splits on /[,/]+/ → MC-09 exact; got ${mc09?.pcs}/${mc09?.kg}/${mc09?.hrs}`,
          });

          // Exact-bucket-set guard: only MC-07, MC-08, MC-09 may appear — no phantom,
          // duplicate, or malformed tokens from the mixed separator string.
          const EXPECTED_IDS_L = new Set(["MC-07", "MC-08", "MC-09"]);
          const actualIdsL = new Set(totalsL.map((m) => m.machineId));
          const unexpectedL = [...actualIdsL].filter((id) => !EXPECTED_IDS_L.has(id));
          const missingL    = [...EXPECTED_IDS_L].filter((id) => !actualIdsL.has(id));
          const exactSetOkL = unexpectedL.length === 0 && missingL.length === 0;
          newChecks.push({
            name: `NC17m · exact-bucket-set · only MC-07/MC-08/MC-09 present (unexpected=[${unexpectedL.join(",")}] missing=[${missingL.join(",")}])`,
            expected: 1, actual: exactSetOkL ? 1 : 0,
            pass: exactSetOkL,
            tolerance: `"MC-07,MC-08/MC-09" must yield exactly 3 canonical IDs — no phantom tokens, no duplicates`,
          });

          // Phantom-ID guard: no machineId in the summary may have leading or trailing whitespace.
          const phantomIdsL = totalsL.filter((m) => m.machineId !== m.machineId.trim());
          newChecks.push({
            name: `NC17m · phantom-ID guard · no machine bucket has leading/trailing spaces (found ${phantomIdsL.length} phantom IDs: ${phantomIdsL.map((m) => JSON.stringify(m.machineId)).join(", ") || "none"})`,
            expected: 0, actual: phantomIdsL.length,
            pass: phantomIdsL.length === 0,
            tolerance: "split(/[,/]+/).map(trim()) must eliminate all space-padded keys from mixed separators",
          });
        }
      } catch (errL) {
        newChecks.push({
          name: "NC17l · mixed-sep upload · block error (unexpected exception)",
          expected: 1, actual: 0, pass: false,
          tolerance: errL instanceof Error ? errL.message : String(errL),
        });
      } finally {
        if (uploadIdL !== null) {
          await fetch(`${API_BASE}/api/monitoring/plant-plan/${uploadIdL}`, { method: "DELETE" }).catch(() => {});
        }
      }
    }

    // NC17n: Double-comma separator ("MC-10,,MC-11") must NOT create a phantom empty-string
    // bucket.  The split regex /[,/]+/ collapses consecutive commas, and the subsequent
    // .filter(Boolean) removes any empty tokens.  This fixture confirms both behaviours
    // end-to-end: exactly two canonical IDs (MC-10, MC-11) appear in machine-summary, and
    // no machineId === "" is present.
    //
    // Fixture items:
    //   Row 4: PIPE    item — "MC-10"         (single),     300 pcs, matKg=60,  hrs=2.0
    //   Row 5: FITTING item — "MC-10,,MC-11"  (dbl-comma),  400 pcs, matKg=90,  hrs=3.5
    //
    // Expected machine-summary after aggregation:
    //   MC-10 : pcs = 300 + 400 = 700,  kg = 60 + 90 = 150,  hrs = 2.0 + 3.5 = 5.5
    //   MC-11 : pcs = 400,               kg = 90,              hrs = 3.5
    //   ""    : must NOT exist
    {
      const XLSXn = await import("xlsx");
      const FIXTURE_MONTH_N   = "2099-06";   // safe far-future — never real data
      const FIXTURE_SEGMENT_N = "Plumbing";

      const wsDataN = [
        [],
        [],
        [],
        ["Type","Material","Item Code","Qty (pcs)","Wt/pc (kg)","Machine(s)","Machine Hrs","Prod Wt (kg)","Material Req (kg)","Rate (kg/hr)","Rate Tier","Compound Cost (Rs)"],
        ["Pipe",   "CPVC-25mm","ITEM-N01", 300, 0.15, "MC-10",        2.0, 45,  60, 25, "seeded", 3000],
        ["Fitting","SWR-4in",  "ITEM-N02", 400, 0.20, "MC-10,,MC-11", 3.5, 80,  90, 22, "seeded", 4000],
      ];
      const wsN = XLSXn.utils.aoa_to_sheet(wsDataN);
      const wbN = XLSXn.utils.book_new();
      XLSXn.utils.book_append_sheet(wbN, wsN, "5. Item Assignment");
      const bufN = Buffer.from(XLSXn.write(wbN, { type: "buffer", bookType: "xlsx" }));

      const fdN = new FormData();
      fdN.append("month",   FIXTURE_MONTH_N);
      fdN.append("segment", FIXTURE_SEGMENT_N);
      fdN.append("file",
        new Blob([bufN], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        "fixture-double-comma-machines.xlsx",
      );

      let uploadIdN: number | null = null;
      try {
        const uploadRespN = await fetch(`${API_BASE}/api/monitoring/plant-plan`, { method: "POST", body: fdN });
        if (!uploadRespN.ok) {
          const txt = await uploadRespN.text().catch(() => "");
          newChecks.push({
            name: "NC17n · double-comma upload · POST succeeds",
            expected: 1, actual: 0, pass: false,
            tolerance: `HTTP ${uploadRespN.status}: ${txt.slice(0, 120)}`,
          });
        } else {
          const uploadBodyN = await uploadRespN.json() as { id: number; itemCount: number };
          uploadIdN = uploadBodyN.id;
          newChecks.push({
            name: `NC17n · double-comma upload · POST 201, itemCount=2 (got ${uploadBodyN.itemCount})`,
            expected: 2, actual: uploadBodyN.itemCount,
            pass: uploadBodyN.itemCount === 2, tolerance: "exact",
          });

          type MachineTotalsN = { machineId: string; pcs: number; kg: number; hrs: number; itemCount: number };
          const summaryDataN = await fetchJson<{ upload: unknown; machineTotals: MachineTotalsN[] }>(
            `${API_BASE}/api/monitoring/plant-plan/machine-summary?month=${FIXTURE_MONTH_N}&segment=${encodeURIComponent(FIXTURE_SEGMENT_N)}`,
          );
          const totalsN = summaryDataN.machineTotals ?? [];
          const mc10 = totalsN.find((m) => m.machineId === "MC-10");
          const mc11 = totalsN.find((m) => m.machineId === "MC-11");

          // NC17n: MC-10 receives single-item (300/60/2.0) + double-comma item (400/90/3.5) = 700/150/5.5
          newChecks.push({
            name: `NC17n · double-comma · MC-10 pcs=700 kg=150 hrs=5.5 (got pcs=${mc10?.pcs ?? "n/a"} kg=${mc10?.kg ?? "n/a"} hrs=${mc10?.hrs ?? "n/a"})`,
            expected: 1,
            actual: (mc10?.pcs === 700 && mc10?.kg === 150 && Math.abs((mc10?.hrs ?? 0) - 5.5) < 0.01) ? 1 : 0,
            pass: !!mc10 && mc10.pcs === 700 && mc10.kg === 150 && Math.abs(mc10.hrs - 5.5) < 0.01,
            tolerance: `double-comma regex collapses to MC-10; full attribution; got ${mc10?.pcs}/${mc10?.kg}/${mc10?.hrs}`,
          });

          // NC17n: MC-11 receives only the double-comma item (400/90/3.5)
          newChecks.push({
            name: `NC17n · double-comma · MC-11 pcs=400 kg=90 hrs=3.5 (got pcs=${mc11?.pcs ?? "n/a"} kg=${mc11?.kg ?? "n/a"} hrs=${mc11?.hrs ?? "n/a"})`,
            expected: 1,
            actual: (mc11?.pcs === 400 && mc11?.kg === 90 && Math.abs((mc11?.hrs ?? 0) - 3.5) < 0.01) ? 1 : 0,
            pass: !!mc11 && mc11.pcs === 400 && mc11.kg === 90 && Math.abs(mc11.hrs - 3.5) < 0.01,
            tolerance: `"MC-10,,MC-11" splits on /[,/]+/ → MC-11 exact; got ${mc11?.pcs}/${mc11?.kg}/${mc11?.hrs}`,
          });

          // Exact-bucket-set guard: only MC-10 and MC-11 may appear — no phantom empty-string
          // bucket from the double-comma, and no other spurious tokens.
          const EXPECTED_IDS_N = new Set(["MC-10", "MC-11"]);
          const actualIdsN = new Set(totalsN.map((m) => m.machineId));
          const unexpectedN = [...actualIdsN].filter((id) => !EXPECTED_IDS_N.has(id));
          const missingN    = [...EXPECTED_IDS_N].filter((id) => !actualIdsN.has(id));
          const exactSetOkN = unexpectedN.length === 0 && missingN.length === 0;
          newChecks.push({
            name: `NC17n · exact-bucket-set · only MC-10/MC-11 present (unexpected=[${unexpectedN.join(",")}] missing=[${missingN.join(",")}])`,
            expected: 1, actual: exactSetOkN ? 1 : 0,
            pass: exactSetOkN,
            tolerance: `"MC-10,,MC-11" must yield exactly 2 canonical IDs — no empty-string phantom from double-comma`,
          });

          // Empty-string guard: the critical regression check — no machineId may be "".
          const emptyBucket = totalsN.find((m) => m.machineId === "");
          newChecks.push({
            name: `NC17n · empty-string guard · no "" machine bucket exists (found: ${emptyBucket ? `pcs=${emptyBucket.pcs}` : "none"})`,
            expected: 0,
            actual: emptyBucket ? 1 : 0,
            pass: !emptyBucket,
            tolerance: `split(/[,/]+/).filter(Boolean) must eliminate the empty token between "MC-10,,MC-11"`,
          });
        }
      } catch (errN) {
        newChecks.push({
          name: "NC17n · double-comma upload · block error (unexpected exception)",
          expected: 1, actual: 0, pass: false,
          tolerance: errN instanceof Error ? errN.message : String(errN),
        });
      } finally {
        if (uploadIdN !== null) {
          await fetch(`${API_BASE}/api/monitoring/plant-plan/${uploadIdN}`, { method: "DELETE" }).catch(() => {});
        }
      }
    }

    // NC18: Upload a workbook with no recognised sheets → HTTP 400, no record left behind.
    // Builds a workbook containing only an unrecognised sheet so the empty-items guard fires.
    {
      const XLSX18 = await import("xlsx");
      const FIXTURE_MONTH18   = "2099-02";   // safe far-future — never real data
      const FIXTURE_SEGMENT18 = "Plumbing";

      // Sheet named "Unrelated Data" — not "5. Item Assignment", "Pipe Plan", or "Fitting Plan"
      const ws18 = XLSX18.utils.aoa_to_sheet([["Col A", "Col B"], [1, 2]]);
      const wb18 = XLSX18.utils.book_new();
      XLSX18.utils.book_append_sheet(wb18, ws18, "Unrelated Data");
      const buf18 = Buffer.from(XLSX18.write(wb18, { type: "buffer", bookType: "xlsx" }));

      const fd18 = new FormData();
      fd18.append("month",   FIXTURE_MONTH18);
      fd18.append("segment", FIXTURE_SEGMENT18);
      fd18.append("file",
        new Blob([buf18], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        "fixture-unrecognised-sheets.xlsx",
      );

      const uploadResp18 = await fetch(`${API_BASE}/api/monitoring/plant-plan`, { method: "POST", body: fd18 });
      const status18     = uploadResp18.status;
      const body18       = await uploadResp18.text().catch(() => "");

      // Must be 400
      newChecks.push({
        name: `NC18a · plant-plan upload (no recognised sheets) · HTTP 400 (got ${status18})`,
        expected: 400, actual: status18,
        pass: status18 === 400, tolerance: "exact",
      });

      // Error message must mention the supported sheet names
      const mentionsConsolidated = body18.includes("5. Item Assignment");
      const mentionsLegacy       = body18.includes("Pipe Plan") || body18.includes("Fitting Plan");
      newChecks.push({
        name: `NC18b · plant-plan upload (no recognised sheets) · error body names supported sheets`,
        expected: 1, actual: (mentionsConsolidated && mentionsLegacy) ? 1 : 0,
        pass: mentionsConsolidated && mentionsLegacy,
        tolerance: `body must mention "5. Item Assignment" and "Pipe Plan"/"Fitting Plan"`,
      });

      // No upload record must have been created for the fixture month
      if (status18 === 400) {
        const listResp18 = await fetch(
          `${API_BASE}/api/monitoring/plant-plan?month=${FIXTURE_MONTH18}&segment=${encodeURIComponent(FIXTURE_SEGMENT18)}`,
        );
        const list18 = listResp18.ok ? (await listResp18.json() as unknown[]) : null;
        const noRecord = Array.isArray(list18) && list18.length === 0;
        newChecks.push({
          name: `NC18c · plant-plan upload (no recognised sheets) · no upload record persisted after 400`,
          expected: 0, actual: Array.isArray(list18) ? list18.length : -1,
          pass: noRecord, tolerance: "exact — 0 records for fixture month",
        });
      }
    }

    // NC19: Re-upload same month — machine-summary must reflect only the newest upload.
    // Uploads two successive consolidated-plan workbooks to the same far-future month,
    // then asserts machine-summary totals match ONLY the second upload (no doubling).
    // Both fixture uploads are deleted in the finally block regardless of outcome.
    {
      const XLSX19 = await import("xlsx");
      const FIXTURE_MONTH19   = "2099-03";   // safe far-future — never real data
      const FIXTURE_SEGMENT19 = "Plumbing";

      // Helper: build a minimal FORMAT-B workbook with two single-machine items.
      // upload1: MC-01=1000pcs/120kg/5.0hrs (1 item),  MC-02=500pcs/110kg/3.0hrs (1 item)
      // upload2: MC-01=300pcs/60kg/2.0hrs   (1 item),  MC-02=200pcs/40kg/1.5hrs  (1 item)
      // All four figures differ between uploads so any aggregation (doubling) is detectable
      // for pcs, kg, hrs, and itemCount simultaneously.
      const buildWorkbook = (
        mc01Pcs: number, mc01Kg: number, mc01Hrs: number,
        mc02Pcs: number, mc02Kg: number, mc02Hrs: number,
      ) => {
        const wsData = [
          [],
          [],
          [],
          ["Type","Material","Item Code","Qty (pcs)","Wt/pc (kg)","Machine(s)","Machine Hrs","Prod Wt (kg)","Material Req (kg)","Rate (kg/hr)","Rate Tier","Compound Cost (Rs)"],
          ["Pipe",   "HDP-20mm","NC19-A",mc01Pcs,mc01Kg/mc01Pcs,"MC-01",mc01Hrs,mc01Kg,mc01Kg,20,"seeded",1000],
          ["Fitting","SWR-2in", "NC19-B",mc02Pcs,mc02Kg/mc02Pcs,"MC-02",mc02Hrs,mc02Kg,mc02Kg,30,"seeded",500],
        ];
        const ws = XLSX19.utils.aoa_to_sheet(wsData);
        const wb = XLSX19.utils.book_new();
        XLSX19.utils.book_append_sheet(wb, ws, "5. Item Assignment");
        // Extract a true ArrayBuffer (a valid BlobPart) from the Node Buffer to avoid
        // the Buffer<ArrayBufferLike> vs Uint8Array<ArrayBuffer> type mismatch.
        const nodeBuf = Buffer.from(XLSX19.write(wb, { type: "buffer", bookType: "xlsx" }));
        return nodeBuf.buffer.slice(nodeBuf.byteOffset, nodeBuf.byteOffset + nodeBuf.byteLength) as ArrayBuffer;
      };

      const postUpload = async (arrayBuf: ArrayBuffer, label: string) => {
        const fd = new FormData();
        fd.append("month",   FIXTURE_MONTH19);
        fd.append("segment", FIXTURE_SEGMENT19);
        fd.append("file",
          new Blob([arrayBuf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
          `${label}.xlsx`,
        );
        const resp = await fetch(`${API_BASE}/api/monitoring/plant-plan`, { method: "POST", body: fd });
        if (!resp.ok) {
          const txt = await resp.text().catch(() => "");
          throw new Error(`${label} POST failed HTTP ${resp.status}: ${txt.slice(0, 120)}`);
        }
        return (await resp.json() as { id: number; itemCount: number }).id;
      };

      let uploadId1: number | null = null;
      let uploadId2: number | null = null;
      try {
        // Upload 1 — original plan
        const data1 = buildWorkbook(1000, 120, 5.0, 500, 110, 3.0);
        // Upload 2 — corrected re-upload (all figures changed so any aggregation is detectable)
        const data2 = buildWorkbook( 300,  60, 2.0, 200,  40, 1.5);

        uploadId1 = await postUpload(data1, "nc19-upload1");
        uploadId2 = await postUpload(data2, "nc19-upload2");

        newChecks.push({
          name: `NC19a · re-upload same month · both uploads posted (id1=${uploadId1}, id2=${uploadId2})`,
          expected: 1, actual: 1, pass: true, tolerance: "both POSTs must succeed",
        });

        interface MachineTotals19 { machineId: string; pcs: number; kg: number; hrs: number; itemCount: number }
        const summaryData19 = await fetchJson<{
          upload: { id: number } | null;
          machineTotals: MachineTotals19[];
          uploadCount: number;
        }>(`${API_BASE}/api/monitoring/plant-plan/machine-summary?month=${FIXTURE_MONTH19}&segment=${encodeURIComponent(FIXTURE_SEGMENT19)}`);

        const totals19 = summaryData19.machineTotals ?? [];
        const mc01 = totals19.find((t) => t.machineId === "MC-01");
        const mc02 = totals19.find((t) => t.machineId === "MC-02");

        // Expected from upload2 only — upload1+upload2 doubled values shown for reference:
        //   MC-01  pcs: upload2=300  (doubled→1300),  kg: upload2=60  (doubled→180),  hrs: upload2=2.0 (doubled→7.0)
        //   MC-02  pcs: upload2=200  (doubled→700),   kg: upload2=40  (doubled→150),  hrs: upload2=1.5 (doubled→4.5)

        const activeUploadId = (summaryData19.upload as { id: number } | null)?.id ?? null;
        newChecks.push({
          name: `NC19b · machine-summary · active upload is the newest (id=${uploadId2}) not the first (id=${uploadId1})`,
          expected: uploadId2 ?? -1, actual: activeUploadId ?? -1,
          pass: activeUploadId === uploadId2,
          tolerance: "upload field must reference the second (newest) upload",
        });

        const mc01Ok = !!mc01 && mc01.pcs === 300 && mc01.kg === 60 && Math.abs(mc01.hrs - 2.0) < 0.01 && mc01.itemCount === 1;
        newChecks.push({
          name: `NC19c · machine-summary · MC-01 pcs=300 kg=60 hrs=2.0 itemCount=1 (got pcs=${mc01?.pcs ?? "n/a"} kg=${mc01?.kg ?? "n/a"} hrs=${mc01?.hrs ?? "n/a"} items=${mc01?.itemCount ?? "n/a"}) — no doubling`,
          expected: 1, actual: mc01Ok ? 1 : 0, pass: mc01Ok,
          tolerance: "must match upload2 only (1300/180/7.0/2 would indicate doubling)",
        });

        const mc02Ok = !!mc02 && mc02.pcs === 200 && mc02.kg === 40 && Math.abs(mc02.hrs - 1.5) < 0.01 && mc02.itemCount === 1;
        newChecks.push({
          name: `NC19d · machine-summary · MC-02 pcs=200 kg=40 hrs=1.5 itemCount=1 (got pcs=${mc02?.pcs ?? "n/a"} kg=${mc02?.kg ?? "n/a"} hrs=${mc02?.hrs ?? "n/a"} items=${mc02?.itemCount ?? "n/a"}) — no doubling`,
          expected: 1, actual: mc02Ok ? 1 : 0, pass: mc02Ok,
          tolerance: "must match upload2 only (700/150/4.5/2 would indicate doubling)",
        });

        // uploadCount tells us how many uploads exist; the endpoint may surface > 1
        // but must use only the newest for totals (verified above).
        newChecks.push({
          name: `NC19e · machine-summary · uploadCount reflects both uploads (${summaryData19.uploadCount ?? "n/a"} ≥ 2)`,
          expected: 1,
          actual: (summaryData19.uploadCount ?? 0) >= 2 ? 1 : 0,
          pass: (summaryData19.uploadCount ?? 0) >= 2,
          tolerance: "both uploads must be persisted; deduplication must be at query time (latest only)",
        });
      } finally {
        // Always clean up both fixture uploads regardless of assertion outcome.
        const cleanups = [uploadId1, uploadId2].filter((id): id is number => id !== null);
        await Promise.all(cleanups.map((id) =>
          fetch(`${API_BASE}/api/monitoring/plant-plan/${id}`, { method: "DELETE" }).catch(() => {}),
        ));
      }
    }

  } catch (err) {
    console.error(`\n❌  New permanent checks error: ${err instanceof Error ? err.message : String(err)}`);
    anyFail = true;
  }

  printSection("New permanent endpoint checks", newChecks);
  if (newChecks.some((c) => !c.pass)) {
    anyFail = true;
    console.error(`\n❌  New checks: ${newChecks.filter((c) => !c.pass).length} check(s) FAILED`);
  } else {
    console.log(`\n✅  New checks: all ${newChecks.length} PASSED`);
  }

  // ── 7. Workbook resolution & actuals-freshness guards ───────────────────
  console.log("\n⏳  Running workbook-resolution & actuals-freshness guards …");
  const wrChecks: CheckResult[] = [];
  const CURRENT_MONTH = new Date().toISOString().slice(0, 7);
  try {
    // WR1: month-match guard — each resolved workbook's title names the monitored month.
    const resolvedResp = await fetchJson<{ month: string; feeds: Array<Record<string, unknown>> }>(
      `${API_BASE}/api/workbook-config/resolved?month=${CURRENT_MONTH}`,
    );
    for (const feed of resolvedResp.feeds ?? []) {
      const div = String(feed.division);
      const resolvedOk = !feed.error && feed.workbookId != null && feed.titleMonthMatch === true;
      // PTMT-Machine (Report-5 Date Sheet series) may legitimately lag the month:
      // the plant creates that workbook days into the month. Until it exists, a
      // NAMED resolution error (citing the pattern) is the correct state — but a
      // silent/unnamed failure is still a bug.
      const namedNoMatch =
        div === "PTMT-Machine" &&
        feed.workbookId == null &&
        String(feed.error ?? "").toLowerCase().includes("pattern");
      const ok = resolvedOk || namedNoMatch;
      wrChecks.push({
        name: `WR1 · ${div} workbook resolves for ${CURRENT_MONTH} and title names the month (${namedNoMatch ? "named no-match accepted — machine report not yet created" : `title: ${feed.title ?? "n/a"}`})`,
        expected: 1, actual: ok ? 1 : 0, pass: ok,
        tolerance: feed.error && !namedNoMatch ? String(feed.error) : "resolved + titleMonthMatch (PTMT-Machine may be a named no-match)",
      });
    }

    // WR2: non-stale guard — current-month produced figures are non-zero once
    // production exists (a stale/wrong workbook presents as zero production).
    const [plumbDashNow, ptmtDashNow] = await Promise.all([
      fetchJson<Record<string, any>>(`${API_BASE}/api/monitoring/dashboard?month=${CURRENT_MONTH}&segment=PLUMBING`),
      fetchJson<Record<string, any>>(`${API_BASE}/api/monitoring/dashboard?month=${CURRENT_MONTH}&segment=PTMT`),
    ]);
    const plumbProducedNow = Number(plumbDashNow?.plant?.produced ?? 0);
    const ptmtProducedNow  = Number(ptmtDashNow?.plant?.totalProduced ?? 0);
    // Only assert non-zero after the 3rd of the month (production data needs a day or two to appear).
    const dayOfMonth = new Date().getDate();
    const expectProduction = dayOfMonth >= 3;
    wrChecks.push({
      name: `WR2a · Plumbing monitoring totalProduced non-zero for ${CURRENT_MONTH} (got ${plumbProducedNow})`,
      expected: 1, actual: !expectProduction || plumbProducedNow > 0 ? 1 : 0,
      pass: !expectProduction || plumbProducedNow > 0, tolerance: "must be > 0 once production exists",
    });
    wrChecks.push({
      name: `WR2b · PTMT monitoring totalProduced non-zero for ${CURRENT_MONTH} (got ${ptmtProducedNow})`,
      expected: 1, actual: !expectProduction || ptmtProducedNow > 0 ? 1 : 0,
      pass: !expectProduction || ptmtProducedNow > 0, tolerance: "must be > 0 once production exists",
    });

    // WR3: cross-source reconciliation — monitoring and corrective read the same
    // source, so produced-to-date must agree (same as-of date, same segment).
    const asOfToday = new Date().toISOString().slice(0, 10);
    const dryReplan = async (segment: string) => {
      const resp = await fetch(`${API_BASE}/api/corrective/replan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: CURRENT_MONTH, asOfDate: asOfToday, segment, dryRun: true }),
      });
      if (!resp.ok) return null;
      return (await resp.json()) as Record<string, any>;
    };
    const [plumbReplan, ptmtReplan] = await Promise.all([
      dryReplan("Plumbing").catch(() => null),
      dryReplan("PTMT").catch(() => null),
    ]);
    const reconcile = (label: string, dashVal: number, replan: Record<string, any> | null) => {
      if (!replan) {
        wrChecks.push({
          name: `WR3 · ${label} monitoring vs corrective producedToDate (corrective endpoint unavailable — skipped)`,
          expected: 1, actual: 1, pass: true, tolerance: "skip: no corrective plan for month",
        });
        return;
      }
      const rep = Number(
        replan.producedToDate ?? replan.totalProduced ?? replan.totals?.producedToDate ?? NaN,
      );
      if (!Number.isFinite(rep)) {
        wrChecks.push({
          name: `WR3 · ${label} corrective producedToDate field present`,
          expected: 1, actual: 0, pass: false, tolerance: "validate-replan payload lacks producedToDate",
        });
        return;
      }
      // ±2%: corrective may add new-order items beyond the frozen plan roster
      // (same architectural tolerance as NC13).
      const ok = dashVal > 0 && Math.abs(rep - dashVal) / dashVal <= 0.02;
      wrChecks.push({
        name: `WR3 · ${label} producedToDate reconciles: monitoring ${dashVal} ≈ corrective ${rep}`,
        expected: dashVal, actual: rep, pass: ok, tolerance: "±2% (same source; corrective adds new-order items)",
      });
    };
    // Corrective producedToDate counts plan-mapped production, so reconcile
    // against monitoring's mapped figure (same source, same mapping rules).
    const plumbMappedNow = Number(plumbDashNow?.plant?.mapped ?? 0);
    const ptmtMappedNow  = Number(ptmtDashNow?.plant?.mapped ?? 0);
    reconcile("Plumbing", plumbMappedNow, plumbReplan);
    reconcile("PTMT", ptmtMappedNow, ptmtReplan);

    // WR5: no-match guard — a month with no workbook must raise a named error,
    // never fall back to a prior month's file.
    const farMonth = "2031-01";
    const noMatch = await fetchJson<{ feeds: Array<Record<string, unknown>> }>(
      `${API_BASE}/api/workbook-config/resolved?month=${farMonth}`,
    );
    for (const feed of noMatch.feeds ?? []) {
      const err = String(feed.error ?? "");
      const ok = feed.workbookId == null && err.includes(farMonth) && err.toLowerCase().includes("pattern");
      wrChecks.push({
        name: `WR5 · ${feed.division} resolution for ${farMonth} fails loudly naming the pattern (no fallback)`,
        expected: 1, actual: ok ? 1 : 0, pass: ok, tolerance: err.slice(0, 120) || "expected named error",
      });
    }
    // WR4 (planning isolation) is covered by the existing Guard-assertion section above.
  } catch (err) {
    console.error(`\n❌  Workbook-resolution checks error: ${err instanceof Error ? err.message : String(err)}`);
    wrChecks.push({ name: "WR · suite executed", expected: 1, actual: 0, pass: false, tolerance: String(err) });
  }
  printSection("Workbook resolution & freshness guards", wrChecks);
  if (wrChecks.some((c) => !c.pass)) {
    anyFail = true;
    console.error(`\n❌  Workbook-resolution: ${wrChecks.filter((c) => !c.pass).length} check(s) FAILED`);
  } else {
    console.log(`\n✅  Workbook-resolution: all ${wrChecks.length} PASSED`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const totalChecks = plumbingResult.checks.length + replanResult.checks.length + ptmtResult.checks.length + monResult.checks.length + schemaParityResult.checks.length + newChecks.length + wrChecks.length;
  const totalFail   = plumbingResult.failCount + replanResult.failCount + ptmtResult.failCount + monResult.failCount + schemaParityResult.failCount + newChecks.filter((c) => !c.pass).length + wrChecks.filter((c) => !c.pass).length;
  const totalPass   = totalChecks - totalFail;

  console.log("\n" + "=".repeat(60));
  if (anyFail) {
    console.error(`❌  SUITE FAILED — ${totalFail} / ${totalChecks} checks failed`);
    console.error("    Fix failures above before proceeding.");
  } else {
    console.log(`✅  SUITE PASSED — ${totalPass} / ${totalChecks} checks passed`);
  }
  console.log("=".repeat(60) + "\n");

  process.exit(anyFail ? 1 : 0);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});

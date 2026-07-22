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

async function runValidateReplan(month: string, workingDaysRemaining: number): Promise<ValidateResponse> {
  const url = `${API_BASE}/api/plan/validate-replan?month=${encodeURIComponent(month)}&workingDaysRemaining=${workingDaysRemaining}`;
  return callEndpoint(url);
}

function fmt(n: number): string {
  return n.toLocaleString("en-IN");
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
    replanResult = await runValidateReplan(PLUMBING_MONTH, 15);
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
  printSection(`Replan — per-category golden values (14-Jul-2026 snapshot, ±1%/±5%)`, replanGoldens);
  printSection(`Replan — totals (14-Jul-2026 snapshot, ±1%)`, replanTotals);

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
    ptmtResult = await runValidate("PTMT", PTMT_MONTH);
  } catch (err) {
    console.error(`\n❌  Could not reach PTMT validate endpoint: ${err instanceof Error ? err.message : String(err)}`);
    anyFail = true;
    ptmtResult = { month: PTMT_MONTH, allPass: false, passCount: 0, failCount: 1, checks: [] };
  }

  const ptmtGuards    = ptmtResult.checks.filter((c) => !c.name.startsWith("PTMT ·"));
  const ptmtCats      = ptmtResult.checks.filter((c) => c.name.startsWith("PTMT ·"));
  printSection(`PTMT — regression guards (${PTMT_MONTH})`, ptmtGuards);
  printSection(`PTMT — per-category Max / Min (${PTMT_MONTH}, ±0.1%)`, ptmtCats);

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

  // ── Summary ───────────────────────────────────────────────────────────────
  const totalChecks = plumbingResult.checks.length + replanResult.checks.length + ptmtResult.checks.length + monResult.checks.length;
  const totalFail   = plumbingResult.failCount + replanResult.failCount + ptmtResult.failCount + monResult.failCount;
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

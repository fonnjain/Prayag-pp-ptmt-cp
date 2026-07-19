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

async function runValidate(segment: string, month: string): Promise<ValidateResponse> {
  const url = `${API_BASE}/api/plan/validate?segment=${encodeURIComponent(segment)}&month=${encodeURIComponent(month)}`;
  // Retry up to 4 times on 429 / 500 (Sheets API quota exhausted).
  // Delays: 15s → 30s → 60s → give up.
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

async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log("  PTMT Production Plan — Regression Test Suite");
  console.log(`  Plumbing month : ${PLUMBING_MONTH}`);
  console.log(`  PTMT month     : ${PTMT_MONTH}`);
  console.log(`  API base       : ${API_BASE}`);
  console.log("=".repeat(60));

  let anyFail = false;

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
  const categories  = plumbingResult.checks.filter(
    (c) => !c.name.startsWith("GUARD") && !c.name.startsWith("ISOLATION") &&
            !c.name.startsWith("Buffer") && !c.name.startsWith("Solvent") &&
            !c.name.startsWith("Items ·"),
  );

  printSection("Plumbing — Guard assertions", guards);
  printSection("Plumbing — Segment isolation", isolation);
  printSection("Plumbing — Buffer multipliers", buffers);
  printSection("Plumbing — Solvent membership", solvents);
  printSection("Plumbing — Item counts per category (exact)", itemCounts);
  printSection(`Plumbing — 12 category totals (${PLUMBING_MONTH}, ±1%)`, categories);

  if (!plumbingResult.allPass) {
    anyFail = true;
    console.error(`\n❌  Plumbing: ${plumbingResult.failCount} check(s) FAILED`);
  } else {
    console.log(`\n✅  Plumbing: all ${plumbingResult.passCount} checks PASSED`);
  }

  // ── 2. PTMT validate ─────────────────────────────────────────────────────
  console.log("\n⏳  Running PTMT validation …");
  let ptmtResult: ValidateResponse;
  try {
    ptmtResult = await runValidate("PTMT", PTMT_MONTH);
  } catch (err) {
    console.error(`\n❌  Could not reach PTMT validate endpoint: ${err instanceof Error ? err.message : String(err)}`);
    anyFail = true;
    ptmtResult = { month: PTMT_MONTH, allPass: false, passCount: 0, failCount: 1, checks: [] };
  }

  printSection(`PTMT — regression guards (${PTMT_MONTH})`, ptmtResult.checks);

  if (!ptmtResult.allPass) {
    anyFail = true;
    console.error(`\n❌  PTMT: ${ptmtResult.failCount} check(s) FAILED`);
  } else {
    console.log(`\n✅  PTMT: all ${ptmtResult.passCount} checks PASSED`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const totalChecks = plumbingResult.checks.length + ptmtResult.checks.length;
  const totalFail   = plumbingResult.failCount + ptmtResult.failCount;
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

import PDFDocument from "pdfkit";
import { sql, eq } from "drizzle-orm";
import { db, validationFindings } from "@workspace/db";
import {
  callClaude,
  extractJSON,
  selectModel,
  anthropicAvailable,
} from "../lib/anthropic";
import type { SourceDiag } from "./ingestion";
import { formatDateTime } from "../lib/date";

export type Severity = "info" | "warning" | "blocker";

export interface Finding {
  severity: Severity;
  type: string;
  source: string | null;
  message: string;
  evidence: string | null;
  suggestedFix: string | null;
  model: string | null;
  tier: string | null;
}

export interface SanityResult {
  verdict: "ok" | "warn" | "block";
  summary: string;
  model: string | null;
  tier: string | null;
  downgraded: boolean;
  findings: Finding[];
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

interface Stats {
  sales: number;
  orders: number;
  production: number;
  pending: number;
  stock: number;
  items: number;
  negSales: number;
  negStock: number;
  salesNoItem: number;
  last3SalesQty: number;
  distinctSaleMonths: number;
}

async function gatherStats(division: string, planMonth: string): Promise<Stats> {
  const pm = planMonth.slice(0, 10);
  const res = await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM sales WHERE division=${division}) AS sales,
      (SELECT COUNT(*) FROM orders WHERE division=${division}) AS orders,
      (SELECT COUNT(*) FROM production WHERE division=${division}) AS production,
      (SELECT COUNT(*) FROM pending_orders WHERE division=${division} AND plan_month=${pm}) AS pending,
      (SELECT COUNT(*) FROM stock_opening WHERE division=${division}) AS stock,
      (SELECT COUNT(*) FROM items WHERE division=${division}) AS items,
      (SELECT COUNT(*) FROM sales WHERE division=${division} AND qty < 0) AS neg_sales,
      (SELECT COUNT(*) FROM stock_opening WHERE division=${division} AND qty < 0) AS neg_stock,
      (SELECT COUNT(DISTINCT s.item_code) FROM sales s
         LEFT JOIN items i ON i.item_code=s.item_code AND i.division=s.division
         WHERE s.division=${division} AND i.item_code IS NULL) AS sales_no_item,
      (SELECT COALESCE(SUM(qty),0) FROM sales WHERE division=${division}) AS last3_qty,
      (SELECT COUNT(DISTINCT month) FROM sales WHERE division=${division}) AS distinct_months
  `);
  const r = (res.rows[0] ?? {}) as Record<string, unknown>;
  return {
    sales: num(r["sales"]),
    orders: num(r["orders"]),
    production: num(r["production"]),
    pending: num(r["pending"]),
    stock: num(r["stock"]),
    items: num(r["items"]),
    negSales: num(r["neg_sales"]),
    negStock: num(r["neg_stock"]),
    salesNoItem: num(r["sales_no_item"]),
    last3SalesQty: num(r["last3_qty"]),
    distinctSaleMonths: num(r["distinct_months"]),
  };
}

function mkAdd(out: Finding[], source: string) {
  return (
    severity: Severity,
    type: string,
    message: string,
    evidence: string | null = null,
    suggestedFix: string | null = null,
  ) =>
    out.push({
      severity,
      type,
      source,
      message,
      evidence,
      suggestedFix,
      model: null,
      tier: null,
    });
}

// Whole-division singleton conditions: there can only ever be ONE no_stock /
// no_pending finding for a scope, but both layers can surface it (Layer A from
// the aggregate/per-source check, Layer B from stock_opening_count /
// pending_orders_count). Collapse them to a single finding by type alone.
const SINGLETON_TYPES = new Set(["no_stock", "no_pending"]);

const SEV_RANK: Record<Severity, number> = { info: 1, warning: 2, blocker: 3 };

// A stray full-history note sometimes comes back typed wrong_month/partial; these
// describe EXPECTED full-history breadth, not a real fetch problem.
const FULL_HISTORY_RE =
  /full[- ]history|out[- ]of[- ]window|out of window|filtered downstream|two[- ]file/i;

// Hard-failure signals that mean a wrong_month/partial finding is a REAL problem
// (the in-window data is actually missing) even if it also mentions full history.
// When present we must NOT demote — err toward keeping a real blocker over hiding
// it. Targets explicit zero-in-window assertions, not generic "in-window" prose.
const HARD_FAIL_RE =
  /nothing to plan|no rows inside|0 rows inside|no in[- ]?window|in[- ]?window rows?\D{0,4}\b0\b|in_window_rows\s*[=:]\s*0/i;

// The set of numbers cited in a finding's evidence (commas stripped), joined as a
// stable signature. Two findings citing the SAME number(s) describe the same fact.
function evidenceSig(s: string | null): string {
  return (String(s ?? "").match(/-?\d[\d,]*\.?\d*/g) || [])
    .map((x) => x.replace(/,/g, ""))
    .join("|");
}

// A signature is only a reliable identity when it cites a SPECIFIC number. Bare
// zero ("0") is ambiguous — no_stock and no_pending both cite 0 yet are distinct
// facts — so it must never collapse two findings on its own.
function specificSig(sig: string): boolean {
  return sig !== "" && !/^0(\|0)*$/.test(sig);
}

// Deterministic backstop over Claude's (Layer B) findings — don't trust the
// prompt alone. Demote full-history-worded wrong_month/partial notes to an info
// `full_history`, and never let a stock/pending condition hide under `empty`.
function normalizeClaudeTypes(findings: Finding[]): Finding[] {
  return findings.map((f) => {
    // Only demote when the message has POSITIVE full-history context AND no
    // hard-failure signal. A wrong_month/partial that actually proves the
    // in-window data is missing must stay a real finding, never become info.
    if (
      (f.type === "wrong_month" || f.type === "partial") &&
      FULL_HISTORY_RE.test(f.message) &&
      !HARD_FAIL_RE.test(f.message)
    ) {
      return {
        ...f,
        type: "full_history",
        severity: "info" as Severity,
        suggestedFix: f.suggestedFix || "none — expected for full-history source",
      };
    }
    if (f.type === "empty" && /stock/i.test(f.message)) return { ...f, type: "no_stock" };
    if (f.type === "empty" && /pending/i.test(f.message)) return { ...f, type: "no_pending" };
    return f;
  });
}

// Collapse Claude's own redundancy (it can restate one problem under several
// sources despite the prompt). Merge by TYPE only — never across types on a
// coincidental shared number (e.g. missing_codes=19 vs an unrelated outlier=19);
// alias types like empty->no_stock are already unified by normalizeClaudeTypes.
function dedupeClaudeIssues(findings: Finding[]): Finding[] {
  const out: Finding[] = [];
  for (const f of findings) {
    const idx = out.findIndex((x) => x.type === f.type);
    if (idx === -1) {
      out.push(f);
      continue;
    }
    const cur = out[idx];
    // Severity DOMINATES: a lower-severity finding can never replace a higher
    // one. A longer (more actionable) fix only breaks ties at equal severity.
    const fRank = SEV_RANK[f.severity];
    const curRank = SEV_RANK[cur.severity];
    const better =
      fRank > curRank ||
      (fRank === curRank &&
        (f.suggestedFix?.length ?? 0) > (cur.suggestedFix?.length ?? 0));
    if (better) out[idx] = f;
  }
  return out;
}

// De-dup safety net over the merged Layer A + Layer B findings. Collapses
// cross-layer repeats: singleton types (no_stock/no_pending) by type; anything
// byte-identical in severity+type+message; and same-type findings that cite the
// same SPECIFIC number (e.g. Layer A "orphan codes = 19" vs Claude
// "orphan_item_codes=19"). Layer A is listed first, so its deterministic wording
// wins. Blanket same-type collapse is intentionally NOT done here — distinct
// Layer A findings legitimately share a type (e.g. two `outlier`s).
function dedupeFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  const sigSeen = new Set<string>();
  const out: Finding[] = [];
  for (const f of findings) {
    const key = SINGLETON_TYPES.has(f.type)
      ? `type:${f.type}`
      : `${f.severity}|${f.type}|${f.message.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    const sig = evidenceSig(f.evidence);
    const sigKey = `${f.type}|${sig}`;
    if (specificSig(sig) && sigSeen.has(sigKey)) continue;
    seen.add(key);
    if (specificSig(sig)) sigSeen.add(sigKey);
    out.push(f);
  }
  return out;
}

// Layer A (deterministic, Node) — aggregate, whole-division sanity on the
// post-upsert DB state. Complements the per-source checks below.
function layerAAggregate(stats: Stats): Finding[] {
  const out: Finding[] = [];
  const add = mkAdd(out, "layerA");

  if (stats.sales === 0)
    add(
      "blocker",
      "empty",
      "No sales rows for this division. The buffer engine needs sales history to compute run-rate.",
      "sales count = 0",
      "Pull the Sales workbook and verify the configured file ID and tab pattern.",
    );
  if (stats.items === 0)
    add(
      "blocker",
      "empty",
      "No items master for this division. Item attributes (model/category/rate) will be empty.",
      "items count = 0",
      "Pull the rate list / items master.",
    );
  if (stats.stock === 0)
    add(
      "warning",
      "no_stock",
      "No opening-stock snapshot. Coverage and required quantities assume zero stock and will be overstated.",
      "stock_opening count = 0",
      "Pull the opening-stock sheet for the stock as-on date.",
    );
  if (stats.pending === 0)
    add(
      "info",
      "no_pending",
      "No pending orders for this plan month. Demand will exclude pending quantities.",
      "pending_orders count = 0",
    );
  if (stats.negSales > 0)
    add(
      "warning",
      "outlier",
      `${stats.negSales} sales rows have negative quantity (returns/credits).`,
      `negative sales rows = ${stats.negSales}`,
      "Confirm these are intentional returns; they reduce run-rate.",
    );
  if (stats.negStock > 0)
    add(
      "warning",
      "outlier",
      `${stats.negStock} stock rows have negative quantity.`,
      `negative stock rows = ${stats.negStock}`,
    );
  if (stats.salesNoItem > 0)
    add(
      "warning",
      "missing_codes",
      `${stats.salesNoItem} item codes appear in sales but not in the items master.`,
      `orphan item codes = ${stats.salesNoItem}`,
      "Add the missing items to the master or re-pull the rate list.",
    );
  if (stats.sales > 0 && stats.last3SalesQty === 0)
    add(
      "warning",
      "outlier",
      "Sales rows exist but total quantity is zero.",
      "sum(qty) = 0",
    );
  return out;
}

// Layer A (deterministic, Node) — per-source checks against the fetch itself:
// empty, wrong file, wrong month/out-of-window, shifted columns, partial fetch
// vs the previous accepted pull, negative quantities, amount~=qty*rate.
function layerAPerSource(diags: SourceDiag[]): Finding[] {
  const out: Finding[] = [];
  const add = mkAdd(out, "layerA");
  for (const d of diags) {
    const src = d.dataType;

    if (d.empty) {
      // An absent stock/pending snapshot is its OWN (expected) condition, not an
      // "empty" fetch failure — reserve `empty` for core sources that returned
      // nothing. This keeps the type taxonomy clean and lets the cross-layer
      // de-dup collapse it against Claude's no_stock / no_pending finding.
      if (src === "stock") {
        add(
          "warning",
          "no_stock",
          `No opening-stock snapshot ("${src}" returned 0 rows); required quantities assume zero stock and will be overstated.`,
          "stock_opening count = 0",
          "Pull the opening-stock sheet for the stock as-on date.",
        );
      } else if (src === "pending") {
        add(
          "info",
          "no_pending",
          `No pending orders ("${src}" returned 0 rows); demand will exclude pending quantities.`,
          "pending_orders count = 0",
        );
      } else {
        add(
          "blocker",
          "empty",
          `Source "${src}" returned 0 usable rows.`,
          `${src}: rows=0, rejected=${d.rejected}, tab=${d.tab ?? "?"}`,
          `Re-fetch "${src}" and check the file ID, tab pattern, and column headers.`,
        );
      }
      continue; // further checks are meaningless on an empty source
    }

    if (!d.fileMatches) {
      add(
        "blocker",
        "wrong_file",
        `Source "${src}" used file ${d.fileId} but the configured file for this month is ${d.expectedFileId}.`,
        `used=${d.fileId} expected=${d.expectedFileId}`,
        `Re-fetch "${src}" using the file mandated by the fiscal-year rule for this plan month.`,
      );
    }

    if (d.missingColumns.length > 0) {
      add(
        "blocker",
        "shifted_column",
        `Source "${src}" is missing expected columns in mapped positions: ${d.missingColumns.join(", ")}.`,
        `missing=${d.missingColumns.join(",")}`,
        `Re-fetch "${src}" and confirm the header row matches the expected layout.`,
      );
    }

    // Windowed source completeness is judged on IN-WINDOW data only. The source
    // workbooks are full multi-year history and the engine date-filters every
    // time series downstream, so out-of-window rows are EXPECTED and never an
    // error on their own. Only an empty WINDOW means the fetch is unusable.
    if (d.windowFrom && d.windowTo && d.inWindowRows === 0) {
      add(
        "blocker",
        "wrong_month",
        `Source "${src}" returned no rows inside the plan-month window ${d.windowFrom}..${d.windowTo}; the engine has nothing to plan on.`,
        `in_window_rows=0, whole_file_rows=${d.rows}, date_range=${d.dateMin ?? "?"}..${d.dateMax ?? "?"}`,
        `Re-fetch "${src}" for the correct plan-month window (possible wrong-month or wrong-file pull).`,
      );
    }

    // Partial fetch of the WINDOW (not of history): in-window row / distinct-code
    // count dropped materially vs the previous accepted pull's in-window
    // footprint. Only computed for single-source windowed handlers (prevInWindow
    // is null otherwise), so multi-file sales never triggers a false drop.
    if (d.prevInWindowRows !== null && d.prevInWindowRows > 0 && d.inWindowRows < d.prevInWindowRows) {
      const ratio = d.inWindowRows / d.prevInWindowRows;
      if (ratio < 0.6) {
        add(
          ratio < 0.4 ? "blocker" : "warning",
          "partial",
          `Source "${src}" in-window row count dropped from ${d.prevInWindowRows} to ${d.inWindowRows} vs the previous pull.`,
          `in_window_rows ${d.prevInWindowRows} -> ${d.inWindowRows} (${Math.round(ratio * 100)}%)`,
          `Re-fetch "${src}"; the previous pull had materially more in-window rows (possible truncated fetch).`,
        );
      }
    }
    if (
      d.prevInWindowDistinct !== null &&
      d.prevInWindowDistinct > 0 &&
      d.inWindowDistinct < d.prevInWindowDistinct * 0.6
    ) {
      add(
        "warning",
        "missing_codes",
        `Source "${src}" in-window distinct item codes dropped from ${d.prevInWindowDistinct} to ${d.inWindowDistinct}.`,
        `in_window distinct codes ${d.prevInWindowDistinct} -> ${d.inWindowDistinct}`,
        `Re-fetch "${src}"; many in-window item codes from the previous pull are absent now.`,
      );
    }

    // Negative quantities matter only inside the window (the engine ignores the
    // rest). Could be legitimate returns/credits, so warn rather than block.
    if (d.inWindowNegQty > 0) {
      add(
        "warning",
        "outlier",
        `Source "${src}" has ${d.inWindowNegQty} in-window rows with negative quantity.`,
        `in_window negative qty rows = ${d.inWindowNegQty}`,
        "Confirm these are intentional (returns/credits) and not a column shift.",
      );
    }
  }
  return out;
}

// Layer B: Claude review (ALWAYS deep). Strict-JSON contract.
async function layerB(
  division: string,
  planMonth: string,
  stats: Stats,
  diags: SourceDiag[],
  layerAFindings: Finding[],
): Promise<{ findings: Finding[]; summary: string; model: string | null; tier: string | null; downgraded: boolean }> {
  if (!anthropicAvailable) {
    return {
      findings: [],
      summary:
        "AI review skipped: ANTHROPIC_API_KEY is not configured. Showing deterministic checks only.",
      model: null,
      tier: null,
      downgraded: false,
    };
  }
  const choice = selectModel({ task: "sanity" });
  const system = `You are the data sanity checker for a production-planning app. After the Google
Drive connector fetches a batch for a chosen DIVISION (PTMT or CP) and PLAN
MONTH, you receive a NUMBERS-ONLY SUMMARY of the fetch (never the full data).
Judge whether the fetch is COMPLETE and CORRECT, and give concise, de-duplicated,
actionable input. You ASSESS ONLY — never modify, clean, or recompute any data
or numbers, and never run the planning math. Base every conclusion strictly on
the summary; if something can't be determined from it, say so.

== SOURCE MODEL (read before flagging anything) ==
The source workbooks are MULTI-YEAR, FULL-HISTORY files read from a "Combined"
or full-history tab. Therefore:
- Sales and production sources LEGITIMATELY contain rows far outside the plan
  month. A June plan's run-rate window is the three prior calendar months and
  "last month" is the immediately prior month; the engine FILTERS to the window
  downstream. Rows outside the window are EXPECTED, not an error.
- For a June plan, the 3-month sales span legitimately straddles two fiscal-year
  files (e.g. March from Sale 25-26, April–May from Sale 26-27); both files
  being present is correct, not a wrong-file pull.
- \`amount != qty * rate\` is EXPECTED on many rows because amounts are
  tax-inclusive and/or rounded.
Do NOT raise wrong_month, wrong_file, partial, or unit_mismatch for any of the
above. Only raise wrong_month/wrong_file when the IN-WINDOW data is actually
missing or the file is genuinely the wrong source (file_id not in
configured_file_ids).

== WHAT IS A REAL PROBLEM ==
Blocker (data must not be used as-is):
- A required source returned 0 rows, OR returned 0 rows INSIDE the plan-month
  window when in-window rows are required (e.g. production for the plan month).
- The file_id used is not among the configured sources for that division/month.
- A column is clearly shifted (values of the wrong kind, e.g. text where qty is
  expected) such that the in-window data is unusable.
Warning (usable, but planner must acknowledge — these change the output):
- No opening-stock snapshot (stock_opening_count = 0): required quantities
  assume zero stock and will be OVERSTATED. Always raise this when stock is absent.
- Item codes present in sales/orders/production but missing from the items
  master (orphan_item_codes > 0; they will be dropped from the plan).
- A genuine in-window anomaly: impossible negatives, an in-window quantity
  outlier orders of magnitude off history, or in-window row/code count far below
  the previous accepted pull (true partial fetch of the WINDOW, not of history).
Info (note only, no action):
- No pending orders for the plan month (pending_orders_count = 0; demand
  excludes pending).
- Expected full-history breadth (out-of-window rows, two-file sales span,
  tax-inclusive amounts) — mention once, collectively, as context, ONLY if you
  reference it; do not enumerate per source.

== DE-DUPLICATION (mandatory) ==
Report each DISTINCT problem EXACTLY ONCE, even if it shows up in several
sources or both per-source and in aggregate. Merge identical issues across
sources into one finding and name the sources in its \`source\` field
(e.g. "sales, production"). Never emit a per-source finding and a summary
finding for the same problem. Aim for the SMALLEST set of findings that fully
covers the real issues — typically 3–6, not 16. Do not pad.

== TYPE SELECTION (avoid double-classifying) ==
Choose ONE type per issue; never describe the same fact under two types.
- Use \`no_stock\` for a missing opening-stock snapshot — never ALSO \`empty\`.
- Use \`no_pending\` for absent pending orders — never ALSO \`empty\`.
- Reserve \`empty\` ONLY for a source/tab that returned 0 rows entirely
  (i.e. a failed/blank fetch), never for an absent stock or pending snapshot.
Before returning, scan your issues array and MERGE any two entries that cite the
same underlying fact or the same evidence value into one finding. For example, a
\`no_stock\` and an \`empty\` both citing stock_opening_count=0 are ONE finding, not
two; a \`no_pending\` and an \`empty\` both citing pending_orders_count=0 are ONE
finding. Two findings must never share the same evidence number.

== EVIDENCE & FIXES ==
For each finding give: the affected source(s); concrete evidence (the numbers
from the summary, and for windowed checks cite the IN-WINDOW figure, not the
whole-file count); and a specific suggested_fix.

== OUTPUT — STRICT JSON ONLY (no prose outside it, no markdown fences) ==
{
  "verdict": "ok" | "warn" | "block",
  "issues": [
    {
      "severity": "info" | "warning" | "blocker",
      "type": "empty|partial|wrong_month|wrong_file|shifted_column|missing_codes|outlier|no_stock|no_pending",
      "source": "<source(s), comma-separated>",
      "message": "<the problem, stated once, plainly>",
      "evidence": "<in-window numbers that prove it>",
      "suggested_fix": "<exact action, or 'none — expected for full-history source'>"
    }
  ],
  "summary": "<one short paragraph: is this fetch safe to plan on, and the few things to fix first>"
}

verdict = "block" if any blocker; else "warn" if any warning; else "ok".
If the in-window data is complete and correct, return verdict "ok" with an empty
issues array even if the files contain large out-of-window history.`;

  const user = JSON.stringify({
    instruction: "Review this fetched batch and return your JSON assessment.",
    division,
    plan_month: planMonth.slice(0, 7),
    // Master / snapshot signals that actually change the plan (whole-division).
    stock_opening_count: stats.stock,
    pending_orders_count: stats.pending,
    orphan_item_codes: stats.salesNoItem,
    perSource: diags.map((d) => ({
      source: d.dataType,
      file_id: d.fileId,
      expected_file_for_month: d.expectedFileId,
      configured_file_ids: d.configuredFileIds,
      is_full_history: d.isFullHistory,
      tab: d.tab,
      expected_window: d.windowFrom ? { from: d.windowFrom, to: d.windowTo } : null,
      // whole-file (context only — do NOT flag on these)
      rows: d.rows,
      rejected: d.rejected,
      distinct_item_codes: d.distinctCodes,
      out_of_window_rows: d.outOfWindow,
      date_min: d.dateMin,
      date_max: d.dateMax,
      // IN-WINDOW (judge completeness on these)
      in_window_rows: d.inWindowRows,
      in_window_distinct_codes: d.inWindowDistinct,
      prev_in_window_rows: d.prevInWindowRows,
      prev_in_window_distinct: d.prevInWindowDistinct,
      in_window_neg_qty_rows: d.inWindowNegQty,
      in_window_qty: {
        min: d.inWindowQtyMin,
        max: d.inWindowQtyMax,
        mean: d.inWindowQtyMean,
        sum: d.inWindowQtySum,
      },
      missing_columns: d.missingColumns,
    })),
    deterministic_findings: layerAFindings.map((f) => ({
      severity: f.severity,
      type: f.type,
      source: f.source,
      message: f.message,
    })),
  });

  try {
    const res = await callClaude({ system, user, tier: choice.tier });
    interface RawIssue {
      severity?: string;
      type?: string;
      source?: string;
      message?: string;
      evidence?: string;
      suggested_fix?: string;
      suggestedFix?: string;
    }
    const parsed = extractJSON<{
      verdict?: string;
      summary?: string;
      issues?: RawIssue[];
      findings?: RawIssue[];
    }>(res.text);
    const raw = parsed.issues ?? parsed.findings ?? [];
    const findings: Finding[] = raw.map((f) => ({
      severity: normalizeSeverity(f.severity),
      type: f.type || "ai_finding",
      // Claude names the affected source(s) per the de-dup contract; fall back
      // to "layerB" when it omits them.
      source: f.source?.trim() || "layerB",
      message: f.message || "",
      evidence: f.evidence ?? null,
      suggestedFix: f.suggested_fix ?? f.suggestedFix ?? null,
      model: res.model,
      tier: res.tier,
    }));
    return {
      findings,
      summary: parsed.summary || "AI review complete.",
      model: res.model,
      tier: res.tier,
      downgraded: res.downgraded,
    };
  } catch (err) {
    return {
      findings: [
        {
          severity: "info",
          type: "ai_error",
          source: "layerB",
          message: `AI review failed: ${err instanceof Error ? err.message : String(err)}`,
          evidence: null,
          suggestedFix: "Deterministic checks are still authoritative.",
          model: choice.model,
          tier: choice.tier,
        },
      ],
      summary: "AI review failed; deterministic checks shown.",
      model: choice.model,
      tier: choice.tier,
      downgraded: false,
    };
  }
}

function normalizeSeverity(s: string | undefined): Severity {
  const v = (s || "").toLowerCase();
  if (v.startsWith("block")) return "blocker";
  if (v.startsWith("warn")) return "warning";
  return "info";
}

function verdictOf(findings: Finding[]): "ok" | "warn" | "block" {
  if (findings.some((f) => f.severity === "blocker")) return "block";
  if (findings.some((f) => f.severity === "warning")) return "warn";
  return "ok";
}

export async function runSanity(
  division: string,
  planMonth: string,
  batchId?: number,
  diags: SourceDiag[] = [],
): Promise<SanityResult> {
  const stats = await gatherStats(division, planMonth);
  const aFindings = [...layerAPerSource(diags), ...layerAAggregate(stats)];
  const b = await layerB(division, planMonth, stats, diags, aFindings);
  // Deterministic cleanup of Claude's reply (don't rely on the prompt alone):
  // normalize stray types, then collapse its internal redundancy, then merge with
  // the deterministic findings and de-dup cross-layer. Verdict is recomputed from
  // the cleaned set so it stays consistent with what's shown.
  const bClean = dedupeClaudeIssues(normalizeClaudeTypes(b.findings));
  const findings = dedupeFindings([...aFindings, ...bClean]);
  const verdict = verdictOf(findings);
  const summary = b.summary;

  if (batchId !== undefined) {
    // Idempotent: clear prior findings for this batch before re-persisting.
    await db.delete(validationFindings).where(eq(validationFindings.importBatchId, batchId));
    if (findings.length > 0) {
      await db.insert(validationFindings).values(
        findings.map((f) => ({
          importBatchId: batchId,
          severity: f.severity,
          type: f.type,
          message: f.message,
          detail: { evidence: f.evidence, suggestedFix: f.suggestedFix },
          source: f.source,
          model: f.model,
          tier: f.tier,
          downgraded: b.downgraded,
        })),
      );
    }
  }

  return {
    verdict,
    summary,
    model: b.model,
    tier: b.tier,
    downgraded: b.downgraded,
    findings,
  };
}

// Reconstruct the latest sanity result for a scope from persisted findings.
export async function getLatestSanity(
  division: string,
  planMonth: string,
): Promise<SanityResult | null> {
  const pm = planMonth.slice(0, 10);
  const batchRes = await db.execute(sql`
    SELECT id, sanity_verdict, sanity_summary
    FROM import_batches
    WHERE division=${division} AND plan_month=${pm}
    ORDER BY pulled_at DESC NULLS LAST, id DESC
    LIMIT 1
  `);
  const batch = batchRes.rows[0] as
    | { id?: number; sanity_verdict?: string; sanity_summary?: string }
    | undefined;
  if (!batch?.id) return null;

  const fRes = await db.execute(sql`
    SELECT severity, type, message, detail, source, model, tier
    FROM validation_findings WHERE import_batch_id=${batch.id}
    ORDER BY id ASC
  `);
  const findings: Finding[] = (fRes.rows as Record<string, unknown>[]).map((r) => {
    const detail = (r["detail"] as { evidence?: string; suggestedFix?: string } | null) ?? null;
    return {
      severity: normalizeSeverity(r["severity"] as string),
      type: String(r["type"] ?? ""),
      source: (r["source"] as string) ?? null,
      message: String(r["message"] ?? ""),
      evidence: detail?.evidence ?? null,
      suggestedFix: detail?.suggestedFix ?? null,
      model: (r["model"] as string) ?? null,
      tier: (r["tier"] as string) ?? null,
    };
  });

  const verdictMap: Record<string, "ok" | "warn" | "block"> = {
    ok: "ok",
    warn: "warn",
    block: "block",
  };
  return {
    verdict: verdictMap[batch.sanity_verdict ?? "ok"] ?? verdictOf(findings),
    summary: batch.sanity_summary ?? "",
    model: findings.find((f) => f.model)?.model ?? null,
    tier: findings.find((f) => f.tier)?.tier ?? null,
    downgraded: false,
    findings,
  };
}

const VERDICT_LABEL: Record<string, string> = {
  ok: "OK — data looks complete and correct",
  warn: "WARN — review the warnings below before planning",
  block: "BLOCK — do not plan; fix the issues below and re-pull",
};

const SEVERITY_COLOR: Record<Severity, string> = {
  blocker: "#b91c1c",
  warning: "#b45309",
  info: "#1d4ed8",
};

// Render the latest sanity-check result for a scope as a downloadable PDF.
export async function renderSanityPdf(
  division: string,
  planMonth: string,
): Promise<{ buffer: Buffer; filename: string } | null> {
  const result = await getLatestSanity(division, planMonth);
  if (!result) return null;

  const pm = planMonth.slice(0, 7);
  const buffer = await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(20).fillColor("#000").text("Prayag Production Planning");
    doc.moveDown(0.3);
    doc
      .fontSize(14)
      .fillColor("#444")
      .text(`Data Sanity Check — ${division} ${pm}`);
    doc.moveDown(0.6);

    const verdictColor = SEVERITY_COLOR[
      result.verdict === "block"
        ? "blocker"
        : result.verdict === "warn"
          ? "warning"
          : "info"
    ];
    doc
      .fontSize(13)
      .fillColor(verdictColor)
      .text(VERDICT_LABEL[result.verdict] ?? result.verdict.toUpperCase());
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor("#000").text(result.summary || "No summary.");
    doc.moveDown(0.8);

    const counts = {
      blocker: result.findings.filter((f) => f.severity === "blocker").length,
      warning: result.findings.filter((f) => f.severity === "warning").length,
      info: result.findings.filter((f) => f.severity === "info").length,
    };
    doc
      .fontSize(9)
      .fillColor("#555")
      .text(
        `Findings: ${result.findings.length} total — ${counts.blocker} blocker, ${counts.warning} warning, ${counts.info} info`,
      );
    doc.moveDown(0.6);

    if (result.findings.length === 0) {
      doc.fontSize(11).fillColor("#15803d").text("No issues found.");
    } else {
      doc
        .fontSize(13)
        .fillColor("#1a1a1a")
        .text("Identified Issues");
      doc.moveDown(0.4);
      result.findings.forEach((f, i) => {
        const color = SEVERITY_COLOR[f.severity];
        doc
          .fontSize(11)
          .fillColor(color)
          .text(
            `${i + 1}. [${f.severity.toUpperCase()}] ${f.type.replace(/_/g, " ")}`,
          );
        doc.fontSize(10).fillColor("#000").text(f.message);
        if (f.evidence) {
          doc.fontSize(9).fillColor("#555").text(`Evidence: ${f.evidence}`);
        }
        if (f.suggestedFix) {
          doc.fontSize(9).fillColor("#555").text(`Fix: ${f.suggestedFix}`);
        }
        doc.moveDown(0.6);
      });
    }

    const footer =
      `Verdict: ${result.verdict} | Model: ${result.model ?? "n/a"} | Tier: ${result.tier ?? "n/a"}` +
      ` | Generated: ${formatDateTime(new Date())}`;
    doc
      .fontSize(8)
      .fillColor("#888")
      .text(footer, 50, doc.page.height - 40, {
        width: doc.page.width - 100,
        align: "center",
      });

    doc.end();
  });

  const filename = `sanity-${division}-${pm}.pdf`;
  return { buffer, filename };
}

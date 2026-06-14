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
      "empty",
      "No opening-stock snapshot. Coverage and required quantities assume zero stock.",
      "stock_opening count = 0",
      "Pull the opening-stock sheet for the stock as-on date.",
    );
  if (stats.pending === 0)
    add(
      "info",
      "empty",
      "No pending orders for this plan month. Demand will exclude pending quantities.",
      "pending_orders count = 0",
    );
  if (stats.negSales > 0)
    add(
      "warning",
      "unit_mismatch",
      `${stats.negSales} sales rows have negative quantity (returns/credits).`,
      `negative sales rows = ${stats.negSales}`,
      "Confirm these are intentional returns; they reduce run-rate.",
    );
  if (stats.negStock > 0)
    add(
      "warning",
      "unit_mismatch",
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
      // pending and stock are optional inputs: empty just means demand excludes
      // pending / opening stock is assumed zero. Only the core series block.
      const optional = src === "pending" || src === "stock";
      add(
        optional ? (src === "pending" ? "info" : "warning") : "blocker",
        "empty",
        optional
          ? `Source "${src}" returned 0 rows; the plan will proceed assuming none.`
          : `Source "${src}" returned 0 usable rows.`,
        `${src}: rows=0, rejected=${d.rejected}, tab=${d.tab ?? "?"}`,
        `Re-fetch "${src}" and check the file ID, tab pattern, and column headers.`,
      );
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

    if (d.windowFrom && d.windowTo && d.outOfWindow > 0) {
      // The engine date-filters every time-series, so out-of-window rows are
      // harmless noise unless NONE fall in-window — that signals a wrong-file or
      // wrong-month pull that leaves the engine nothing usable.
      const inWindow = d.rows - d.outOfWindow;
      add(
        inWindow === 0 ? "blocker" : "warning",
        "wrong_month",
        `Source "${src}" has ${d.outOfWindow} rows with dates outside the expected window ${d.windowFrom}..${d.windowTo}.`,
        `out_of_window=${d.outOfWindow}/${d.rows}, date_range=${d.dateMin ?? "?"}..${d.dateMax ?? "?"}`,
        `Re-fetch "${src}" for the correct plan-month window (possible wrong-month or wrong-file pull).`,
      );
    }

    // Partial fetch: row count or distinct-code count dropped materially vs the
    // previous accepted pull.
    if (d.prevRows !== null && d.prevRows > 0 && d.rows < d.prevRows) {
      const ratio = d.rows / d.prevRows;
      if (ratio < 0.6) {
        add(
          ratio < 0.4 ? "blocker" : "warning",
          "partial",
          `Source "${src}" row count dropped from ${d.prevRows} to ${d.rows} vs the previous pull.`,
          `rows ${d.prevRows} -> ${d.rows} (${Math.round(ratio * 100)}%)`,
          `Re-fetch "${src}"; the previous pull had materially more rows (possible truncated fetch).`,
        );
      }
    }
    if (d.prevDistinct !== null && d.prevDistinct > 0 && d.distinctCodes < d.prevDistinct * 0.6) {
      add(
        "warning",
        "missing_codes",
        `Source "${src}" distinct item codes dropped from ${d.prevDistinct} to ${d.distinctCodes}.`,
        `distinct codes ${d.prevDistinct} -> ${d.distinctCodes}`,
        `Re-fetch "${src}"; many item codes from the previous pull are absent now.`,
      );
    }

    if (d.negQty > 0) {
      add(
        "warning",
        "unit_mismatch",
        `Source "${src}" has ${d.negQty} rows with negative quantity.`,
        `negative qty rows = ${d.negQty}`,
        "Confirm these are intentional (returns/credits).",
      );
    }

    if (d.amountMismatch > 0) {
      add(
        "warning",
        "unit_mismatch",
        `Source "${src}" has ${d.amountMismatch} rows where amount does not match qty x rate.`,
        `amount<>qty*rate rows = ${d.amountMismatch}`,
        "Check for shifted columns or a unit/rate mismatch in the source sheet.",
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
  const system =
    "You are a meticulous manufacturing-data auditor for a production-planning system. " +
    "After a Google connector fetch for one DIVISION and PLAN MONTH you receive a NUMBERS-ONLY summary of the fetch (never the full data). " +
    "Judge whether the fetch looks COMPLETE and CORRECT and catch: empty, partial (drop vs previous pull), wrong_month (dates outside window), wrong_file (fiscal-year file rule), shifted_column, missing_codes, unit_mismatch/outlier, duplicates. " +
    "You ASSESS ONLY — never modify, clean, or recompute data, and never do the planning math. Base conclusions strictly on the summary. " +
    "IMPORTANT context about this system's INTENDED design (do NOT flag these as errors): " +
    "(1) Sales is deliberately loaded as FULL multi-year history and is often split across MULTIPLE fiscal-year workbooks — seeing two or more 'sales' sources with different file_ids and different date ranges is EXPECTED and correct, NOT a duplicate or partial-drop error. Compare a source only against its OWN file_id history, never one workbook against another. " +
    "(2) The planning engine date-FILTERS every time series downstream, so rows outside expected_window are harmless and should be at most a 'warning'. Only raise a wrong_month/wrong_file BLOCKER when essentially NONE of a source's rows fall inside the window (the fetch is unusable). " +
    "(3) Production may also be a full-history tab; out-of-window production rows are filtered by the engine — warning, not blocker. " +
    "(4) amount != qty x rate often reflects tax-inclusive amounts or rounding — treat as a 'warning' unit_mismatch unless the mismatch is pervasive AND extreme. " +
    "Respond with STRICT JSON only, no prose, no markdown fences. " +
    'Schema: {"verdict":"ok|warn|block","summary":"<=400 chars","issues":[{"severity":"info|warning|blocker","type":"empty|partial|wrong_month|wrong_file|shifted_column|missing_codes|unit_mismatch|outlier","message":"string","evidence":"string","suggested_fix":"string"}]}. ' +
    "Use blocker only when the data must not be used (empty, wrong file, wrong month, clearly partial).";
  const user = JSON.stringify({
    division,
    planMonth,
    perSource: diags.map((d) => ({
      source: d.dataType,
      file_id: d.fileId,
      expected_file_id: d.expectedFileId,
      file_matches: d.fileMatches,
      tab: d.tab,
      rows: d.rows,
      rejected: d.rejected,
      distinct_codes: d.distinctCodes,
      prev_rows: d.prevRows,
      prev_distinct: d.prevDistinct,
      expected_window: d.windowFrom ? `${d.windowFrom}..${d.windowTo}` : null,
      date_min: d.dateMin,
      date_max: d.dateMax,
      out_of_window_rows: d.outOfWindow,
      missing_columns: d.missingColumns,
      neg_qty_rows: d.negQty,
      amount_mismatch_rows: d.amountMismatch,
    })),
    aggregateStats: stats,
    layerAFindings: layerAFindings.map((f) => ({
      severity: f.severity,
      type: f.type,
      message: f.message,
    })),
  });

  try {
    const res = await callClaude({ system, user, tier: choice.tier });
    const parsed = extractJSON<{
      verdict?: string;
      summary?: string;
      issues?: Array<{
        severity?: string;
        type?: string;
        message?: string;
        evidence?: string;
        suggested_fix?: string;
        suggestedFix?: string;
      }>;
      findings?: Array<{
        severity?: string;
        type?: string;
        message?: string;
        evidence?: string;
        suggested_fix?: string;
        suggestedFix?: string;
      }>;
    }>(res.text);
    const raw = parsed.issues ?? parsed.findings ?? [];
    const findings: Finding[] = raw.map((f) => ({
      severity: normalizeSeverity(f.severity),
      type: f.type || "ai_finding",
      source: "layerB",
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
  const findings = [...aFindings, ...b.findings];
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
      ` | Generated: ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
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

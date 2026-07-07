import { createHash } from "crypto";
import puppeteer from "puppeteer";
import type { PlantBundle } from "./plant-engine";
import { getAnthropicClient, modelForDepth, type AnalysisDepth } from "./ai-analytics";

export type { AnalysisDepth };

export interface PlantAnalysisPacket {
  context: {
    month: string;
    snapshot_date: string | null;
    working_days: number;
    elapsed: number;
    remaining: number;
    shifts_per_day: number;
    shift_hours: number;
  };
  plant_kpis: {
    target_max_pcs: number;
    target_min_pcs: number;
    produced_to_date: number;
    required_per_day: number;
    required_cum: number;
    attainment_cum_pct: number | null;
    attainment_month_pct: number | null;
    actual_per_day: number | null;
    best_day_output: number;
    projected_month_end: number | null;
    projected_max_attainment_pct: number | null;
    projected_min_attainment_pct: number | null;
    days_ahead_behind: number | null;
    catchup_per_day: number | null;
    catchup_vs_plan_pct: number | null;
    linearity_index: number | null;
    rag_band: string | null;
  };
  category_breakdown: Array<{
    category: string;
    target_max: number;
    target_min: number;
    produced: number;
    gap_pcs: number;
    attainment_cum_pct: number | null;
    attainment_month_pct: number | null;
    actual_per_day: number | null;
    rag_band: string | null;
  }>;
  daily_series: Array<{
    date: string;
    wd: number;
    actual_pcs: number;
    required_per_day: number;
    cum_actual: number;
    cum_required: number;
  }>;
  variance_pareto: Array<{
    item_code: string;
    colour: string;
    category: string;
    target_max: number;
    produced: number;
    gap_pcs: number;
    attainment_pct: number | null;
  }>;
  mix_flags: Array<{
    item_code: string;
    colour: string;
    category: string;
    target_max: number;
    produced: number;
    reason: string;
  }>;
  warnings: Array<{
    code: string;
    severity: string;
    scope: string;
    message: string;
    value: number | null;
    threshold: number | null;
  }>;
  engine_recommendations: Array<{
    priority: number;
    code: string;
    scope: string;
    action: string;
    rationale: string;
    quantified_impact: string;
    effort: string;
  }>;
  caveats: string[];
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function rNull(n: number | null): number | null {
  return n === null ? null : r2(n);
}

export function buildPlantPacket(
  bundle: PlantBundle & { warnings: Array<{ code: string; severity: string; scope: string; message: string; value: number | null; threshold: number | null; source: string }>; recommendations: Array<{ priority: number; code: string; scope: string; action: string; rationale: string; quantifiedImpact: string; effort: string }> },
): PlantAnalysisPacket {
  return {
    context: {
      month: bundle.context.month,
      snapshot_date: bundle.context.snapshotDate,
      working_days: bundle.context.workingDays,
      elapsed: bundle.context.elapsed,
      remaining: bundle.context.remaining,
      shifts_per_day: bundle.context.shiftsPerDay,
      shift_hours: bundle.context.shiftHours,
    },
    plant_kpis: {
      target_max_pcs: bundle.plant.targetMax,
      target_min_pcs: bundle.plant.targetMin,
      produced_to_date: bundle.plant.producedToDate,
      required_per_day: bundle.plant.requiredPerDay,
      required_cum: bundle.plant.requiredCum,
      attainment_cum_pct: rNull(bundle.plant.attainmentCumPct),
      attainment_month_pct: rNull(bundle.plant.attainmentMonthPct),
      actual_per_day: rNull(bundle.plant.actualPerDay),
      best_day_output: bundle.plant.bestDayOutput,
      projected_month_end: rNull(bundle.plant.projectedMonthEnd),
      projected_max_attainment_pct: rNull(bundle.plant.projectedAttainmentPct),
      projected_min_attainment_pct: rNull(bundle.plant.projectedMinAttainmentPct),
      days_ahead_behind: rNull(bundle.plant.daysAheadBehind),
      catchup_per_day: rNull(bundle.plant.catchUpPerDay),
      catchup_vs_plan_pct: rNull(bundle.plant.catchUpVsPlanPct),
      linearity_index: rNull(bundle.plant.linearityIndex),
      rag_band: bundle.plant.ragBand,
    },
    category_breakdown: bundle.categories.map((c) => ({
      category: c.category,
      target_max: c.targetMax,
      target_min: c.targetMin,
      produced: c.producedToDate,
      gap_pcs: c.gapPcs,
      attainment_cum_pct: rNull(c.attainmentCumPct),
      attainment_month_pct: rNull(c.attainmentMonthPct),
      actual_per_day: rNull(c.actualPerDay),
      rag_band: c.ragBand,
    })),
    daily_series: bundle.dailySeries.slice(0, 10).map((d) => ({
      date: d.date,
      wd: d.workingDayNum,
      actual_pcs: d.actualPcs,
      required_per_day: d.requiredPerDay,
      cum_actual: d.cumulativeActual,
      cum_required: d.cumulativeRequired,
    })),
    variance_pareto: bundle.variancePareto.slice(0, 20).map((i) => ({
      item_code: i.itemCode,
      colour: i.colour,
      category: i.category,
      target_max: i.targetMax,
      produced: i.producedToDate,
      gap_pcs: i.gapPcs,
      attainment_pct: rNull(i.attainmentMonthPct),
    })),
    mix_flags: bundle.mixFlags.slice(0, 20).map((f) => ({
      item_code: f.itemCode,
      colour: f.colour,
      category: f.category,
      target_max: f.targetMax,
      produced: f.producedToDate,
      reason: f.reason,
    })),
    warnings: bundle.warnings.slice(0, 20).map((w) => ({
      code: w.code,
      severity: w.severity,
      scope: w.scope,
      message: w.message,
      value: w.value,
      threshold: w.threshold,
    })),
    engine_recommendations: bundle.recommendations.map((r) => ({
      priority: r.priority,
      code: r.code,
      scope: r.scope,
      action: r.action,
      rationale: r.rationale,
      quantified_impact: r.quantifiedImpact,
      effort: r.effort,
    })),
    caveats: bundle.caveats,
  };
}

export function hashPlantPacket(packet: PlantAnalysisPacket): string {
  return createHash("sha256").update(JSON.stringify(packet)).digest("hex");
}

export const PLANT_SYSTEM_PROMPT = `You are a senior manufacturing operations analyst reviewing plant-level production data for Prayag's PTMT plastics plant.

You will be given a JSON "data packet" containing pre-computed plant KPIs in pieces (NOS): attainment against both Max PP (maximum production plan) and Min PP (minimum production plan), daily pace, category breakdown, variance pareto, mix flags, warnings, and recommendations. This packet is the ONLY source of numeric truth.

Rules:
1. Use ONLY the numbers provided in the packet. NEVER invent, extrapolate, guess, or recompute any figure that is not explicitly present.
2. If a number is needed but not present in the packet, say so explicitly instead of estimating it.
3. Always separate Max PP attainment from Min PP attainment in pp_verdict — these are two distinct targets. Max PP attainment uses attainment_cum_pct; Min PP attainment uses projected_min_attainment_pct.
4. Respect every item in "caveats" — factor them into your analysis and mention material ones as watch items.
5. Be concise, concrete, and shop-floor-actionable. Recommendations must cite specific item codes, category names, or quantities from the packet — not generic advice.
6. Output JSON ONLY, matching exactly this schema. Do NOT wrap the JSON in markdown code fences (no \`\`\`), and do NOT include any commentary, preamble, or explanation outside the JSON object. Your entire response must be a single valid JSON object starting with { and ending with }.
{
  "executive_summary": "2-3 sentences on overall plant NOS attainment status vs both Min PP and Max PP, and the single biggest lever to pull",
  "pp_verdict": {
    "max_pp": {
      "attainment_pct": number_or_null,
      "projected_attainment_pct": number_or_null,
      "rag": "green"|"amber"|"red"|null,
      "verdict": "one sentence on Max PP trajectory"
    },
    "min_pp": {
      "projected_attainment_pct": number_or_null,
      "rag": "green"|"amber"|"red"|null,
      "verdict": "one sentence on Min PP trajectory"
    }
  },
  "key_findings": [{ "finding": string, "evidence": string, "scope": string }],
  "root_cause_hypotheses": [{ "hypothesis": string, "supporting_signal": string, "confidence": "high"|"med"|"low" }],
  "risks": [{ "risk": string, "severity": "Critical"|"High"|"Medium", "basis": string }],
  "recommendations": [{ "action": string, "rationale": string, "quantified_impact": string, "priority": number, "effort": "low"|"med"|"high", "scope": string }],
  "watch_items": [string]
}`;

export function buildPlantUserMessage(packet: PlantAnalysisPacket): string {
  return `Here is this month's PTMT plant-level NOS production data packet:\n\n${JSON.stringify(packet)}\n\nProduce your analysis strictly as the JSON schema specified in the system prompt. Remember: always separate Max PP and Min PP verdicts in pp_verdict using the provided attainment fields.`;
}

export interface PlantAnalysisResult {
  executive_summary: string;
  pp_verdict: {
    max_pp: {
      attainment_pct: number | null;
      projected_attainment_pct: number | null;
      rag: "green" | "amber" | "red" | null;
      verdict: string;
    };
    min_pp: {
      projected_attainment_pct: number | null;
      rag: "green" | "amber" | "red" | null;
      verdict: string;
    };
  };
  key_findings: Array<{ finding: string; evidence: string; scope: string }>;
  root_cause_hypotheses: Array<{ hypothesis: string; supporting_signal: string; confidence: "high" | "med" | "low" }>;
  risks: Array<{ risk: string; severity: "Critical" | "High" | "Medium"; basis: string }>;
  recommendations: Array<{
    action: string;
    rationale: string;
    quantified_impact: string;
    priority: number;
    effort: "low" | "med" | "high";
    scope: string;
  }>;
  watch_items: string[];
}

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function ppRagStyle(rag: string | null | undefined): string {
  if (rag === "green") return "background:#d9ead3;color:#274e13;padding:2px 8px;border-radius:3px;font-size:11px;";
  if (rag === "amber") return "background:#fce5cd;color:#7f4f24;padding:2px 8px;border-radius:3px;font-size:11px;";
  if (rag === "red") return "background:#f4cccc;color:#660000;padding:2px 8px;border-radius:3px;font-size:11px;";
  return "background:#efefef;color:#444;padding:2px 8px;border-radius:3px;font-size:11px;";
}

function severityStyle(sev: string): string {
  if (sev === "Critical") return "background:#f4cccc;";
  if (sev === "High") return "background:#fce5cd;";
  return "background:#fff2cc;";
}

export async function exportPlantAnalysisPdf(params: {
  month: string;
  depth: AnalysisDepth;
  model: string;
  createdAt: Date;
  result: PlantAnalysisResult | null;
}): Promise<Buffer> {
  const { month, depth, model, createdAt, result } = params;
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { font-family: Arial, sans-serif; padding: 24px; color: #1a1a1a; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  h2 { font-size: 15px; margin-top: 24px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  .meta { color: #666; font-size: 12px; margin-bottom: 16px; }
  ul { padding-left: 18px; }
  li { margin-bottom: 8px; font-size: 13px; }
  .badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 11px; margin-right: 6px; }
  .critical { background: #f4cccc; } .high { background: #fce5cd; } .medium { background: #fff2cc; }
  .pp-grid { display: flex; gap: 16px; margin-bottom: 8px; }
  .pp-card { flex: 1; border: 1px solid #ddd; border-radius: 6px; padding: 12px; }
  .pp-card h3 { font-size: 13px; margin: 0 0 6px; }
</style></head>
<body>
  <h1>PTMT Plant AI Analytics — ${esc(month)}</h1>
  <div class="meta">Depth: ${esc(depth)} · Model: ${esc(model)} · Generated: ${createdAt.toISOString()}</div>
  ${
    !result
      ? "<p>No analysis result available.</p>"
      : `
  <h2>Executive Summary</h2>
  <p>${esc(result.executive_summary)}</p>
  <h2>PP Verdict</h2>
  <div class="pp-grid">
    <div class="pp-card">
      <h3>Max PP</h3>
      <span style="${ppRagStyle(result.pp_verdict.max_pp.rag)}">${esc(result.pp_verdict.max_pp.rag ?? "n/a")}</span>
      <p style="font-size:13px;margin-top:6px;">${esc(result.pp_verdict.max_pp.verdict)}</p>
      <p style="font-size:12px;color:#666;">Attainment: ${result.pp_verdict.max_pp.attainment_pct ?? "n/a"}% · Projected: ${result.pp_verdict.max_pp.projected_attainment_pct ?? "n/a"}%</p>
    </div>
    <div class="pp-card">
      <h3>Min PP</h3>
      <span style="${ppRagStyle(result.pp_verdict.min_pp.rag)}">${esc(result.pp_verdict.min_pp.rag ?? "n/a")}</span>
      <p style="font-size:13px;margin-top:6px;">${esc(result.pp_verdict.min_pp.verdict)}</p>
      <p style="font-size:12px;color:#666;">Projected: ${result.pp_verdict.min_pp.projected_attainment_pct ?? "n/a"}%</p>
    </div>
  </div>
  <h2>Key Findings</h2>
  <ul>${result.key_findings.map((f) => `<li><strong>${esc(f.scope)}:</strong> ${esc(f.finding)} <em>(${esc(f.evidence)})</em></li>`).join("")}</ul>
  <h2>Root Cause Hypotheses</h2>
  <ul>${result.root_cause_hypotheses.map((h) => `<li>${esc(h.hypothesis)} — <em>${esc(h.supporting_signal)}</em> [confidence: ${esc(h.confidence)}]</li>`).join("")}</ul>
  <h2>Risks</h2>
  <ul>${result.risks.map((r) => `<li><span class="badge" style="${severityStyle(r.severity)}">${esc(r.severity)}</span>${esc(r.risk)} — ${esc(r.basis)}</li>`).join("")}</ul>
  <h2>Recommendations</h2>
  <ul>${result.recommendations
    .sort((a, b) => a.priority - b.priority)
    .map(
      (r) =>
        `<li>(#${r.priority}, effort: ${esc(r.effort)}, scope: ${esc(r.scope)}) <strong>${esc(r.action)}</strong> — ${esc(r.rationale)}. Impact: ${esc(r.quantified_impact)}</li>`,
    )
    .join("")}</ul>
  <h2>Watch Items</h2>
  <ul>${result.watch_items.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>
  `
  }
</body></html>`;

  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfUint8 = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "12mm", bottom: "12mm", left: "10mm", right: "10mm" },
    });
    return Buffer.from(pdfUint8);
  } finally {
    await browser.close();
  }
}

export { getAnthropicClient, modelForDepth };

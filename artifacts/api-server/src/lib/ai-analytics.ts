import { createHash } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { launchBrowser } from "./browser";
import type { MonitoringBundle } from "../routes/monitoring";
import { buildWarningsList } from "../routes/monitoring";
import { ragBand, buildRecommendedActions, type PaceMetrics } from "./monitoring-calc";

export type AnalysisDepth = "standard" | "deep";

export const STANDARD_MODEL = "claude-sonnet-4-6";
export const DEEP_MODEL = "claude-opus-4-8";

export function modelForDepth(depth: AnalysisDepth): string {
  return depth === "deep" ? DEEP_MODEL : STANDARD_MODEL;
}

let anthropicClient: Anthropic | null = null;
export function getAnthropicClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropicClient;
}

function paceMetricsPacket(pace: PaceMetrics) {
  return {
    target_kg: round(pace.targetKg),
    output_kg_to_date: round(pace.outputToDateKg),
    attainment_pct: round(pace.attainmentPct),
    pace_index: round(pace.paceIndex),
    actual_per_day: round(pace.actualPerDay),
    required_per_day: round(pace.requiredPerDay),
    projected_month_end: round(pace.projectedMonthEnd),
    projected_attainment_pct: round(pace.projectedAttainmentPct),
    days_ahead_behind: round(pace.daysAheadBehind),
    catchup_per_day: round(pace.catchUpPerDay),
  };
}

function round(n: number | null): number | null {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  return Math.round(n * 100) / 100;
}

export interface AnalysisPacket {
  month: string;
  snapshot_date: string | null;
  working_days: number;
  elapsed: number;
  remaining: number;
  data_available: boolean;
  plant: ReturnType<typeof paceMetricsPacket> & { rag_band: string | null };
  categories: Array<ReturnType<typeof paceMetricsPacket> & { name: string; rag_band: string | null }>;
  top_behind_items: Array<{ item_code: string; colour: string; category: string; stock: number; pending_order: number }>;
  top_rejecting_machines: Array<{ machine: string; rejection_pct: number | null; utilisation_pct: number | null }>;
  warnings: Array<{ code: string; severity: string; scope: string; message: string; value: number | null; threshold: number | null }>;
  recommended_actions: Array<{ priority: number; code: string; scope: string; message: string; suggested_qty: number | null }>;
  caveats: string[];
  needs_review: Array<{ item_code: string; colour: string; category: string }>;
}

export function buildAnalysisPacket(month: string, bundle: MonitoringBundle): AnalysisPacket {
  const warnings = buildWarningsList(month, bundle);
  const actions = buildRecommendedActions(bundle.plantPace, bundle.categoryPaces, bundle.stockoutItems, bundle.thresholds);

  const topRejecting = [...bundle.machineQuality]
    .filter((m) => m.rejectionPct !== null)
    .sort((a, b) => (b.rejectionPct ?? 0) - (a.rejectionPct ?? 0))
    .slice(0, 5)
    .map((m) => ({ machine: m.machineId, rejection_pct: round(m.rejectionPct), utilisation_pct: round(m.utilisationPct) }));

  const caveats: string[] = [];
  if (!bundle.dataAvailable) caveats.push(`No Report-5 daily data available for ${month}.`);
  if (bundle.needsReviewItems.length > 0) {
    caveats.push(`${bundle.needsReviewItems.length} item(s) have no weight entered and are excluded from kg attainment.`);
  }

  return {
    month,
    snapshot_date: bundle.lastDataDate,
    working_days: bundle.calendarPlant.workingDays,
    elapsed: bundle.calendarPlant.elapsed,
    remaining: bundle.calendarPlant.remaining,
    data_available: bundle.dataAvailable,
    plant: { ...paceMetricsPacket(bundle.plantPace), rag_band: ragBand(bundle.plantPace.attainmentPct) },
    categories: bundle.categoryPaces.map((c) => ({
      name: c.category,
      ...paceMetricsPacket(c.pace),
      rag_band: ragBand(c.pace.attainmentPct),
    })),
    top_behind_items: bundle.stockoutItems.slice(0, 10).map((i) => ({
      item_code: i.itemCode,
      colour: i.colour,
      category: i.category,
      stock: i.stock,
      pending_order: i.pendingOrder,
    })),
    top_rejecting_machines: topRejecting,
    warnings: warnings.slice(0, 20).map((w) => ({
      code: w.code,
      severity: w.severity,
      scope: w.scope,
      message: w.message,
      value: w.value,
      threshold: w.threshold,
    })),
    recommended_actions: actions.map((a) => ({
      priority: a.priority,
      code: a.code,
      scope: a.scope,
      message: a.message,
      suggested_qty: a.suggestedQty,
    })),
    caveats,
    needs_review: bundle.needsReviewItems.map((i) => ({ item_code: i.itemCode, colour: i.colour, category: i.category })),
  };
}

export function hashPacket(packet: AnalysisPacket): string {
  return createHash("sha256").update(JSON.stringify(packet)).digest("hex");
}

export const SYSTEM_PROMPT = `You are a senior manufacturing operations analyst reviewing production data for Prayag's PTMT plastics plant.

You will be given a JSON "data packet" containing pre-computed production metrics (attainment, pace, quality, backlog, warnings). This packet is the ONLY source of numeric truth.

Rules:
1. Use ONLY the numbers provided in the packet. NEVER invent, extrapolate, guess, or recompute any figure that is not explicitly present.
2. If a number is needed but not present in the packet, say so explicitly instead of estimating it.
3. Respect every item in "caveats" and "needs_review" — factor them into your analysis and mention material ones as watch items.
4. Be concise, concrete, and shop-floor-actionable. Recommendations must be specific (what to do, where, and the quantified impact using packet numbers) — not generic advice.
5. Output JSON ONLY, matching exactly this schema. Do NOT wrap the JSON in markdown code fences (no \`\`\`), and do NOT include any commentary, preamble, or explanation outside the JSON object. Your entire response must be a single valid JSON object starting with { and ending with }.
{
  "executive_summary": "2-3 sentences on overall status and the single biggest lever to pull",
  "key_findings": [{ "finding": string, "evidence": string, "scope": string }],
  "root_cause_hypotheses": [{ "hypothesis": string, "supporting_signal": string, "confidence": "high"|"med"|"low" }],
  "risks": [{ "risk": string, "severity": "Critical"|"High"|"Medium", "basis": string }],
  "recommendations": [{ "action": string, "rationale": string, "quantified_impact": string, "priority": number, "effort": "low"|"med"|"high", "scope": string }],
  "watch_items": [string]
}`;

export function buildUserMessage(packet: AnalysisPacket): string {
  return `Here is this month's PTMT production data packet:\n\n${JSON.stringify(packet)}\n\nProduce your analysis strictly as the JSON schema specified in the system prompt.`;
}

export interface AnalysisResult {
  executive_summary: string;
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

export async function exportAiAnalysisPdf(params: {
  month: string;
  depth: AnalysisDepth;
  model: string;
  createdAt: Date;
  result: AnalysisResult | null;
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
  </style></head>
  <body>
    <h1>PTMT AI Analytics — ${esc(month)}</h1>
    <div class="meta">Depth: ${esc(depth)} · Model: ${esc(model)} · Generated: ${createdAt.toISOString()}</div>
    ${
      !result
        ? "<p>No analysis result available.</p>"
        : `
    <h2>Executive Summary</h2>
    <p>${esc(result.executive_summary)}</p>
    <h2>Key Findings</h2>
    <ul>${result.key_findings.map((f) => `<li><strong>${esc(f.scope)}:</strong> ${esc(f.finding)} <em>(${esc(f.evidence)})</em></li>`).join("")}</ul>
    <h2>Root Cause Hypotheses</h2>
    <ul>${result.root_cause_hypotheses.map((h) => `<li>${esc(h.hypothesis)} — <em>${esc(h.supporting_signal)}</em> [confidence: ${esc(h.confidence)}]</li>`).join("")}</ul>
    <h2>Risks</h2>
    <ul>${result.risks.map((r) => `<li><span class="badge ${r.severity.toLowerCase()}">${esc(r.severity)}</span>${esc(r.risk)} — ${esc(r.basis)}</li>`).join("")}</ul>
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

  const browser = await launchBrowser();
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

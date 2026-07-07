import type { PlantBundle } from "./plant-engine";
import type { PlantWarning } from "./plant-warnings";
import type { PlantRecommendation } from "./plant-recommendations";

export type FullBundle = PlantBundle & { warnings: PlantWarning[]; recommendations: PlantRecommendation[] };

const h = (v: unknown) => String(v ?? "–").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pct = (n: number | null | undefined, d = 1) => (n !== null && n !== undefined ? `${n.toFixed(d)}%` : "–");
const num = (n: number | null | undefined, d = 0) =>
  n !== null && n !== undefined ? n.toLocaleString("en-GB", { maximumFractionDigits: d }) : "–";

function ragLabel(band: string | null) {
  if (band === "green") return "ON TRACK";
  if (band === "amber") return "AT RISK";
  if (band === "red") return "WILL MISS";
  return "UNKNOWN";
}
function ragBg(band: string | null) {
  if (band === "green") return "#d1fae5";
  if (band === "amber") return "#fef3c7";
  if (band === "red") return "#fee2e2";
  return "#f1f5f9";
}
function ragFg(band: string | null) {
  if (band === "green") return "#065f46";
  if (band === "amber") return "#92400e";
  if (band === "red") return "#991b1b";
  return "#475569";
}
function ragBorder(band: string | null) {
  if (band === "green") return "#10b981";
  if (band === "amber") return "#f59e0b";
  if (band === "red") return "#ef4444";
  return "#94a3b8";
}

function minBand(pctVal: number | null): string | null {
  if (pctVal === null) return null;
  if (pctVal >= 95) return "green";
  if (pctVal >= 85) return "amber";
  return "red";
}

function buildHtml(bundle: FullBundle, aiNarrative: string | null, generatedAt: string): string {
  const { plant, categories, warnings, recommendations, context } = bundle;
  const rag = plant.ragBand;
  const minRag = minBand(plant.projectedMinAttainmentPct);
  const snapshotStr = context.snapshotDate ?? "latest";

  const topWarnings = [...warnings]
    .sort((a, b) => {
      const ord = { critical: 0, high: 1, medium: 2, info: 3 };
      return (ord[a.severity] ?? 4) - (ord[b.severity] ?? 4);
    })
    .slice(0, 3);

  const topRecs = recommendations.slice(0, 3);

  const css = `
    @page { size: A4 portrait; margin: 14mm 16mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 10px; color: #1e293b; line-height: 1.5; }
    h2 { font-size: 11px; font-weight: bold; margin: 16px 0 6px; color: #0f172a; border-bottom: 1.5px solid #e2e8f0; padding-bottom: 3px; }
    .header-bar { background: #1e293b; color: white; padding: 10px 14px; margin-bottom: 12px; }
    .header-bar .title { font-size: 16px; font-weight: bold; margin-bottom: 2px; }
    .header-bar .sub { font-size: 9.5px; opacity: 0.75; }
    .verdict { padding: 8px 14px; border-radius: 4px; font-size: 13px; font-weight: bold; margin-bottom: 12px; border-left: 5px solid; }
    .kpi-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 12px; }
    .kpi { border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 14px; background: white; }
    .kpi .lbl { font-size: 8.5px; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 4px; }
    .kpi .val { font-size: 22px; font-weight: bold; }
    .kpi .sub { font-size: 8.5px; color: #64748b; margin-top: 2px; }
    table { border-collapse: collapse; width: 100%; font-size: 9.5px; }
    th { background: #f1f5f9; font-weight: bold; padding: 5px 8px; border: 1px solid #cbd5e1; text-align: left; }
    td { padding: 4px 8px; border: 1px solid #e2e8f0; }
    .rag-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
    .risk-item { border-left: 3px solid; border-radius: 2px; padding: 6px 10px; margin-bottom: 6px; }
    .footer { color: #94a3b8; font-size: 8px; margin-top: 16px; border-top: 1px solid #e2e8f0; padding-top: 5px; }
    .ai-box { border: 1px dashed #7c3aed; border-radius: 4px; padding: 8px 10px; margin: 8px 0; background: #faf5ff; }
    .ai-label { color: #7c3aed; font-size: 8px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
  `;

  const verdictHtml = `
    <div class="verdict" style="background:${ragBg(rag)};color:${ragFg(rag)};border-left-color:${ragBorder(rag)}">
      PTMT — ${h(context.month)} &nbsp;·&nbsp; Working Day ${h(context.elapsed)} of ${h(context.workingDays)}
      &nbsp;|&nbsp; Min PP: <span style="color:${ragBorder(minRag)}">${ragLabel(minRag)}</span>
      &nbsp;|&nbsp; Max PP: <span style="color:${ragBorder(rag)}">${ragLabel(rag)}</span>
    </div>`;

  const kpiTiles = `
    <div class="kpi-grid">
      <div class="kpi">
        <div class="lbl">Max PP Attainment (cum)</div>
        <div class="val" style="color:${ragBorder(rag)}">${pct(plant.attainmentCumPct)}</div>
        <div class="sub">Projected month-end: ${pct(plant.projectedAttainmentPct)}</div>
      </div>
      <div class="kpi">
        <div class="lbl">Min PP Attainment (projected)</div>
        <div class="val" style="color:${ragBorder(minRag)}">${pct(plant.projectedMinAttainmentPct)}</div>
        <div class="sub">Target Min: ${num(plant.targetMin)} pcs</div>
      </div>
      <div class="kpi">
        <div class="lbl">Days Ahead / Behind</div>
        <div class="val" style="color:${(plant.daysAheadBehind ?? 0) < 0 ? "#ef4444" : "#10b981"}">
          ${plant.daysAheadBehind !== null ? (plant.daysAheadBehind >= 0 ? `+${plant.daysAheadBehind.toFixed(1)}` : plant.daysAheadBehind.toFixed(1)) : "–"}
        </div>
        <div class="sub">Produced: ${num(plant.producedToDate)} / ${num(plant.targetMax)} pcs</div>
      </div>
      <div class="kpi">
        <div class="lbl">Catch-Up Required / Day</div>
        <div class="val" style="color:${(plant.catchUpPerDay ?? 0) > (plant.requiredPerDay ?? 0) * 1.15 ? "#ef4444" : "#0f172a"}">${num(plant.catchUpPerDay, 0)}</div>
        <div class="sub">vs plan: ${num(plant.requiredPerDay, 0)} pcs/day required</div>
      </div>
    </div>`;

  const catRows = categories.map((c) => {
    const catRag = c.ragBand;
    return `<tr>
      <td>${h(c.category)}</td>
      <td style="text-align:right">${pct(c.attainmentCumPct)}</td>
      <td style="text-align:right">${pct(c.projectedAttainmentPct)}</td>
      <td style="text-align:center">
        <span class="rag-dot" style="background:${ragBorder(catRag)}"></span>
        &nbsp;${ragLabel(catRag)}
      </td>
    </tr>`;
  }).join("");
  const catTable = `
    <h2>Category Status</h2>
    <table>
      <thead><tr><th>Category</th><th style="text-align:right">Cum Att %</th><th style="text-align:right">Proj End %</th><th style="text-align:center">Status</th></tr></thead>
      <tbody>${catRows}</tbody>
    </table>`;

  const riskColors = { critical: "#ef4444", high: "#f59e0b", medium: "#f59e0b", info: "#3b82f6" };
  const risksHtml = topWarnings.length > 0
    ? topWarnings.map((w: PlantWarning, i: number) => `
        <div class="risk-item" style="border-left-color:${riskColors[w.severity] ?? "#94a3b8"};background:${ragBg(w.severity === "critical" || w.severity === "high" ? "red" : w.severity === "medium" ? "amber" : null)}">
          <div style="font-weight:bold;font-size:9.5px">#${i + 1} — ${h(w.scope)}: ${h(w.message)}</div>
          <div style="font-size:8.5px;color:#475569">Severity: ${h(w.severity.toUpperCase())} &nbsp;|&nbsp; Code: ${h(w.code)} ${w.value !== null ? `&nbsp;|&nbsp; Value: ${w.value}` : ""} ${w.threshold !== null ? `(threshold: ${w.threshold})` : ""}</div>
        </div>`).join("")
    : `<p style="color:#065f46;font-size:9px;padding:6px">No critical or high risks active.</p>`;

  const decsHtml = topRecs.length > 0
    ? topRecs.map((r: PlantRecommendation, i: number) => `
        <div class="risk-item" style="border-left-color:#7c3aed;background:#faf5ff">
          <div style="font-weight:bold;font-size:9.5px">#${i + 1} — ${h(r.code)}: ${h(r.action)}</div>
          <div style="font-size:8.5px;color:#6d28d9">${h(r.quantifiedImpact)}</div>
        </div>`).join("")
    : `<p style="color:#065f46;font-size:9px;padding:6px">No priority actions — plant is on track.</p>`;

  const footer = `
    <div class="footer">
      Generated ${h(generatedAt)} &nbsp;·&nbsp; PTMT Production &nbsp;·&nbsp; All data from deterministic plant engine.
      ${aiNarrative ? "AI Analyst narrative included and labelled." : ""}
    </div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
    <div class="header-bar">
      <div class="title">PTMT — CEO Report</div>
      <div class="sub">${h(context.month)} &nbsp;·&nbsp; WD ${h(context.elapsed)}/${h(context.workingDays)} &nbsp;·&nbsp; Snapshot: ${h(snapshotStr)} &nbsp;·&nbsp; ${h(generatedAt)}</div>
    </div>
    ${verdictHtml}
    ${kpiTiles}
    ${catTable}
    <h2>Top Risks to Production Plan</h2>
    ${risksHtml}
    <h2>Priority Decisions / Actions Required</h2>
    ${decsHtml}
    ${aiNarrative ? `
    <div class="ai-box">
      <div class="ai-label">⚠ AI Analyst Summary (AI-generated — verify numbers above)</div>
      <div style="font-size:9px;color:#1e293b;white-space:pre-line">${h(aiNarrative)}</div>
    </div>` : ""}
    ${footer}
  </body></html>`;
}

export async function generateCeoPdf(bundle: FullBundle, aiNarrative: string | null): Promise<Buffer> {
  const generatedAt = new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  const html = buildHtml(bundle, aiNarrative, generatedAt);
  const puppeteer = (await import("puppeteer")).default;
  const browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      format: "A4",
      landscape: false,
      printBackground: true,
      margin: { top: "12mm", bottom: "12mm", left: "14mm", right: "14mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

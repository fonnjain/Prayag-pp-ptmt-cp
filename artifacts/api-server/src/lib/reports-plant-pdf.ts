import puppeteer from "puppeteer";
import type { PlantBundle, CategoryKPIs, ItemKPIs, DayRecord, MixFlag } from "./plant-engine";
import type { PlantWarning } from "./plant-warnings";
import type { PlantRecommendation } from "./plant-recommendations";

export type FullBundle = PlantBundle & { warnings: PlantWarning[]; recommendations: PlantRecommendation[] };

const h = (v: unknown) => String(v ?? "–").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pct = (n: number | null | undefined, d = 1) => (n !== null && n !== undefined ? `${n.toFixed(d)}%` : "–");
const num = (n: number | null | undefined, d = 0) =>
  n !== null && n !== undefined ? n.toLocaleString("en-GB", { maximumFractionDigits: d }) : "–";

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
function ragLabel(band: string | null) {
  if (band === "green") return "ON TRACK";
  if (band === "amber") return "AT RISK";
  if (band === "red") return "WILL MISS";
  return "UNKNOWN";
}

function buildSCurve(dailySeries: DayRecord[], targetMax: number, workingDays: number, ragBand: string | null): string {
  if (dailySeries.length === 0 || targetMax <= 0) return "<p style='color:#64748b;font-size:9px'>No daily series data available.</p>";
  const W = 680, H = 210;
  const PAD = { t: 15, r: 20, b: 30, l: 60 };
  const cw = W - PAD.l - PAD.r, ch = H - PAD.t - PAD.b;
  const yMax = targetMax * 1.05;
  const xs = (d: number) => PAD.l + (d / workingDays) * cw;
  const ys = (v: number) => PAD.t + ch - (v / yMax) * ch;
  const last = dailySeries[dailySeries.length - 1];
  const actualColor = ragBorder(ragBand);

  const reqLine = `M ${xs(0)} ${ys(0)} L ${xs(workingDays)} ${ys(targetMax)}`;
  const actualPts = dailySeries.map((d) => `${xs(d.workingDayNum)} ${ys(d.cumulativeActual)}`).join(" L ");
  const actualLine = `M ${xs(0)} ${ys(0)} L ${actualPts}`;

  let projLine = "";
  if (last && last.workingDayNum < workingDays) {
    const avgPace = last.cumulativeActual / last.workingDayNum;
    const projEnd = Math.min(last.cumulativeActual + avgPace * (workingDays - last.workingDayNum), yMax);
    projLine = `M ${xs(last.workingDayNum)} ${ys(last.cumulativeActual)} L ${xs(workingDays)} ${ys(projEnd)}`;
  }

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const val = yMax * f;
    const y = ys(val);
    const lbl = val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val.toFixed(0);
    return `<line x1="${PAD.l}" y1="${y}" x2="${PAD.l + cw}" y2="${y}" stroke="#e2e8f0" stroke-width="0.5"/>
            <text x="${PAD.l - 4}" y="${y + 3}" text-anchor="end" font-size="8" fill="#64748b">${lbl}</text>`;
  });

  const xLabels = [];
  const step = workingDays <= 20 ? 5 : 7;
  for (let d = 0; d <= workingDays; d += step) {
    xLabels.push(`<text x="${xs(d)}" y="${H - 4}" text-anchor="middle" font-size="8" fill="#64748b">${d}</text>`);
  }

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${PAD.l}" y="${PAD.t}" width="${cw}" height="${ch}" fill="#f8fafc" stroke="#e2e8f0"/>
    ${gridLines.join("")}
    ${xLabels.join("")}
    <text x="${PAD.l + cw / 2}" y="${H}" text-anchor="middle" font-size="8" fill="#64748b">Working Day</text>
    <line x1="${PAD.l}" y1="${PAD.t + ch}" x2="${PAD.l + cw}" y2="${PAD.t + ch}" stroke="#94a3b8" stroke-width="1"/>
    <line x1="${PAD.l}" y1="${PAD.t}" x2="${PAD.l}" y2="${PAD.t + ch}" stroke="#94a3b8" stroke-width="1"/>
    <path d="${reqLine}" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="5,3" fill="none"/>
    ${projLine ? `<path d="${projLine}" stroke="${actualColor}" stroke-width="1" stroke-dasharray="3,3" fill="none" opacity="0.6"/>` : ""}
    <path d="${actualLine}" stroke="${actualColor}" stroke-width="2" fill="none"/>
    <circle cx="${xs(last.workingDayNum)}" cy="${ys(last.cumulativeActual)}" r="3" fill="${actualColor}"/>
    <text x="${PAD.l + cw - 4}" y="${PAD.t + 10}" text-anchor="end" font-size="7.5" fill="#94a3b8">─ ─  Required</text>
    <text x="${PAD.l + cw - 4}" y="${PAD.t + 20}" text-anchor="end" font-size="7.5" fill="${actualColor}">——  Actual</text>
  </svg>`;
}

function verdictStr(bundle: FullBundle): string {
  const { plant } = bundle;
  const max = ragLabel(plant.ragBand);
  const minBand = plant.projectedMinAttainmentPct !== null
    ? (plant.projectedMinAttainmentPct >= 95 ? "green" : plant.projectedMinAttainmentPct >= 85 ? "amber" : "red")
    : null;
  const min = ragLabel(minBand);
  return `Min PP: <b>${h(min)}</b> &nbsp;|&nbsp; Max PP: <b>${h(max)}</b>`;
}

function buildHtml(bundle: FullBundle, aiNarrative: string | null, generatedAt: string): string {
  const { plant, categories, items, dailySeries, variancePareto, mixFlags, warnings, recommendations, context } = bundle;
  const rag = bundle.plant.ragBand;
  const snapshotStr = context.snapshotDate ?? "latest";

  const css = `
    @page { size: A4 landscape; margin: 10mm 12mm 10mm 12mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 9px; color: #1e293b; line-height: 1.4; }
    h1 { font-size: 18px; font-weight: bold; }
    h2 { font-size: 12px; font-weight: bold; margin: 14px 0 6px; color: #0f172a; border-bottom: 1.5px solid #e2e8f0; padding-bottom: 3px; }
    h3 { font-size: 10px; font-weight: bold; margin: 10px 0 4px; color: #334155; }
    .page-break { page-break-before: always; }
    .header-bar { background: #1e293b; color: white; padding: 8px 14px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    .header-bar .brand { font-size: 11px; font-weight: bold; letter-spacing: 0.05em; opacity: 0.7; }
    .header-bar .stamp { font-size: 9px; opacity: 0.8; }
    table { border-collapse: collapse; width: 100%; font-size: 8.5px; }
    th { background: #f1f5f9; font-weight: bold; padding: 4px 6px; border: 1px solid #cbd5e1; text-align: right; white-space: nowrap; }
    th.left, td.left { text-align: left; }
    td { padding: 3px 6px; border: 1px solid #e2e8f0; text-align: right; }
    tr:nth-child(even) td { background: #f8fafc; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 10px 0; }
    .kpi { border: 1px solid #e2e8f0; border-radius: 4px; padding: 7px 10px; background: white; }
    .kpi .lbl { font-size: 7.5px; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 2px; }
    .kpi .val { font-size: 16px; font-weight: bold; color: #0f172a; }
    .kpi .sub { font-size: 8px; color: #64748b; margin-top: 1px; }
    .rag-chip { display: inline-block; padding: 1px 6px; border-radius: 10px; font-size: 7.5px; font-weight: bold; }
    .flex-row { display: flex; gap: 10px; align-items: flex-start; }
    .verdict-box { padding: 8px 14px; border-radius: 4px; margin-bottom: 8px; border-left: 4px solid; }
    .sev-critical { color: #991b1b; } .sev-high { color: #92400e; } .sev-medium { color: #78350f; } .sev-info { color: #1e40af; }
    .footer { color: #94a3b8; font-size: 8px; margin-top: 12px; border-top: 1px solid #e2e8f0; padding-top: 4px; }
    .ai-box { border: 1px dashed #7c3aed; border-radius: 4px; padding: 8px 10px; margin: 8px 0; background: #faf5ff; }
    .ai-box .ai-label { color: #7c3aed; font-size: 8px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  `;

  function pageHeader(title: string) {
    return `<div class="header-bar"><span class="brand">PTMT — PLANT MANAGER REPORT</span><span class="stamp">${h(context.month)} &nbsp;·&nbsp; WD ${h(context.elapsed)}/${h(context.workingDays)} &nbsp;·&nbsp; Snapshot: ${h(snapshotStr)} &nbsp;·&nbsp; ${h(title)}</span></div>`;
  }

  // ── COVER ──────────────────────────────────────────────────────────────────
  const cover = `
    <div style="background:#1e293b;color:white;padding:16px 20px;margin-bottom:12px;">
      <div style="font-size:11px;opacity:0.6;font-weight:bold;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:4px;">PTMT PRODUCTION</div>
      <div style="font-size:22px;font-weight:bold;margin-bottom:2px;">Plant Manager Report</div>
      <div style="font-size:11px;opacity:0.75;">${h(context.month)} &nbsp;·&nbsp; Working Day ${h(context.elapsed)} of ${h(context.workingDays)} &nbsp;·&nbsp; Snapshot: ${h(snapshotStr)} &nbsp;·&nbsp; Generated: ${h(generatedAt)}</div>
    </div>
    <div class="verdict-box" style="background:${ragBg(rag)};color:${ragFg(rag)};border-left-color:${ragBorder(rag)};font-size:13px;font-weight:bold;">
      OVERALL VERDICT: ${h(ragLabel(rag))} &nbsp;|&nbsp; ${verdictStr(bundle)}
    </div>
    <div class="kpi-grid">
      <div class="kpi"><div class="lbl">Produced to Date (pcs)</div><div class="val">${num(plant.producedToDate)}</div><div class="sub">Target Max: ${num(plant.targetMax)}</div></div>
      <div class="kpi"><div class="lbl">Cum. Attainment %</div><div class="val" style="color:${ragBorder(rag)}">${pct(plant.attainmentCumPct)}</div><div class="sub">Required: ${num(plant.requiredCum)} pcs by today</div></div>
      <div class="kpi"><div class="lbl">Projected Month-End</div><div class="val">${pct(plant.projectedAttainmentPct)}</div><div class="sub">Proj. pcs: ${num(plant.projectedMonthEnd)}</div></div>
      <div class="kpi"><div class="lbl">Days Ahead / Behind</div><div class="val" style="color:${(plant.daysAheadBehind ?? 0) < 0 ? "#ef4444" : "#10b981"}">${plant.daysAheadBehind !== null ? (plant.daysAheadBehind >= 0 ? `+${plant.daysAheadBehind.toFixed(1)}` : plant.daysAheadBehind.toFixed(1)) : "–"}</div><div class="sub">Catch-up: ${num(plant.catchUpPerDay)} pcs/day needed</div></div>
    </div>`;

  // ── EXECUTIVE SNAPSHOT ─────────────────────────────────────────────────────
  const execSnap = `
    <div class="page-break">${pageHeader("Executive Snapshot")}</div>
    <h2>Executive Snapshot — Plant KPIs</h2>
    <table>
      <thead><tr>
        <th class="left">Metric</th><th>Value</th><th class="left">Metric</th><th>Value</th>
      </tr></thead>
      <tbody>
        ${[
          ["Target Max (pcs)", num(plant.targetMax), "Target Min (pcs)", num(plant.targetMin)],
          ["Produced to Date", num(plant.producedToDate), "Required Cum (to today)", num(plant.requiredCum)],
          ["Cum Attainment %", pct(plant.attainmentCumPct), "Month Attainment %", pct(plant.attainmentMonthPct)],
          ["Required / Day", num(plant.requiredPerDay, 0), "Actual / Day", num(plant.actualPerDay, 0)],
          ["Projected Month-End (pcs)", num(plant.projectedMonthEnd), "Projected Max Att %", pct(plant.projectedAttainmentPct)],
          ["Projected Min Att %", pct(plant.projectedMinAttainmentPct), "Days Ahead / Behind", plant.daysAheadBehind !== null ? (plant.daysAheadBehind >= 0 ? `+${plant.daysAheadBehind.toFixed(1)}` : String(plant.daysAheadBehind.toFixed(1))) : "–"],
          ["Catch-Up / Day", num(plant.catchUpPerDay, 0), "Catch-Up vs Plan %", pct(plant.catchUpVsPlanPct)],
          ["Linearity Index", plant.linearityIndex !== null ? plant.linearityIndex.toFixed(2) : "–", "RAG Band", ragLabel(plant.ragBand)],
        ].map(([m1, v1, m2, v2]) => `<tr><td class="left">${h(m1)}</td><td><b>${h(v1)}</b></td><td class="left">${h(m2)}</td><td><b>${h(v2)}</b></td></tr>`).join("")}
      </tbody>
    </table>`;

  // ── CONTROL BOARD + VELOCITY ───────────────────────────────────────────────
  const scurveSvg = buildSCurve(dailySeries, plant.targetMax, context.workingDays, rag);
  const controlBoard = `
    <div class="page-break">${pageHeader("Control Board & Velocity")}</div>
    <div class="two-col">
      <div>
        <h2>Production Burn-Up (S-Curve)</h2>
        ${scurveSvg}
      </div>
      <div>
        <h2>Daily Pace Metrics</h2>
        <table>
          <thead><tr><th class="left">Metric</th><th>Value</th></tr></thead>
          <tbody>
            <tr><td class="left">Required pcs / day</td><td><b>${num(plant.requiredPerDay, 0)}</b></td></tr>
            <tr><td class="left">Actual pcs / day (avg)</td><td><b>${num(plant.actualPerDay, 0)}</b></td></tr>
            <tr><td class="left">Catch-up pcs / day needed</td><td><b style="color:${(plant.catchUpPerDay ?? 0) > (plant.actualPerDay ?? 0) * 1.2 ? "#ef4444" : "#0f172a"}">${num(plant.catchUpPerDay, 0)}</b></td></tr>
            <tr><td class="left">Catch-up vs plan %</td><td><b>${pct(plant.catchUpVsPlanPct)}</b></td></tr>
            <tr><td class="left">Linearity index</td><td><b>${plant.linearityIndex !== null ? `${(plant.linearityIndex * 100).toFixed(1)}` : "–"}</b></td></tr>
            <tr><td class="left">Working days elapsed</td><td><b>${h(context.elapsed)} / ${h(context.workingDays)}</b></td></tr>
            <tr><td class="left">Working days remaining</td><td><b>${h(context.remaining)}</b></td></tr>
          </tbody>
        </table>
        <h2 style="margin-top:12px">Today's Status</h2>
        ${dailySeries.length > 0 ? (() => {
          const today = dailySeries[dailySeries.length - 1];
          const dailyAtt = today.requiredPerDay > 0 ? (today.actualPcs / today.requiredPerDay * 100) : null;
          return `<table>
            <thead><tr><th class="left">Metric</th><th>Value</th></tr></thead>
            <tbody>
              <tr><td class="left">Last recorded day (WD ${h(today.workingDayNum)})</td><td>${h(today.date)}</td></tr>
              <tr><td class="left">Output (pcs)</td><td><b>${num(today.actualPcs)}</b></td></tr>
              <tr><td class="left">Daily target</td><td>${num(today.requiredPerDay, 0)}</td></tr>
              <tr><td class="left">Daily attainment</td><td style="color:${(dailyAtt ?? 0) >= 100 ? "#065f46" : "#991b1b"}">${pct(dailyAtt)}</td></tr>
              <tr><td class="left">Cumulative actual</td><td><b>${num(today.cumulativeActual)}</b></td></tr>
              <tr><td class="left">Cumulative required</td><td>${num(today.cumulativeRequired, 0)}</td></tr>
            </tbody>
          </table>`;
        })() : "<p style='color:#64748b'>No day records.</p>"}
      </div>
    </div>`;

  // ── CATEGORY ATTAINMENT ────────────────────────────────────────────────────
  const catRows = categories.map((c: CategoryKPIs) => `
    <tr>
      <td class="left"><b>${h(c.category)}</b></td>
      <td>${num(c.targetMax)}</td>
      <td>${num(c.targetMin)}</td>
      <td>${num(c.producedToDate)}</td>
      <td style="color:${c.gapPcs > 0 ? "#991b1b" : "#065f46"}">${num(c.gapPcs)}</td>
      <td>${pct(c.attainmentCumPct)}</td>
      <td>${pct(c.projectedAttainmentPct)}</td>
      <td>${num(c.requiredPerDay, 0)}</td>
      <td>${num(c.actualPerDay, 0)}</td>
      <td>${c.daysAheadBehind !== null ? (c.daysAheadBehind >= 0 ? `+${c.daysAheadBehind.toFixed(1)}` : c.daysAheadBehind.toFixed(1)) : "–"}</td>
      <td><span class="rag-chip" style="background:${ragBg(c.ragBand)};color:${ragFg(c.ragBand)}">${ragLabel(c.ragBand)}</span></td>
    </tr>`).join("");
  const catSection = `
    <div class="page-break">${pageHeader("Category Attainment")}</div>
    <h2>Attainment by Category</h2>
    <table>
      <thead><tr>
        <th class="left">Category</th><th>Max PP</th><th>Min PP</th><th>Produced</th>
        <th>Gap (pcs)</th><th>Cum Att %</th><th>Proj End %</th>
        <th>Req/Day</th><th>Act/Day</th><th>Days ±</th><th>RAG</th>
      </tr></thead>
      <tbody>${catRows}</tbody>
    </table>`;

  // ── VARIANCE PARETO ────────────────────────────────────────────────────────
  const totalGap = variancePareto.reduce((s, i) => s + Math.max(i.gapPcs, 0), 0);
  let cumGap = 0;
  const paretoRows = variancePareto.slice(0, 25).map((item: ItemKPIs, idx: number) => {
    const gap = Math.max(item.gapPcs, 0);
    cumGap += gap;
    const cumPct = totalGap > 0 ? (cumGap / totalGap * 100).toFixed(1) : "–";
    return `<tr>
      <td>${idx + 1}</td>
      <td class="left">${h(item.itemCode)}</td>
      <td class="left">${h(item.colour)}</td>
      <td class="left">${h(item.category)}</td>
      <td>${num(item.targetMax)}</td>
      <td>${num(item.producedToDate)}</td>
      <td style="color:#991b1b"><b>${num(gap)}</b></td>
      <td>${pct(item.attainmentMonthPct)}</td>
      <td>${h(item.daysWithNoProduction)}</td>
      <td style="color:#64748b">${cumPct}%</td>
    </tr>`;
  }).join("");
  const paretoSection = `
    <div class="page-break">${pageHeader("Variance Pareto")}</div>
    <h2>Variance Pareto — Top Items by Pcs Shortfall (Total gap: ${num(totalGap)} pcs)</h2>
    <table>
      <thead><tr>
        <th>#</th><th class="left">Item Code</th><th class="left">Colour</th><th class="left">Category</th>
        <th>Plan (Max)</th><th>Produced</th><th>Gap (pcs)</th><th>Att %</th><th>0-Day Streak</th><th>Cum %</th>
      </tr></thead>
      <tbody>${paretoRows}</tbody>
    </table>`;

  // ── MIX FLAGS + WARNINGS ───────────────────────────────────────────────────
  const mixSection = mixFlags.length > 0
    ? `<h2>Mix / Sequencing Flags (${mixFlags.length})</h2>
       <table>
         <thead><tr><th class="left">Item Code</th><th class="left">Colour</th><th class="left">Category</th><th>Plan (Max)</th><th>Produced</th><th class="left">Reason</th></tr></thead>
         <tbody>${mixFlags.map((f: MixFlag) => `<tr><td class="left">${h(f.itemCode)}</td><td class="left">${h(f.colour)}</td><td class="left">${h(f.category)}</td><td>${num(f.targetMax)}</td><td>${num(f.producedToDate)}</td><td class="left">${h(f.reason.replace(/_/g, " "))}</td></tr>`).join("")}</tbody>
       </table>`
    : `<h2>Mix / Sequencing Flags</h2><p style="color:#065f46;font-size:9px">No mix imbalance flags — all planned items have begun production.</p>`;

  const sevOrder = ["critical", "high", "medium", "info"] as const;
  const warnRows = sevOrder.flatMap((sev) =>
    warnings
      .filter((w: PlantWarning) => w.severity === sev)
      .map((w: PlantWarning) => `<tr>
        <td class="sev-${h(w.severity)}" style="font-weight:bold">${h(w.severity.toUpperCase())}</td>
        <td class="left">${h(w.code)}</td>
        <td class="left">${h(w.scope)}</td>
        <td class="left">${h(w.message)}</td>
        <td>${w.value !== null ? String(w.value) : "–"}</td>
        <td>${w.threshold !== null ? String(w.threshold) : "–"}</td>
      </tr>`)
  ).join("");
  const warnSection = `
    <div class="page-break">${pageHeader("Mix Flags & Warnings")}</div>
    ${mixSection}
    <h2 style="margin-top:12px">Active Warnings (${warnings.length})</h2>
    ${warnings.length > 0
      ? `<table>
           <thead><tr><th>Severity</th><th class="left">Code</th><th class="left">Scope</th><th class="left">Message</th><th>Value</th><th>Threshold</th></tr></thead>
           <tbody>${warnRows}</tbody>
         </table>`
      : `<p style="color:#065f46;font-size:9px">No active warnings.</p>`}`;

  // ── RECOMMENDATIONS ────────────────────────────────────────────────────────
  const recCards = recommendations.map((r: PlantRecommendation, i: number) => `
    <div style="border:1px solid #e2e8f0;border-radius:4px;padding:7px 10px;margin-bottom:6px;border-left:3px solid ${r.effort === "high" ? "#ef4444" : r.effort === "med" ? "#f59e0b" : "#10b981"}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">
        <span style="font-weight:bold;font-size:9.5px">#${i + 1} &nbsp; ${h(r.code)} &nbsp;·&nbsp; ${h(r.scope)}</span>
        <span style="font-size:7.5px;background:#f1f5f9;padding:1px 5px;border-radius:3px">${h(r.effort.toUpperCase())} EFFORT</span>
      </div>
      <div style="font-size:9px;font-weight:bold;margin-bottom:2px">${h(r.action)}</div>
      <div style="font-size:8px;color:#475569;margin-bottom:2px">${h(r.rationale)}</div>
      <div style="font-size:8px;color:#0369a1"><b>Impact:</b> ${h(r.quantifiedImpact)}</div>
    </div>`).join("");
  const recSection = `
    <div class="page-break">${pageHeader("Recommendations")}</div>
    <h2>Prioritised Recovery Actions (${recommendations.length})</h2>
    ${recommendations.length > 0 ? recCards : `<p style="color:#065f46;font-size:9px">No corrective actions needed — plant is on track.</p>`}
    ${aiNarrative ? `
    <div class="ai-box">
      <div class="ai-label">⚠ AI Analyst Narrative (AI-generated — verify all numbers against the engine data above)</div>
      <div style="font-size:8.5px;white-space:pre-line;color:#1e293b">${h(aiNarrative)}</div>
    </div>` : ""}`;

  // ── DAILY PRODUCTION LOG ───────────────────────────────────────────────────
  const dailyRows = dailySeries.map((d: DayRecord) => {
    const dailyAtt = d.requiredPerDay > 0 ? (d.actualPcs / d.requiredPerDay * 100) : null;
    const cumAtt = d.cumulativeRequired > 0 ? (d.cumulativeActual / d.cumulativeRequired * 100) : null;
    return `<tr>
      <td>${h(d.date)}</td>
      <td>${h(d.workingDayNum)}</td>
      <td>${num(d.requiredPerDay, 0)}</td>
      <td><b>${num(d.actualPcs)}</b></td>
      <td style="color:${(dailyAtt ?? 0) >= 100 ? "#065f46" : "#991b1b"}">${pct(dailyAtt)}</td>
      <td>${num(d.cumulativeRequired, 0)}</td>
      <td><b>${num(d.cumulativeActual)}</b></td>
      <td style="color:${(cumAtt ?? 0) >= 100 ? "#065f46" : "#991b1b"}">${pct(cumAtt)}</td>
    </tr>`;
  }).join("");
  const dailySection = `
    <div class="page-break">${pageHeader("Daily Production Log")}</div>
    <h2>Daily Production Log</h2>
    <table>
      <thead><tr>
        <th class="left">Date</th><th>WD#</th><th>Target/Day</th><th>Actual (pcs)</th>
        <th>Daily Att %</th><th>Cum Required</th><th>Cum Actual</th><th>Cum Att %</th>
      </tr></thead>
      <tbody>${dailyRows || "<tr><td colspan='8' class='left'>No daily records available.</td></tr>"}</tbody>
    </table>`;

  // ── APPENDIX: FULL ITEM LIST ───────────────────────────────────────────────
  const itemRows = [...items]
    .sort((a, b) => Math.max(b.gapPcs, 0) - Math.max(a.gapPcs, 0))
    .map((item: ItemKPIs) => `<tr>
      <td class="left">${h(item.itemCode)}</td>
      <td class="left">${h(item.colour)}</td>
      <td class="left">${h(item.category)}</td>
      <td>${num(item.targetMax)}</td>
      <td>${num(item.producedToDate)}</td>
      <td style="color:${item.gapPcs > 0 ? "#991b1b" : "#065f46"}">${num(item.gapPcs)}</td>
      <td>${pct(item.attainmentMonthPct)}</td>
      <td style="color:${item.daysWithNoProduction > 3 ? "#991b1b" : "inherit"}">${h(item.daysWithNoProduction)}</td>
    </tr>`).join("");
  const appendix = `
    <div class="page-break">${pageHeader("Appendix — Full Item List")}</div>
    <h2>Appendix: Full Plan vs Actual — All Items (${items.length} items)</h2>
    <table>
      <thead><tr>
        <th class="left">Item Code</th><th class="left">Colour</th><th class="left">Category</th>
        <th>Plan (Max)</th><th>Produced</th><th>Gap (pcs)</th><th>Att %</th><th>0-Day Streak</th>
      </tr></thead>
      <tbody>${itemRows || "<tr><td colspan='8' class='left'>No item data.</td></tr>"}</tbody>
    </table>`;

  const footer = `<div class="footer">Generated ${h(generatedAt)} &nbsp;·&nbsp; PTMT Production Performance &amp; Monitoring &nbsp;·&nbsp; All figures from deterministic plant engine. AI narrative (if present) is clearly labelled.</div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
    ${cover}
    ${execSnap}
    ${controlBoard}
    ${catSection}
    ${paretoSection}
    ${warnSection}
    ${recSection}
    ${dailySection}
    ${appendix}
    ${footer}
  </body></html>`;
}

export async function generatePlantPdf(bundle: FullBundle, aiNarrative: string | null): Promise<Buffer> {
  const generatedAt = new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  const html = buildHtml(bundle, aiNarrative, generatedAt);
  const browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      format: "A4",
      landscape: true,
      printBackground: true,
      margin: { top: "10mm", bottom: "10mm", left: "12mm", right: "12mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

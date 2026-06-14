import PDFDocument from "pdfkit";
import { sql, eq, and, desc } from "drizzle-orm";
import { db, reports, planRuns, type Report as DbReport } from "@workspace/db";
import { getRun, getLines } from "./plan";
import { getDashboard } from "./dashboard";
import {
  callClaude,
  selectModel,
  anthropicAvailable,
} from "../lib/anthropic";
import { HttpError } from "../lib/http";
import { formatDateTime } from "../lib/date";

export interface ApiReport {
  id: number;
  planRunId: number | null;
  periodType: string | null;
  model: string | null;
  tier: string | null;
  downgraded: boolean;
  summary: string | null;
  createdAt: string | null;
}

function mapReport(r: DbReport): ApiReport {
  return {
    id: r.id,
    planRunId: r.planRunId,
    periodType: r.periodType,
    model: r.model,
    tier: r.tier,
    downgraded: r.downgraded ?? false,
    summary: r.summary,
    createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
  };
}

export interface GenerateReportArgs {
  runId: number;
  cadence: string;
  board?: boolean;
}

export async function generateReport(args: GenerateReportArgs): Promise<ApiReport> {
  const run = await getRun(args.runId);
  if (!run) throw new HttpError(400, "Plan run not found");

  const lines = await getLines(args.runId);
  const dashboard = await getDashboard(run.division, run.planMonth);
  const topUrgent = lines
    .filter((l) => l.urgent)
    .sort((a, b) => b.valueAmount! - a.valueAmount! || b.runRate - a.runRate)
    .slice(0, 15)
    .map((l) => ({
      itemCode: l.itemCode,
      colour: l.colour,
      category: l.category,
      runRate: l.runRate,
      openingStock: l.openingStock,
      coverage: l.coverage,
      productionRequired: l.productionRequired,
    }));

  const totalRequired = lines.reduce((s, l) => s + l.productionRequired, 0);
  const totalProduced = lines.reduce((s, l) => s + l.produced, 0);
  const totalValue = lines.reduce((s, l) => s + (l.valueAmount ?? 0), 0);

  const choice = selectModel({
    task: "report",
    cadence: args.cadence,
    board: args.board,
  });

  let summary: string;
  let model: string | null = null;
  let tier: string | null = null;
  let downgraded = false;

  const facts = {
    division: run.division,
    planMonth: run.planMonth,
    version: run.version,
    cadence: args.cadence,
    board: Boolean(args.board),
    multiplierMode: run.multiplierMode,
    multiplier: run.multiplier,
    multiplierMin: run.multiplierMin,
    multiplierMax: run.multiplierMax,
    workingDays: run.workingDays,
    lineCount: run.lineCount,
    totals: {
      productionRequired: Math.round(totalRequired),
      produced: Math.round(totalProduced),
      planValue: Math.round(totalValue),
    },
    urgentCount: dashboard.urgentCount,
    activeCategories: dashboard.activeCategories,
    dataHealth: dashboard.dataHealth,
    categorySummaries: dashboard.categorySummaries,
    topUrgent,
  };

  if (anthropicAvailable) {
    const system =
      "You are a senior operations analyst writing a production-planning report for factory management. " +
      "You are given deterministic FACTS computed by the planning engine (do NOT recompute or invent numbers). " +
      "Write a clear, structured narrative in markdown with these sections: " +
      "## Executive Summary, ## Demand & Run-Rate, ## Buffer & Production Targets, ## Urgent Items, ## Data Quality, ## Recommendations. " +
      "Be concrete, cite the provided numbers, and keep it concise and decision-oriented. Do not include a code block.";
    try {
      const res = await callClaude({
        system,
        user: JSON.stringify(facts),
        tier: choice.tier,
      });
      summary = res.text.trim();
      model = res.model;
      tier = res.tier;
      downgraded = res.downgraded;
    } catch (err) {
      summary = fallbackNarrative(facts, err);
      model = null;
      tier = choice.tier;
    }
  } else {
    summary = fallbackNarrative(facts, null);
    tier = choice.tier;
  }

  const [row] = await db
    .insert(reports)
    .values({
      planRunId: args.runId,
      periodType: args.cadence,
      model,
      tier,
      downgraded,
      summary,
    })
    .returning();
  if (!row) throw new Error("Failed to store report");

  await db
    .update(planRuns)
    .set({ reportModel: model, reportTier: tier })
    .where(eq(planRuns.id, args.runId));

  return mapReport(row);
}

function fallbackNarrative(facts: Record<string, unknown>, err: unknown): string {
  const t = facts["totals"] as { productionRequired: number; produced: number; planValue: number };
  const note = err
    ? `\n\n_AI narrative unavailable (${err instanceof Error ? err.message : String(err)}); deterministic summary shown._`
    : "\n\n_AI narrative unavailable (ANTHROPIC_API_KEY not configured); deterministic summary shown._";
  return (
    `## Executive Summary\n` +
    `Division **${facts["division"]}**, plan month **${facts["planMonth"]}** (v${facts["version"]}). ` +
    `${facts["lineCount"]} line items, ${facts["urgentCount"]} urgent. ` +
    `Total production required: ${t.productionRequired}; produced so far: ${t.produced}; plan value: ${t.planValue}.\n\n` +
    `## Data Quality\nData health: ${facts["dataHealth"]}.` +
    note
  );
}

export async function listReports(
  division?: string,
  planMonth?: string,
): Promise<ApiReport[]> {
  if (!division && !planMonth) {
    const rows = await db
      .select()
      .from(reports)
      .orderBy(desc(reports.createdAt))
      .limit(100);
    return rows.map(mapReport);
  }
  const conds = [];
  if (division) conds.push(eq(planRuns.division, division));
  if (planMonth) conds.push(eq(planRuns.planMonth, planMonth.slice(0, 10)));
  const rows = await db
    .select({ r: reports })
    .from(reports)
    .innerJoin(planRuns, eq(reports.planRunId, planRuns.id))
    .where(and(...conds))
    .orderBy(desc(reports.createdAt))
    .limit(100);
  return rows.map((x) => mapReport(x.r));
}

export async function renderReportPdf(
  reportId: number,
): Promise<{ buffer: Buffer; filename: string } | null> {
  const rows = await db
    .select()
    .from(reports)
    .where(eq(reports.id, reportId))
    .limit(1);
  const report = rows[0];
  if (!report) return null;
  const run = report.planRunId ? await getRun(report.planRunId) : null;

  const buffer = await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(20).text("Prayag Production Planning", { continued: false });
    doc.moveDown(0.3);
    doc.fontSize(14).fillColor("#444").text(
      `${report.periodType ?? "Report"} — ${run ? `${run.division} ${run.planMonth} (v${run.version})` : ""}`,
    );
    doc.moveDown(0.5);
    doc.fillColor("#000");

    renderMarkdown(doc, report.summary ?? "No content.");

    doc.moveDown(1);
    const footer =
      `Model: ${report.model ?? "n/a"} | Tier: ${report.tier ?? "n/a"}` +
      (report.downgraded ? " (downgraded)" : "") +
      ` | Generated: ${report.createdAt ? formatDateTime(report.createdAt) : ""}`;
    doc.fontSize(8).fillColor("#888").text(footer, 50, doc.page.height - 40, {
      width: doc.page.width - 100,
      align: "center",
    });

    doc.end();
  });

  const filename = `report-${run ? `${run.division}-${run.planMonth}-v${run.version}` : reportId}.pdf`;
  return { buffer, filename };
}

// Minimal markdown renderer: headings (##) and paragraphs/bullets.
function renderMarkdown(doc: PDFKit.PDFDocument, md: string): void {
  const lines = md.split("\n");
  for (const raw of lines) {
    const line = raw.replace(/\*\*(.+?)\*\*/g, "$1").replace(/_(.+?)_/g, "$1");
    if (line.trim() === "") {
      doc.moveDown(0.4);
      continue;
    }
    if (line.startsWith("### ")) {
      doc.moveDown(0.3).fontSize(12).fillColor("#222").text(line.slice(4));
      doc.fontSize(10).fillColor("#000");
    } else if (line.startsWith("## ")) {
      doc.moveDown(0.4).fontSize(14).fillColor("#1a1a1a").text(line.slice(3));
      doc.fontSize(10).fillColor("#000");
    } else if (line.startsWith("# ")) {
      doc.moveDown(0.5).fontSize(16).fillColor("#000").text(line.slice(2));
      doc.fontSize(10);
    } else if (/^\s*[-*]\s+/.test(line)) {
      doc.fontSize(10).text(`• ${line.replace(/^\s*[-*]\s+/, "")}`, {
        indent: 10,
      });
    } else {
      doc.fontSize(10).fillColor("#000").text(line);
    }
  }
}

export async function reportsCount(): Promise<number> {
  const res = await db.execute(sql`SELECT COUNT(*)::int AS c FROM reports`);
  return Number((res.rows[0] as { c?: number } | undefined)?.c ?? 0);
}

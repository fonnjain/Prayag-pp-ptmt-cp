import { Router, type IRouter } from "express";
import { db, reportsTable, aiPlantAnalysesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { computePlantBundle } from "./plant";
import { generatePlantPdf } from "../lib/reports-plant-pdf";
import { generateCeoPdf } from "../lib/reports-ceo-pdf";
import { generatePlantXlsx } from "../lib/reports-plant-xlsx";
import { logger } from "../lib/logger";

const router: IRouter = Router();

async function fetchAiNarrative(month: string): Promise<string | null> {
  try {
    const [row] = await db
      .select()
      .from(aiPlantAnalysesTable)
      .where(eq(aiPlantAnalysesTable.month, month))
      .orderBy(desc(aiPlantAnalysesTable.createdAt))
      .limit(1);
    if (!row?.resultJson) return null;
    const result = row.resultJson as Record<string, unknown>;
    const parts: string[] = [];
    if (Array.isArray(result.keyFindings) && result.keyFindings.length > 0) {
      parts.push("KEY FINDINGS:");
      for (const f of result.keyFindings as string[]) parts.push(`• ${f}`);
    }
    if (Array.isArray(result.risks) && result.risks.length > 0) {
      parts.push("\nRISKS:");
      for (const r of result.risks as { title?: string; description?: string; severity?: string }[]) {
        parts.push(`• [${r.severity?.toUpperCase() ?? "?"}] ${r.title ?? ""}: ${r.description ?? ""}`);
      }
    }
    if (Array.isArray(result.recommendations) && result.recommendations.length > 0) {
      parts.push("\nAI RECOMMENDATIONS:");
      for (const r of result.recommendations as { title?: string; description?: string }[]) {
        parts.push(`• ${r.title ?? ""}: ${r.description ?? ""}`);
      }
    }
    return parts.length > 0 ? parts.join("\n") : null;
  } catch {
    return null;
  }
}

async function storeReport(
  type: string,
  month: string,
  snapshotDate: string | null,
  filename: string,
  data: Buffer,
  contentType: string,
) {
  const dataBase64 = data.toString("base64");
  const [row] = await db
    .insert(reportsTable)
    .values({ type, month, snapshotDate, filename, dataBase64, contentType })
    .returning({ id: reportsTable.id });
  return row.id;
}

// --- POST /reports/plant-pdf ---
router.post("/reports/plant-pdf", async (req, res): Promise<void> => {
  res.status(503).json({ error: "PDF export is not available in this deployment" });
  return;
  const { month, includeAiNarrative = false } = req.body as {
    month: string;
    includeAiNarrative?: boolean;
  };
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: "month required (YYYY-MM)" });
    return;
  }
  try {
    const [bundle, aiNarrative] = await Promise.all([
      computePlantBundle(month),
      includeAiNarrative ? fetchAiNarrative(month) : Promise.resolve(null),
    ]);
    const pdf = await generatePlantPdf(bundle, aiNarrative);
    const filename = `PTMT_PlantManager_${month}.pdf`;
    const snapshotDate = bundle.context.snapshotDate;
    const id = await storeReport("plant_pdf", month, snapshotDate, filename, pdf, "application/pdf");
    logger.info({ month, id }, "plant-pdf report generated");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("X-Report-Id", String(id));
    res.send(pdf);
  } catch (err) {
    logger.error({ err, month }, "reports/plant-pdf failed");
    res.status(500).json({ error: "Failed to generate plant manager PDF" });
  }
});

// --- POST /reports/ceo-pdf ---
router.post("/reports/ceo-pdf", async (req, res): Promise<void> => {
  res.status(503).json({ error: "PDF export is not available in this deployment" });
  return;
  const { month, includeAiNarrative = false } = req.body as {
    month: string;
    includeAiNarrative?: boolean;
  };
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: "month required (YYYY-MM)" });
    return;
  }
  try {
    const [bundle, aiNarrative] = await Promise.all([
      computePlantBundle(month),
      includeAiNarrative ? fetchAiNarrative(month) : Promise.resolve(null),
    ]);
    const pdf = await generateCeoPdf(bundle, aiNarrative);
    const filename = `PTMT_CEO_${month}.pdf`;
    const snapshotDate = bundle.context.snapshotDate;
    const id = await storeReport("ceo_pdf", month, snapshotDate, filename, pdf, "application/pdf");
    logger.info({ month, id }, "ceo-pdf report generated");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("X-Report-Id", String(id));
    res.send(pdf);
  } catch (err) {
    logger.error({ err, month }, "reports/ceo-pdf failed");
    res.status(500).json({ error: "Failed to generate CEO PDF" });
  }
});

// --- POST /reports/plant-xlsx ---
router.post("/reports/plant-xlsx", async (req, res): Promise<void> => {
  const { month } = req.body as { month: string };
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: "month required (YYYY-MM)" });
    return;
  }
  try {
    const bundle = await computePlantBundle(month);
    const xlsx = await generatePlantXlsx(bundle);
    const filename = `PTMT_PlantManager_${month}.xlsx`;
    const snapshotDate = bundle.context.snapshotDate;
    const id = await storeReport(
      "plant_xlsx",
      month,
      snapshotDate,
      filename,
      xlsx,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    logger.info({ month, id }, "plant-xlsx report generated");
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("X-Report-Id", String(id));
    res.send(xlsx);
  } catch (err) {
    logger.error({ err, month }, "reports/plant-xlsx failed");
    res.status(500).json({ error: "Failed to generate plant manager Excel" });
  }
});

// --- GET /reports/history ---
router.get("/reports/history", async (req, res): Promise<void> => {
  const month = String(req.query.month ?? "");
  if (month && !/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: "Invalid month format (YYYY-MM)" });
    return;
  }
  try {
    const rows = await db
      .select({
        id: reportsTable.id,
        type: reportsTable.type,
        month: reportsTable.month,
        snapshotDate: reportsTable.snapshotDate,
        filename: reportsTable.filename,
        contentType: reportsTable.contentType,
        createdAt: reportsTable.createdAt,
      })
      .from(reportsTable)
      .where(month ? eq(reportsTable.month, month) : undefined)
      .orderBy(desc(reportsTable.createdAt))
      .limit(50);
    res.json({ data: rows });
  } catch (err) {
    logger.error({ err }, "reports/history failed");
    res.status(500).json({ error: "Failed to load report history" });
  }
});

// --- GET /reports/:id/download ---
router.get("/reports/:id/download", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid report id" });
    return;
  }
  try {
    const [row] = await db
      .select()
      .from(reportsTable)
      .where(eq(reportsTable.id, id))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Report not found" });
      return;
    }
    const data = Buffer.from(row.dataBase64, "base64");
    res.setHeader("Content-Type", row.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${row.filename}"`);
    res.send(data);
  } catch (err) {
    logger.error({ err, id }, "reports/download failed");
    res.status(500).json({ error: "Failed to download report" });
  }
});

export default router;

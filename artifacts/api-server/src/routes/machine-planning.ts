import { Router, type IRouter, type Request, type Response } from "express";
import { governedExportFilename, governedLineageExportFilename } from "../lib/export-filename";
import {
  loadMachinePlanning,
  machinePlanningUnavailable,
} from "../lib/machine-planning";
import {
  exportMachineWiseExcel,
  exportPlanningFormatExcel,
} from "../lib/machine-planning-export";
import {
  exportMachineFeasibleExcel,
  exportWeeklyReleaseBxExcel,
  BxExportInvariantError,
} from "../lib/bx-exports";

const router: IRouter = Router();
const MONTH_PATTERN = /^\d{4}-\d{2}$/;

function query(req: Request): { month: string; segment: string } {
  const month = typeof req.query?.month === "string" ? req.query.month : "";
  const segment = typeof req.query?.segment === "string" ? req.query.segment : "Plumbing";
  return { month, segment };
}

function invalid(month: string, segment: string): string | null {
  if (!MONTH_PATTERN.test(month)) return "month is required (YYYY-MM)";
  if (segment !== "Plumbing" && segment !== "PTMT") return "segment must be Plumbing or PTMT";
  return null;
}

router.get("/machine-planning", async (req, res): Promise<void> => {
  const { month, segment } = query(req);
  const error = invalid(month, segment);
  if (error) {
    res.status(400).json({ error });
    return;
  }
  if (segment === "PTMT") {
    res.status(200).json(machinePlanningUnavailable(segment, month));
    return;
  }
  res.status(200).json(await loadMachinePlanning(month, segment));
});

async function sendExport(
  req: Request,
  res: Response,
  kind: "MachineWise" | "PlanningFormat",
): Promise<void> {
  const { month, segment } = query(req);
  const error = invalid(month, segment);
  if (error) {
    res.status(400).json({ error });
    return;
  }
  if (segment === "PTMT") {
    res.status(200).json(machinePlanningUnavailable(segment, month));
    return;
  }
  const payload = await loadMachinePlanning(month, segment);
  if (!payload.available || payload.runId == null) {
    res.status(404).json(payload);
    return;
  }
  const buffer = kind === "MachineWise"
    ? await exportMachineWiseExcel(payload)
    : await exportPlanningFormatExcel(payload);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${governedExportFilename({
    segment,
    kind,
    month,
    runId: payload.runId ?? 0,
    extension: "xlsx",
  })}"`);
  res.send(buffer);
}

router.get("/machine-planning/export/machine-wise", async (req, res): Promise<void> => {
  await sendExport(req, res, "MachineWise");
});

router.get("/machine-planning/export/planning-format", async (req, res): Promise<void> => {
  await sendExport(req, res, "PlanningFormat");
});

async function sendBxExport(
  req: Request,
  res: Response,
  kind: "MachineFeasible" | "WeeklyRelease",
): Promise<void> {
  const { month, segment } = query(req);
  const error = invalid(month, segment);
  if (error) {
    res.status(400).json({ error });
    return;
  }
  if (segment === "PTMT") {
    res.status(200).json(machinePlanningUnavailable(segment, month));
    return;
  }
  const payload = await loadMachinePlanning(month, segment);
  if (!payload.available || payload.runId == null || payload.sourceRunId == null) {
    res.status(404).json({
      error: "MISSING_STORED_LINEAGE",
      message: "BX exports require stored Temporary and Production run evidence.",
      payload,
    });
    return;
  }
  try {
    const buffer = kind === "MachineFeasible"
      ? await exportMachineFeasibleExcel(payload)
      : await exportWeeklyReleaseBxExcel(payload);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${governedLineageExportFilename({
      segment: payload.segment,
      kind,
      month: payload.month,
      temporaryRunId: payload.sourceRunId,
      productionRunId: payload.runId,
      extension: "xlsx",
    })}"`);
    res.send(buffer);
  } catch (error) {
    if (error instanceof BxExportInvariantError) {
      res.status(422).json({ error: error.code, message: error.message });
      return;
    }
    throw error;
  }
}

router.get("/machine-planning/export/machine-feasible", async (req, res): Promise<void> => {
  await sendBxExport(req, res, "MachineFeasible");
});

router.get("/machine-planning/export/weekly-release", async (req, res): Promise<void> => {
  await sendBxExport(req, res, "WeeklyRelease");
});

export default router;
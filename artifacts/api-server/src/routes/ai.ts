import { Router, type IRouter } from "express";
import { db, aiAnalysesTable, aiAnalysisMessagesTable, aiPlantAnalysesTable, aiPlantAnalysisMessagesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { buildMonitoringBundle } from "./monitoring";
import {
  buildAnalysisPacket,
  hashPacket,
  buildUserMessage,
  SYSTEM_PROMPT,
  modelForDepth,
  getAnthropicClient,
  exportAiAnalysisPdf,
  type AnalysisDepth,
  type AnalysisResult,
  type AnalysisPacket,
} from "../lib/ai-analytics";
import {
  buildPlantPacket,
  hashPlantPacket,
  buildPlantUserMessage,
  PLANT_SYSTEM_PROMPT,
  exportPlantAnalysisPdf,
  type PlantAnalysisPacket,
  type PlantAnalysisResult,
} from "../lib/plant-ai-analytics";
import { computePlantBundle } from "./plant";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function parseDepth(value: unknown): AnalysisDepth {
  return value === "deep" ? "deep" : "standard";
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  let candidate = fenced ? fenced[1] : trimmed;
  candidate = candidate.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error("Could not locate a valid JSON object in the model response");
  }
}

router.post("/ai/analyze", async (req, res): Promise<void> => {
  const month = String(req.body?.month ?? "");
  const depth = parseDepth(req.body?.depth);
  if (!month) {
    res.status(400).json({ error: "month is required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  try {
    const bundle = await buildMonitoringBundle(month);
    const packet = buildAnalysisPacket(month, bundle);
    const packetHash = hashPacket(packet);
    const model = modelForDepth(depth);

    const [existing] = await db
      .select()
      .from(aiAnalysesTable)
      .where(eq(aiAnalysesTable.packetHash, packetHash))
      .orderBy(desc(aiAnalysesTable.createdAt))
      .limit(1);

    if (existing && existing.depth === depth && existing.resultJson) {
      res.write(`data: ${JSON.stringify({ cached: true, id: existing.id, result: existing.resultJson })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true, id: existing.id })}\n\n`);
      res.end();
      return;
    }

    const client = getAnthropicClient();
    let fullText = "";
    const stream = client.messages.stream({
      model,
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserMessage(packet) }],
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        fullText += event.delta.text;
        res.write(`data: ${JSON.stringify({ delta: event.delta.text })}\n\n`);
      }
    }

    let result: AnalysisResult | null = null;
    let parseError: string | null = null;
    try {
      result = extractJson(fullText) as AnalysisResult;
    } catch (err) {
      parseError = err instanceof Error ? err.message : "Failed to parse model output as JSON";
      logger.error({ err, month }, "ai-analytics: failed to parse Claude response as JSON");
    }

    const [row] = await db
      .insert(aiAnalysesTable)
      .values({
        month,
        snapshotDate: bundle.lastDataDate,
        depth,
        model,
        packetHash,
        packetJson: packet,
        resultJson: result,
      })
      .returning();

    if (parseError) {
      res.write(`data: ${JSON.stringify({ error: parseError, id: row.id })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ done: true, id: row.id, result })}\n\n`);
    res.end();
  } catch (err) {
    logger.error({ err, month }, "ai-analytics: analyze failed");
    res.write(`data: ${JSON.stringify({ error: err instanceof Error ? err.message : "Analysis failed" })}\n\n`);
    res.end();
  }
});

router.post("/ai/analyses/:id/followup", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const question = String(req.body?.question ?? "");
  if (!id || !question) {
    res.status(400).json({ error: "id and question are required" });
    return;
  }

  const [analysis] = await db.select().from(aiAnalysesTable).where(eq(aiAnalysesTable.id, id));
  if (!analysis) {
    res.status(404).json({ error: "analysis not found" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  try {
    const priorMessages = await db
      .select()
      .from(aiAnalysisMessagesTable)
      .where(eq(aiAnalysisMessagesTable.analysisId, id))
      .orderBy(aiAnalysisMessagesTable.createdAt);

    const packet = analysis.packetJson as AnalysisPacket;
    const conversation: Array<{ role: "user" | "assistant"; content: string }> = [
      { role: "user", content: buildUserMessage(packet) },
      ...(analysis.resultJson
        ? [{ role: "assistant" as const, content: JSON.stringify(analysis.resultJson) }]
        : []),
      ...priorMessages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      { role: "user" as const, content: question },
    ];

    await db.insert(aiAnalysisMessagesTable).values({ analysisId: id, role: "user", content: question });

    const client = getAnthropicClient();
    let fullText = "";
    const stream = client.messages.stream({
      model: analysis.model,
      max_tokens: 2048,
      system: `${SYSTEM_PROMPT}\n\nYou are now answering a manager's follow-up question. Ground your answer strictly in the data packet and prior analysis already provided. Respond in plain text, not JSON, unless the question asks for structured data.`,
      messages: conversation,
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        fullText += event.delta.text;
        res.write(`data: ${JSON.stringify({ delta: event.delta.text })}\n\n`);
      }
    }

    await db.insert(aiAnalysisMessagesTable).values({ analysisId: id, role: "assistant", content: fullText });

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    logger.error({ err, id }, "ai-analytics: followup failed");
    res.write(`data: ${JSON.stringify({ error: err instanceof Error ? err.message : "Follow-up failed" })}\n\n`);
    res.end();
  }
});

router.get("/ai/analyses", async (req, res): Promise<void> => {
  const month = String(req.query.month ?? "");
  if (!month) {
    res.status(400).json({ error: "month is required" });
    return;
  }
  const rows = await db
    .select({
      id: aiAnalysesTable.id,
      month: aiAnalysesTable.month,
      snapshotDate: aiAnalysesTable.snapshotDate,
      depth: aiAnalysesTable.depth,
      model: aiAnalysesTable.model,
      createdAt: aiAnalysesTable.createdAt,
    })
    .from(aiAnalysesTable)
    .where(eq(aiAnalysesTable.month, month))
    .orderBy(desc(aiAnalysesTable.createdAt));
  res.json(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

router.get("/ai/analyses/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [analysis] = await db.select().from(aiAnalysesTable).where(eq(aiAnalysesTable.id, id));
  if (!analysis) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const messages = await db
    .select()
    .from(aiAnalysisMessagesTable)
    .where(eq(aiAnalysisMessagesTable.analysisId, id))
    .orderBy(aiAnalysisMessagesTable.createdAt);
  res.json({
    id: analysis.id,
    month: analysis.month,
    snapshotDate: analysis.snapshotDate,
    depth: analysis.depth,
    model: analysis.model,
    createdAt: analysis.createdAt.toISOString(),
    result: analysis.resultJson,
    messages: messages.map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt.toISOString() })),
  });
});

router.get("/ai/analyses/:id/export/pdf", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [analysis] = await db.select().from(aiAnalysesTable).where(eq(aiAnalysesTable.id, id));
  if (!analysis) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const buffer = await exportAiAnalysisPdf({
    month: analysis.month,
    depth: analysis.depth as AnalysisDepth,
    model: analysis.model,
    createdAt: analysis.createdAt,
    result: (analysis.resultJson as AnalysisResult) ?? null,
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="PTMT_AI_Analysis_${analysis.month}_${id}.pdf"`);
  res.send(buffer);
});

// ──────────────────── PLANT AI ROUTES ────────────────────

router.post("/ai/analyze-plant", async (req, res): Promise<void> => {
  const month = String(req.body?.month ?? "");
  const depth = parseDepth(req.body?.depth);
  if (!month) {
    res.status(400).json({ error: "month is required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  try {
    const bundle = await computePlantBundle(month);
    const packet = buildPlantPacket(bundle);
    const packetHash = hashPlantPacket(packet);
    const model = modelForDepth(depth);

    const [existing] = await db
      .select()
      .from(aiPlantAnalysesTable)
      .where(eq(aiPlantAnalysesTable.packetHash, packetHash))
      .orderBy(desc(aiPlantAnalysesTable.createdAt))
      .limit(1);

    if (existing && existing.depth === depth && existing.resultJson) {
      res.write(`data: ${JSON.stringify({ cached: true, id: existing.id, result: existing.resultJson })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true, id: existing.id })}\n\n`);
      res.end();
      return;
    }

    const client = getAnthropicClient();
    let fullText = "";
    const stream = client.messages.stream({
      model,
      max_tokens: 8192,
      system: PLANT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildPlantUserMessage(packet) }],
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        fullText += event.delta.text;
        res.write(`data: ${JSON.stringify({ delta: event.delta.text })}\n\n`);
      }
    }

    let result: PlantAnalysisResult | null = null;
    let parseError: string | null = null;
    try {
      result = extractJson(fullText) as PlantAnalysisResult;
    } catch (err) {
      parseError = err instanceof Error ? err.message : "Failed to parse model output as JSON";
      logger.error({ err, month }, "ai-analytics-plant: failed to parse Claude response as JSON");
    }

    const [row] = await db
      .insert(aiPlantAnalysesTable)
      .values({
        month,
        snapshotDate: bundle.context.snapshotDate,
        depth,
        model,
        packetHash,
        packetJson: packet,
        resultJson: result,
      })
      .returning();

    if (parseError) {
      res.write(`data: ${JSON.stringify({ error: parseError, id: row.id })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ done: true, id: row.id, result })}\n\n`);
    res.end();
  } catch (err) {
    logger.error({ err, month }, "ai-analytics-plant: analyze failed");
    res.write(`data: ${JSON.stringify({ error: err instanceof Error ? err.message : "Analysis failed" })}\n\n`);
    res.end();
  }
});

router.post("/ai/plant-analyses/:id/followup", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const question = String(req.body?.question ?? "");
  if (!id || !question) {
    res.status(400).json({ error: "id and question are required" });
    return;
  }

  const [analysis] = await db.select().from(aiPlantAnalysesTable).where(eq(aiPlantAnalysesTable.id, id));
  if (!analysis) {
    res.status(404).json({ error: "analysis not found" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  try {
    const priorMessages = await db
      .select()
      .from(aiPlantAnalysisMessagesTable)
      .where(eq(aiPlantAnalysisMessagesTable.analysisId, id))
      .orderBy(aiPlantAnalysisMessagesTable.createdAt);

    const packet = analysis.packetJson as PlantAnalysisPacket;
    const conversation: Array<{ role: "user" | "assistant"; content: string }> = [
      { role: "user", content: buildPlantUserMessage(packet) },
      ...(analysis.resultJson
        ? [{ role: "assistant" as const, content: JSON.stringify(analysis.resultJson) }]
        : []),
      ...priorMessages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      { role: "user" as const, content: question },
    ];

    await db.insert(aiPlantAnalysisMessagesTable).values({ analysisId: id, role: "user", content: question });

    const client = getAnthropicClient();
    let fullText = "";
    const stream = client.messages.stream({
      model: analysis.model,
      max_tokens: 2048,
      system: `${PLANT_SYSTEM_PROMPT}\n\nYou are now answering a manager's follow-up question. Ground your answer strictly in the data packet and prior analysis already provided. Respond in plain text, not JSON, unless the question asks for structured data.`,
      messages: conversation,
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        fullText += event.delta.text;
        res.write(`data: ${JSON.stringify({ delta: event.delta.text })}\n\n`);
      }
    }

    await db.insert(aiPlantAnalysisMessagesTable).values({ analysisId: id, role: "assistant", content: fullText });

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    logger.error({ err, id }, "ai-analytics-plant: followup failed");
    res.write(`data: ${JSON.stringify({ error: err instanceof Error ? err.message : "Follow-up failed" })}\n\n`);
    res.end();
  }
});

router.get("/ai/plant-analyses", async (req, res): Promise<void> => {
  const month = String(req.query.month ?? "");
  if (!month) {
    res.status(400).json({ error: "month is required" });
    return;
  }
  const rows = await db
    .select({
      id: aiPlantAnalysesTable.id,
      month: aiPlantAnalysesTable.month,
      snapshotDate: aiPlantAnalysesTable.snapshotDate,
      depth: aiPlantAnalysesTable.depth,
      model: aiPlantAnalysesTable.model,
      createdAt: aiPlantAnalysesTable.createdAt,
    })
    .from(aiPlantAnalysesTable)
    .where(eq(aiPlantAnalysesTable.month, month))
    .orderBy(desc(aiPlantAnalysesTable.createdAt));
  res.json(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

router.get("/ai/plant-analyses/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [analysis] = await db.select().from(aiPlantAnalysesTable).where(eq(aiPlantAnalysesTable.id, id));
  if (!analysis) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const messages = await db
    .select()
    .from(aiPlantAnalysisMessagesTable)
    .where(eq(aiPlantAnalysisMessagesTable.analysisId, id))
    .orderBy(aiPlantAnalysisMessagesTable.createdAt);
  res.json({
    id: analysis.id,
    month: analysis.month,
    snapshotDate: analysis.snapshotDate,
    depth: analysis.depth,
    model: analysis.model,
    createdAt: analysis.createdAt.toISOString(),
    result: analysis.resultJson,
    messages: messages.map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt.toISOString() })),
  });
});

router.get("/ai/plant-analyses/:id/export/pdf", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [analysis] = await db.select().from(aiPlantAnalysesTable).where(eq(aiPlantAnalysesTable.id, id));
  if (!analysis) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const buffer = await exportPlantAnalysisPdf({
    month: analysis.month,
    depth: analysis.depth as AnalysisDepth,
    model: analysis.model,
    createdAt: analysis.createdAt,
    result: (analysis.resultJson as PlantAnalysisResult) ?? null,
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="PTMT_Plant_AI_${analysis.month}_${id}.pdf"`);
  res.send(buffer);
});

export default router;

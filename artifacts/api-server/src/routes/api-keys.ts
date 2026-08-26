import { Router } from "express";
import { createHash, randomBytes } from "crypto";
import { db } from "@workspace/db";
import { apiKeysTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { requireAdmin } from "./session-middleware";

const router = Router();
router.use(requireAdmin);

function generateKey(): { raw: string; hash: string; prefix: string } {
  const random = randomBytes(32).toString("hex");
  const raw = `pptmt_${random}`;
  const hash = createHash("sha256").update(raw).digest("hex");
  const prefix = raw.slice(0, 14);
  return { raw, hash, prefix };
}

export async function validateApiKey(key: string): Promise<ApiKey | null> {
  const hash = createHash("sha256").update(key).digest("hex");
  const [row] = await db
    .select()
    .from(apiKeysTable)
    .where(eq(apiKeysTable.keyHash, hash))
    .limit(1);
  if (!row || !row.isActive) return null;
  await db
    .update(apiKeysTable)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeysTable.id, row.id));
  return row;
}

type ApiKey = typeof apiKeysTable.$inferSelect;

const SAFE_COLS = {
  id: apiKeysTable.id,
  name: apiKeysTable.name,
  description: apiKeysTable.description,
  consumer: apiKeysTable.consumer,
  scopes: apiKeysTable.scopes,
  segmentScopes: apiKeysTable.segmentScopes,
  keyPrefix: apiKeysTable.keyPrefix,
  isActive: apiKeysTable.isActive,
  createdAt: apiKeysTable.createdAt,
  lastUsedAt: apiKeysTable.lastUsedAt,
};

router.get("/api-keys", async (_req, res): Promise<void> => {
  try {
    const keys = await db
      .select(SAFE_COLS)
      .from(apiKeysTable)
      .orderBy(apiKeysTable.createdAt);
    res.json(keys);
  } catch (err) {
    logger.error({ err }, "api-keys: list failed");
    res.status(500).json({ error: "Failed to list API keys" });
  }
});

router.post("/api-keys", async (req, res): Promise<void> => {
  const { name, description, consumer, scopes, segmentScopes } = req.body ?? {};
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "name is required" });
    return;
  }
  try {
    const validConsumers = new Set(["machine-analysis", "mis", "legacy"]);
    const validScopes = new Set(["read", "write"]);
    const validSegments = new Set(["PTMT", "Plumbing"]);
    const requestedScopes = Array.isArray(scopes)
      ? scopes.filter((value): value is string => typeof value === "string" && validScopes.has(value))
      : ["read", "write"];
    const requestedSegments = Array.isArray(segmentScopes)
      ? segmentScopes.filter((value): value is string => typeof value === "string" && validSegments.has(value))
      : ["PTMT", "Plumbing"];
    if (consumer !== undefined && (typeof consumer !== "string" || !validConsumers.has(consumer))) {
      res.status(400).json({ error: "consumer must be machine-analysis, mis, or legacy" });
      return;
    }
    if (requestedScopes.length === 0 || requestedSegments.length === 0) {
      res.status(400).json({ error: "scopes and segmentScopes must contain at least one supported value" });
      return;
    }
    const { raw, hash, prefix } = generateKey();
    const [row] = await db
      .insert(apiKeysTable)
      .values({
        name: name.trim(),
        description: description || null,
        consumer: consumer ?? "legacy",
        scopes: requestedScopes,
        segmentScopes: requestedSegments,
        keyHash: hash,
        keyPrefix: prefix,
      })
      .returning();
    const { keyHash: _omit, ...safe } = row;
    res.status(201).json({ ...safe, key: raw });
  } catch (err) {
    logger.error({ err }, "api-keys: create failed");
    res.status(500).json({ error: "Failed to create API key" });
  }
});

router.delete("/api-keys/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.delete(apiKeysTable).where(eq(apiKeysTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, id }, "api-keys: delete failed");
    res.status(500).json({ error: "Failed to delete API key" });
  }
});

router.post("/api-keys/:id/regenerate", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const { raw, hash, prefix } = generateKey();
    const [row] = await db
      .update(apiKeysTable)
      .set({ keyHash: hash, keyPrefix: prefix, lastUsedAt: null })
      .where(eq(apiKeysTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Key not found" }); return; }
    const { keyHash: _omit, ...safe } = row;
    res.status(200).json({ ...safe, key: raw });
  } catch (err) {
    logger.error({ err, id }, "api-keys: regenerate failed");
    res.status(500).json({ error: "Failed to regenerate API key" });
  }
});

export default router;

import { Router, type IRouter } from "express";
import { requireAdmin } from "./session-middleware";
import {
  buildCatalogueCategoryReport,
  CATALOGUE_PLANNING_SEGMENTS,
  fetchAllCatalogueProducts,
  getCategoryMappings,
  getMasterProductCoverage,
  mapCatalogueDivision,
  syncMasterProducts,
  upsertCategoryMapping,
  getProducts,
  reclassifyProduct,
  InvalidProductClassificationError,
  type ProductClassificationStatus,
} from "../lib/master-products";
import { getRateListReport } from "../lib/rate-list";

const router: IRouter = Router();

function isSegment(value: unknown): value is "PTMT" | "Plumbing" | "CP" {
  return CATALOGUE_PLANNING_SEGMENTS.includes(String(value) as "PTMT" | "Plumbing" | "CP");
}

router.get("/master-products/products", async (req, res): Promise<void> => {
  const segment = String(req.query.segment ?? "PTMT");
  if (!isSegment(segment)) {
    res.status(400).json({ error: "INVALID_SEGMENT", message: "segment must be PTMT, Plumbing, or CP." });
    return;
  }
  const status = req.query.status == null ? undefined : String(req.query.status);
  if (status && !["classified", "unclassified", "ambiguous"].includes(status)) {
    res.status(400).json({ error: "INVALID_STATUS", message: "status must be classified, unclassified, or ambiguous." });
    return;
  }
  const source = req.query.source == null ? undefined : String(req.query.source);
   if (source && !["workbook", "rate-list", "catalogue", "seed"].includes(source)) {
    res.status(400).json({ error: "INVALID_SOURCE", message: "source must be workbook, rate-list, catalogue, or seed." });
    return;
  }
  try {
    res.json(await getProducts({
      segment,
      status: status as ProductClassificationStatus | undefined,
      category: req.query.category == null ? undefined : String(req.query.category),
       source: source as "workbook" | "rate-list" | "catalogue" | "seed" | undefined,
      search: req.query.search == null ? undefined : String(req.query.search),
    }));
  } catch (error) {
    if (error instanceof InvalidProductClassificationError) {
      res.status(400).json({
        error: error.code,
        message: error.message,
      });
      return;
    }
    res.status(500).json({
      error: "PRODUCTS_FAILED",
      message: error instanceof Error ? error.message : "Could not load products.",
    });
  }
});

router.patch("/master-products/products/:itemCode/:colour", requireAdmin, async (req, res): Promise<void> => {
  const segment = String(req.body?.segment ?? "");
  const status = String(req.body?.status ?? "");
  const category = typeof req.body?.category === "string" ? req.body.category : "";
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!isSegment(segment) || !["classified", "unclassified", "ambiguous"].includes(status) || !category.trim() || !reason) {
    res.status(400).json({
      error: "INVALID_RECLASSIFICATION",
      message: "segment, category, status, and a non-empty reason are required.",
    });
    return;
  }
  const changedBy = req.sessionUser?.email ?? "admin";
  try {
    const updated = await reclassifyProduct({
      segment,
      itemCode: String(req.params.itemCode),
      colour: decodeURIComponent(String(req.params.colour)),
      category,
      status: status as ProductClassificationStatus,
      reason,
      changedBy,
    });
    if (!updated) {
      res.status(404).json({ error: "PRODUCT_NOT_IN_PLANNING_ROSTER", message: "Only planning-roster rows can be reclassified." });
      return;
    }
    res.json({ ok: true, product: updated });
  } catch (error) {
    res.status(500).json({
      error: "RECLASSIFICATION_FAILED",
      message: error instanceof Error ? error.message : "Could not reclassify product.",
    });
  }
});

// Reproducible first milestone: source vocabulary only, no database mutation.
router.get("/master-products/source-categories", async (_req, res): Promise<void> => {
  try {
    const products = await fetchAllCatalogueProducts();
    res.json(buildCatalogueCategoryReport(products));
  } catch (error) {
    res.status(502).json({
      error: "CATALOGUE_SOURCE_UNAVAILABLE",
      message: error instanceof Error ? error.message : "Catalogue source unavailable.",
    });
  }
});

router.get("/master-products/category-mappings", async (_req, res): Promise<void> => {
  try {
    res.json(await getCategoryMappings());
  } catch (error) {
    res.status(500).json({
      error: "CATEGORY_MAPPINGS_FAILED",
      message: error instanceof Error ? error.message : "Could not load category mappings.",
    });
  }
});

router.put("/master-products/category-mappings", requireAdmin, async (req, res): Promise<void> => {
  const division = typeof req.body?.division === "string" ? req.body.division.trim() : "";
  const rawCategoryValue = req.body?.rawCategory;
  const rawCategory = rawCategoryValue == null || String(rawCategoryValue).trim() === ""
    ? null
    : String(rawCategoryValue).trim();
  const segment = typeof req.body?.segment === "string" ? req.body.segment.trim() : "";
  const planningCategory = typeof req.body?.planningCategory === "string"
    ? req.body.planningCategory.trim()
    : "";
  if (!division || !planningCategory || !CATALOGUE_PLANNING_SEGMENTS.includes(segment as never)) {
    res.status(400).json({
      error: "INVALID_CATEGORY_MAPPING",
      message: "division, segment (PTMT, Plumbing, or CP), and planningCategory are required.",
    });
    return;
  }
  const divisionSegment = mapCatalogueDivision(division);
  if (!divisionSegment || divisionSegment !== segment) {
    res.status(400).json({
      error: "INVALID_CATEGORY_MAPPING",
      message: "Mappings may only target the exact planning segment of a clean catalogue division.",
    });
    return;
  }
  try {
    const [mapping] = await upsertCategoryMapping({
      division,
      rawCategory,
      segment: segment as "PTMT" | "Plumbing" | "CP",
      planningCategory,
    });
    res.json(mapping);
  } catch (error) {
    res.status(500).json({
      error: "CATEGORY_MAPPING_FAILED",
      message: error instanceof Error ? error.message : "Could not save category mapping.",
    });
  }
});

router.post("/master-products/sync", requireAdmin, async (_req, res): Promise<void> => {
  try {
    const result = await syncMasterProducts();
    res.json(result);
  } catch (error) {
    res.status(502).json({
      error: "MASTER_PRODUCTS_SYNC_FAILED",
      message: error instanceof Error ? error.message : "Master product sync failed.",
    });
  }
});

router.get("/master-products/coverage", async (_req, res): Promise<void> => {
  try {
    const segments = await getMasterProductCoverage();
    res.json({
      source: "competition-analysis",
      planningRoster: "item_master",
      segments,
      note: "Catalogue-only products are visible for review and are not part of planning until category mappings are approved.",
    });
  } catch (error) {
    res.status(500).json({
      error: "MASTER_PRODUCTS_COVERAGE_FAILED",
      message: error instanceof Error ? error.message : "Could not build master product coverage.",
    });
  }
});

router.get("/master-products/rate-list-report", async (_req, res): Promise<void> => {
  try {
    res.json(await getRateListReport());
  } catch (error) {
    res.status(500).json({
      error: "RATE_LIST_REPORT_FAILED",
      message: error instanceof Error ? error.message : "Could not build the rate-list report.",
    });
  }
});

export default router;
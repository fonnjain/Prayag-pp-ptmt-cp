/**
 * Item-master coverage report (data-governance input) — one-off diagnostic.
 *
 * Direction A: source stock codes (latest current_stock upload) with stock but
 *   ABSENT from the PTMT item master — the plan cannot see this stock, so those
 *   items are never planned (under-production risk).
 * Direction B: plan/roster codes with NO entry in the FG stock upload
 *   (stockNeedsReview) — planned against assumed-zero stock (over-production risk).
 *
 * READ-ONLY: makes no changes to item_master or uploads. Adding/dropping items
 * is a business decision — this report is the input to it.
 *
 * Run: pnpm --filter @workspace/api-server exec tsx src/scripts/item-master-coverage-report.ts
 */
import { db, itemMasterTable, uploadedFilesTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import path from "node:path";

const API_BASE = process.env["API_BASE"] ?? "http://localhost:8080";
const MONTH = process.env["PTMT_PLAN_MONTH"] ?? "2026-08";

const norm = (v: unknown) => String(v ?? "").trim().toUpperCase();

async function main() {
  // ── Load inputs ─────────────────────────────────────────────────────────
  const [stockFile] = await db
    .select({ rows: uploadedFilesTable.rows, uploadedAt: uploadedFilesTable.uploadedAt })
    .from(uploadedFilesTable)
    .where(eq(uploadedFilesTable.kind, "current_stock"))
    .orderBy(desc(uploadedFilesTable.uploadedAt))
    .limit(1);
  if (!stockFile) throw new Error("No current_stock upload found");
  const stockRows = stockFile.rows as Record<string, unknown>[];

  const masterRows = await db
    .select({ itemCode: itemMasterTable.itemCode, category: itemMasterTable.category })
    .from(itemMasterTable)
    .where(eq(itemMasterTable.segment, "PTMT"));
  const masterCodes = new Map<string, string>(); // code -> category (first seen)
  for (const r of masterRows) {
    const c = norm(r.itemCode);
    if (!masterCodes.has(c)) masterCodes.set(c, r.category);
  }

  const planRes = await fetch(`${API_BASE}/api/plan?segment=PTMT&month=${MONTH}`);
  if (!planRes.ok) throw new Error(`GET /plan failed: ${planRes.status}`);
  const planItems = (await planRes.json()) as Array<{
    itemCode: string; colour: string; category: string; avg3MoSale: number;
    stock: number; stockNeedsReview: boolean; maxProduction: number;
  }>;

  // ── Direction A: stock in source, absent from item master ───────────────
  const qtyKeys = ["Qty", "Closing Stock", "C/Stock", "C Stock"];
  type SrcRow = { code: string; colour: string; qty: number };
  const srcAgg = new Map<string, SrcRow>();
  for (const row of stockRows) {
    const code = norm(row["Item Code"] ?? row["Cat No"] ?? row["Code"]);
    if (!code) continue;
    const colour = norm(row["Colour"] ?? row["Color"]);
    let qty = 0;
    for (const k of qtyKeys) { const v = Number(row[k]); if (!isNaN(v) && row[k] !== undefined && row[k] !== "") { qty = v; break; } }
    const key = `${code}::${colour}`;
    const prev = srcAgg.get(key) ?? { code, colour, qty: 0 };
    prev.qty += qty;
    srcAgg.set(key, prev);
  }
  // Likely family: longest master code that prefixes the source code (≥3 chars)
  const masterCodeList = [...masterCodes.keys()].sort((a, b) => b.length - a.length);
  const likelyFamily = (code: string): { family: string; category: string } | null => {
    for (const m of masterCodeList) {
      if (m.length >= 3 && (code.startsWith(m) || m.startsWith(code) && code.length >= 3)) {
        return { family: m, category: masterCodes.get(m)! };
      }
    }
    return null;
  };
  const dirA = [...srcAgg.values()]
    .filter((r) => r.qty > 0 && !masterCodes.has(r.code))
    .map((r) => ({ ...r, ...(likelyFamily(r.code) ?? { family: "", category: "— unmapped —" }) }))
    .sort((a, b) => a.category.localeCompare(b.category) || b.qty - a.qty);
  const dirAUnits = dirA.reduce((a, b) => a + b.qty, 0);
  const dirACodes = new Set(dirA.map((r) => r.code)).size;

  // ── Direction B: plan codes with no FG stock entry ──────────────────────
  const dirB = planItems
    .filter((i) => i.stockNeedsReview)
    .map((i) => ({ category: i.category, code: i.itemCode, colour: i.colour, avg3Mo: Math.round(i.avg3MoSale), plannedMax: Math.round(i.maxProduction) }))
    .sort((a, b) => a.category.localeCompare(b.category) || b.plannedMax - a.plannedMax);
  const dirBPlanned = dirB.reduce((a, b) => a + b.plannedMax, 0);

  // ── Excel output ─────────────────────────────────────────────────────────
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();

  const s1 = wb.addWorksheet("A · Stock not in item master");
  s1.columns = [
    { header: "Likely category (via code family)", key: "category", width: 34 },
    { header: "Source code", key: "code", width: 16 },
    { header: "Colour", key: "colour", width: 12 },
    { header: "Stock units", key: "qty", width: 12 },
    { header: "Nearest master code", key: "family", width: 18 },
  ];
  s1.addRows(dirA);
  s1.getRow(1).font = { bold: true };

  const s2 = wb.addWorksheet("B · Plan codes w-o FG entry");
  s2.columns = [
    { header: "Category", key: "category", width: 30 },
    { header: "Plan code", key: "code", width: 16 },
    { header: "Colour", key: "colour", width: 12 },
    { header: "Avg 3-mo sale", key: "avg3Mo", width: 14 },
    { header: "Planned Max (vs assumed-zero stock)", key: "plannedMax", width: 30 },
  ];
  s2.addRows(dirB);
  s2.getRow(1).font = { bold: true };

  const s3 = wb.addWorksheet("Summary");
  s3.addRows([
    ["Item-master coverage report — PTMT", MONTH],
    ["Stock upload", String(stockFile.uploadedAt)],
    [],
    ["A · Source codes with stock, absent from item master", dirACodes, "codes"],
    ["A · Units of stock invisible to the plan", Math.round(dirAUnits), "units"],
    ["B · Plan codes with no FG stock entry", dirB.length, "code+colour rows"],
    ["B · Planned Max against assumed-zero stock", dirBPlanned, "pcs"],
    [],
    ["No items were added or dropped — business decision required per row."],
  ]);
  s3.getColumn(1).width = 52;

  const out = path.resolve(process.cwd(), "../../reports/item-master-coverage-ptmt-" + MONTH + ".xlsx");
  await wb.xlsx.writeFile(out);

  // Console summary (per category)
  const catA = new Map<string, { codes: Set<string>; units: number }>();
  for (const r of dirA) { const e = catA.get(r.category) ?? { codes: new Set(), units: 0 }; e.codes.add(r.code); e.units += r.qty; catA.set(r.category, e); }
  const catB = new Map<string, { rows: number; planned: number }>();
  for (const r of dirB) { const e = catB.get(r.category) ?? { rows: 0, planned: 0 }; e.rows++; e.planned += r.plannedMax; catB.set(r.category, e); }
  console.log(`A: ${dirACodes} codes / ${Math.round(dirAUnits)} units not in item master`);
  for (const [c, e] of [...catA].sort((x, y) => y[1].units - x[1].units)) console.log(`  A ${c}: ${e.codes.size} codes, ${Math.round(e.units)} units`);
  console.log(`B: ${dirB.length} plan rows with no FG entry, planned Max ${dirBPlanned}`);
  for (const [c, e] of [...catB].sort((x, y) => y[1].planned - x[1].planned)) console.log(`  B ${c}: ${e.rows} rows, planned ${e.planned}`);
  console.log(`Written: ${out}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

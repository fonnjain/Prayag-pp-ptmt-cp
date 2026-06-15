import { sql, eq, and } from "drizzle-orm";
import { db, calendarSettings } from "@workspace/db";
import type { EngineInput } from "../lib/engine";

function parseDate(s: string): Date {
  return new Date(`${s.slice(0, 10)}T00:00:00Z`);
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addMonths(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCMonth(r.getUTCMonth() + n);
  return r;
}

function endOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

export interface GatherResult {
  inputs: EngineInput[];
  workingDays: number;
  planMonthFrom: string;
  planMonthTo: string;
}

interface Agg {
  itemCode: string;
  colour: string;
  last3Sale: number;
  lastMonthSale: number;
  avgSaleAnnual: number;
  sale2m: number;
  sale10m: number;
  openingStock: number;
  pendingLast: number;
  pendingCurrent: number;
  produced: number;
  orderAsOn: number;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function newAgg(itemCode: string, colour: string): Agg {
  return {
    itemCode,
    colour: colour ?? "",
    last3Sale: 0,
    lastMonthSale: 0,
    avgSaleAnnual: 0,
    sale2m: 0,
    sale10m: 0,
    openingStock: 0,
    pendingLast: 0,
    pendingCurrent: 0,
    produced: 0,
    orderAsOn: 0,
  };
}

// Gather aggregated per-item inputs for the deterministic engine.
export async function gatherInputs(
  division: string,
  planMonth: string,
): Promise<GatherResult> {
  const pm = parseDate(planMonth);
  const pmFrom = ymd(pm);
  const pmTo = ymd(endOfMonth(pm));

  const cal = await db
    .select()
    .from(calendarSettings)
    .where(
      and(
        eq(calendarSettings.division, division),
        eq(calendarSettings.planMonth, pmFrom),
      ),
    )
    .limit(1);
  const calRow = cal[0];

  const l3from = calRow?.last3From ?? ymd(addMonths(pm, -3));
  const l3to = calRow?.last3To ?? ymd(new Date(pm.getTime() - 86400000));
  const stockAsOn = calRow?.stockAsOn ?? pmFrom;
  const workingDays = calRow?.workingDays ?? 26;

  const lmFrom = ymd(addMonths(pm, -1));
  const lmTo = ymd(new Date(pm.getTime() - 86400000));
  const annFrom = ymd(addMonths(pm, -12));
  const annTo = lmTo;
  const m2from = ymd(addMonths(pm, -2));
  const m10from = ymd(addMonths(pm, -10));

  // The plan covers ONLY the curated master catalogue (roster), not every sold
  // code. The roster is the set of item keys in stock_opening (read from the
  // master TOP ITEM / Sheet3 tab). PTMT keys item_code+colour; CP rolls up to
  // item_code (colour collapsed to ''). Sales / pending / production / orders are
  // INNER-joined onto this roster: rows whose key is not in the roster are
  // dropped, and (for CP) multiple colours of the same code accumulate into one
  // line. This is the fix for the prior "scope explosion" where the roster was
  // seeded from sales and every sold/trading code inflated the plan ~4-6x.
  const isPTMT = division === "PTMT";
  const rosterKey = (itemCode: string, colour: string): string =>
    isPTMT ? `${itemCode}||${colour ?? ""}` : `${itemCode}||`;

  const map = new Map<string, Agg>();
  // Roster + opening stock (most recent snapshot at/before stock_as_on).
  const stockRes = await db.execute(sql`
    SELECT DISTINCT ON (item_code, COALESCE(colour,'')) item_code, COALESCE(colour,'') AS colour, qty
    FROM stock_opening WHERE division = ${division} AND as_on <= ${stockAsOn}
    ORDER BY item_code, COALESCE(colour,''), as_on DESC
  `);
  for (const r of stockRes.rows as Record<string, unknown>[]) {
    const itemCode = String(r["item_code"]);
    const colour = isPTMT ? String(r["colour"] ?? "") : "";
    const k = rosterKey(itemCode, colour);
    let a = map.get(k);
    if (!a) {
      a = newAgg(itemCode, colour);
      map.set(k, a);
    }
    a.openingStock += num(r["qty"]);
  }

  // Join helper: returns the roster bucket for a key, or undefined if the key is
  // not in the roster (inner join — non-roster rows are ignored).
  const join = (itemCode: string, colour: string): Agg | undefined =>
    map.get(rosterKey(itemCode, colour));

  // Sales windows (conditional sums in one pass)
  const salesRes = await db.execute(sql`
    SELECT item_code, COALESCE(colour,'') AS colour,
      COALESCE(SUM(qty) FILTER (WHERE sale_date BETWEEN ${l3from} AND ${l3to}),0) AS last3,
      COALESCE(SUM(qty) FILTER (WHERE sale_date BETWEEN ${lmFrom} AND ${lmTo}),0) AS last_month,
      COALESCE(SUM(qty) FILTER (WHERE sale_date BETWEEN ${annFrom} AND ${annTo}),0) AS annual,
      COALESCE(SUM(qty) FILTER (WHERE sale_date BETWEEN ${m2from} AND ${annTo}),0) AS s2m,
      COALESCE(SUM(qty) FILTER (WHERE sale_date BETWEEN ${m10from} AND ${annTo}),0) AS s10m
    FROM sales WHERE division = ${division} AND item_code IS NOT NULL
    GROUP BY item_code, COALESCE(colour,'')
  `);
  for (const r of salesRes.rows as Record<string, unknown>[]) {
    const a = join(String(r["item_code"]), String(r["colour"] ?? ""));
    if (!a) continue;
    a.last3Sale += num(r["last3"]);
    a.lastMonthSale += num(r["last_month"]);
    a.avgSaleAnnual += num(r["annual"]) / 12;
    a.sale2m += num(r["s2m"]);
    a.sale10m += num(r["s10m"]);
  }

  // Pending orders for this plan month
  const pendRes = await db.execute(sql`
    SELECT item_code, COALESCE(colour,'') AS colour,
      COALESCE(SUM(qty) FILTER (WHERE period='last_month'),0) AS p_last,
      COALESCE(SUM(qty) FILTER (WHERE period='current'),0) AS p_current
    FROM pending_orders WHERE division = ${division} AND plan_month = ${pmFrom}
    GROUP BY item_code, COALESCE(colour,'')
  `);
  for (const r of pendRes.rows as Record<string, unknown>[]) {
    const a = join(String(r["item_code"]), String(r["colour"] ?? ""));
    if (!a) continue;
    a.pendingLast += num(r["p_last"]);
    a.pendingCurrent += num(r["p_current"]);
  }

  // Production already done in plan month
  const prodRes = await db.execute(sql`
    SELECT item_code, COALESCE(colour,'') AS colour, COALESCE(SUM(qty),0) AS produced
    FROM production WHERE division = ${division} AND prod_date BETWEEN ${pmFrom} AND ${pmTo}
    GROUP BY item_code, COALESCE(colour,'')
  `);
  for (const r of prodRes.rows as Record<string, unknown>[]) {
    const a = join(String(r["item_code"]), String(r["colour"] ?? ""));
    if (!a) continue;
    a.produced += num(r["produced"]);
  }

  // Open orders snapshot (order as on)
  const orderRes = await db.execute(sql`
    SELECT item_code, COALESCE(colour,'') AS colour, COALESCE(SUM(qty),0) AS order_qty
    FROM orders WHERE division = ${division}
    GROUP BY item_code, COALESCE(colour,'')
  `);
  for (const r of orderRes.rows as Record<string, unknown>[]) {
    const a = join(String(r["item_code"]), String(r["colour"] ?? ""));
    if (!a) continue;
    a.orderAsOn += num(r["order_qty"]);
  }

  // Items master attributes
  const itemsRes = await db.execute(sql`
    SELECT item_code, model, category, type, grp, sale_rate, mrp, name
    FROM items WHERE division = ${division}
  `);
  const itemMeta = new Map<
    string,
    { model: string | null; category: string | null; report: string | null; rate: number }
  >();
  for (const r of itemsRes.rows as Record<string, unknown>[]) {
    itemMeta.set(String(r["item_code"]), {
      model: (r["model"] as string) ?? null,
      category: (r["category"] as string) ?? (r["grp"] as string) ?? null,
      report: (r["grp"] as string) ?? (r["type"] as string) ?? null,
      rate: num(r["sale_rate"]) || num(r["mrp"]) || 0,
    });
  }

  const inputs: EngineInput[] = [];
  for (const a of map.values()) {
    const meta = itemMeta.get(a.itemCode);
    inputs.push({
      itemCode: a.itemCode,
      colour: a.colour,
      model: meta?.model ?? null,
      category: meta?.category ?? null,
      report: meta?.report ?? null,
      last3Sale: a.last3Sale,
      lastMonthSale: a.lastMonthSale,
      avgSaleAnnual: a.avgSaleAnnual,
      sale2m: a.sale2m,
      sale10m: a.sale10m,
      openingStock: a.openingStock,
      pendingLast: a.pendingLast,
      pendingCurrent: a.pendingCurrent,
      produced: a.produced,
      orderAsOn: a.orderAsOn,
      rate: meta?.rate ?? 0,
    });
  }

  return { inputs, workingDays, planMonthFrom: pmFrom, planMonthTo: pmTo };
}

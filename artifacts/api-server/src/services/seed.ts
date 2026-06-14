import { db, sourceConfig, type InsertSourceConfig } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";

// Base Google Sheets source configuration (PTMT + CP). This is reference data the
// ingestion service needs in EVERY environment — without it, a data pull selects
// no sources and produces an empty plan. Migrations only create schema, not rows,
// so production starts empty unless we seed it here on startup.
//
// Seeding is idempotent: rows are inserted only when missing (ON CONFLICT on the
// (division, data_type, file_id, tab_pattern) unique key DO NOTHING), so it never
// overwrites edits made through the Settings screen and is safe to run every boot.
//
// Fiscal-year rule (P2): the two sales workbooks are bounded by [appliesFrom,
// appliesTo] so monthApplies() selects the right file(s) per plan month. FY26-27
// (Sale 26-27) applies from 2026-04 onward; FY25-26 (Sale 25-26) applies through
// 2026-06 because a June plan's 3-month run-rate window still reaches back into
// FY25-26 (March 2026). For July+ plans the window no longer touches FY25-26, so
// it stops applying. This encodes the FY boundary while keeping the run-rate
// window correct (both files load for Apr/May/Jun, as the sanity source-model
// expects; only FY26-27 from July onward).
const BASE_SOURCE_CONFIG: InsertSourceConfig[] = [
  { division: "CP", dataType: "sales", fileId: "1rW9fvrdcmTy7Yd6RVV5dVpvZQ5knZMeKoMx8enZ6j24", tabPattern: "Combined", appliesFrom: "2026-04-01", notes: "Sale 26-27 — sales FY26-27 (Combined, full history); applies from Apr-2026" },
  { division: "CP", dataType: "sales", fileId: "1chx0hL67Vpz_uQMxFfQe1JBUVrCmdBFxfFaMvcd_-vE", tabPattern: "Combined", appliesTo: "2026-06-30", notes: "Sale 25-26 — sales FY25-26 (Combined, history tail for 12-month window); applies through Jun-2026" },
  { division: "CP", dataType: "orders", fileId: "1HFBAtvbAskejVkjuO8zHoEsE-pBAFij2ERMKFEvt64A", tabPattern: "Combined", notes: "Order Sheet 26-27 — Combined open order book" },
  { division: "CP", dataType: "production", fileId: "1xXY0XWG5f3Gz16qg-Y6O6szCnks1MbUT6VUd8Pa9eAk", tabPattern: "{month}", notes: "CP PRODUCTION 26-27 — daily actual production, tabs APR-26/MAY-26/JUN-26" },
  { division: "CP", dataType: "pending", fileId: "1cZQ1pdeAsoVj5aNS__D1aG84Dx5TmXH6lnybGMMGPMA", tabPattern: "{month}", notes: "CP pending orders — per-month tabs (Apr/May/June)" },
  { division: "CP", dataType: "rate_list", fileId: "1njO-srsS29qiE4t45-zr5njbB7R2Zb-oSnv2NL1ONY4", tabPattern: "", notes: "rate list — item master / rates (reference)" },
  { division: "PTMT", dataType: "sales", fileId: "1rW9fvrdcmTy7Yd6RVV5dVpvZQ5knZMeKoMx8enZ6j24", tabPattern: "Combined", appliesFrom: "2026-04-01", notes: "Sale 26-27 — sales FY26-27 (Combined, full history); applies from Apr-2026" },
  { division: "PTMT", dataType: "sales", fileId: "1chx0hL67Vpz_uQMxFfQe1JBUVrCmdBFxfFaMvcd_-vE", tabPattern: "Combined", appliesTo: "2026-06-30", notes: "Sale 25-26 — sales FY25-26 (Combined, history tail for 12-month window); applies through Jun-2026" },
  { division: "PTMT", dataType: "orders", fileId: "1HFBAtvbAskejVkjuO8zHoEsE-pBAFij2ERMKFEvt64A", tabPattern: "Combined", notes: "Order Sheet 26-27 — Combined open order book" },
  { division: "PTMT", dataType: "production", fileId: "1AGmksx4gn6w0Wb9EF__yAV5v89IyAfX_f75ouW2c7Yw", tabPattern: "", notes: "PTMT ANUJ — daily actual production on first Production tab" },
  { division: "PTMT", dataType: "rate_list", fileId: "1njO-srsS29qiE4t45-zr5njbB7R2Zb-oSnv2NL1ONY4", tabPattern: "", notes: "rate list — item master / rates (reference)" },
];

export async function seedSourceConfig(): Promise<void> {
  try {
    const before = await db.select({ c: sql<number>`count(*)` }).from(sourceConfig);
    const existing = Number(before[0]?.c ?? 0);

    await db.insert(sourceConfig).values(BASE_SOURCE_CONFIG).onConflictDoNothing();

    const after = await db.select({ c: sql<number>`count(*)` }).from(sourceConfig);
    const total = Number(after[0]?.c ?? 0);
    logger.info(
      { existing, inserted: total - existing, total },
      "source_config seed complete",
    );
  } catch (err) {
    // Don't crash the server if seeding fails — surface it loudly instead.
    logger.error({ err }, "source_config seed failed");
  }
}

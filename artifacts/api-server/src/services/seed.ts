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
const BASE_SOURCE_CONFIG: InsertSourceConfig[] = [
  { division: "CP", dataType: "sales", fileId: "1rW9fvrdcmTy7Yd6RVV5dVpvZQ5knZMeKoMx8enZ6j24", tabPattern: "Combined", notes: "Sale 26-27 — sales FY26-27 (Combined, full history)" },
  { division: "CP", dataType: "sales", fileId: "1chx0hL67Vpz_uQMxFfQe1JBUVrCmdBFxfFaMvcd_-vE", tabPattern: "Combined", notes: "Sale 25-26 — sales FY25-26 (Combined, history tail for 12-month window)" },
  { division: "CP", dataType: "orders", fileId: "1HFBAtvbAskejVkjuO8zHoEsE-pBAFij2ERMKFEvt64A", tabPattern: "Combined", notes: "Order Sheet 26-27 — Combined open order book" },
  { division: "CP", dataType: "production", fileId: "1xXY0XWG5f3Gz16qg-Y6O6szCnks1MbUT6VUd8Pa9eAk", tabPattern: "{month}", notes: "CP PRODUCTION 26-27 — daily actual production, tabs APR-26/MAY-26/JUN-26" },
  { division: "CP", dataType: "pending", fileId: "1cZQ1pdeAsoVj5aNS__D1aG84Dx5TmXH6lnybGMMGPMA", tabPattern: "{month}", notes: "CP pending orders — per-month tabs (Apr/May/June)" },
  { division: "CP", dataType: "rate_list", fileId: "1njO-srsS29qiE4t45-zr5njbB7R2Zb-oSnv2NL1ONY4", tabPattern: "", notes: "rate list — item master / rates (reference)" },
  { division: "PTMT", dataType: "sales", fileId: "1rW9fvrdcmTy7Yd6RVV5dVpvZQ5knZMeKoMx8enZ6j24", tabPattern: "Combined", notes: "Sale 26-27 — sales FY26-27 (Combined, full history)" },
  { division: "PTMT", dataType: "sales", fileId: "1chx0hL67Vpz_uQMxFfQe1JBUVrCmdBFxfFaMvcd_-vE", tabPattern: "Combined", notes: "Sale 25-26 — sales FY25-26 (Combined, history tail for 12-month window)" },
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

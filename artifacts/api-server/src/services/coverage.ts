import { and, desc, eq } from "drizzle-orm";
import {
  db,
  sourceConfig,
  coverageRuns,
  coverageDismissals,
  type InsertSourceConfig,
} from "@workspace/db";
import {
  driveListSpreadsheets,
  driveGetParents,
  type DriveFile,
} from "../lib/google";
import { callClaude, extractJSON, anthropicAvailable } from "../lib/anthropic";
import { logger } from "../lib/logger";
import type { SourceDiag } from "./ingestion";

// Explicit Drive root folder(s) the operator asked us to scan, in addition to
// the parents of every configured source file (resolved at scan time). Kept as
// a constant so the scan stays "broadest reasonable parents", not per-file.
const EXPLICIT_ROOT_FOLDERS = ["1J7t9Z_pyBYrEeWRGmPSVOPWI4iOs6rF5"];

const DIVISIONS = ["PTMT", "CP"];

export interface CoverageStaleItem {
  fileId: string;
  division: string | null;
  dataType: string | null;
  month: string | null;
  type: string;
  evidence: string;
  suggestedAction: string;
  confidence: string;
}

export interface CoverageDriftItem {
  fileId: string;
  type: string;
  evidence: string;
  suggestedAction: string;
  confidence: string;
}

export interface CoverageCandidate {
  fileId: string;
  title: string;
  guessedDivision: string | null;
  guessedDataType: string | null;
  guessedMonth: string | null;
  reason: string;
  shouldIngest: string;
  confidence: string;
}

export interface CoverageResult {
  division: string;
  planMonth: string;
  model: string | null;
  tier: string | null;
  looksComplete: boolean;
  notes: string | null;
  staleOrPartial: CoverageStaleItem[];
  drift: CoverageDriftItem[];
  unaccountedFiles: CoverageCandidate[];
  createdAt: string | null;
}

// The attached FUZZY-layer reviewer prompt, verbatim in intent: advisory only,
// cite file_ids, never expand scope, return strict JSON.
const FUZZY_SYSTEM = `You are a data-ingestion reviewer for a production-planning pipeline (divisions
PTMT and CP; per division a set of source files per data_type per plan month).

You are given:
- MANIFEST: the sources the pipeline fetched and what it found in each
  (file_id, file_title, data_type, tab_used, modified_time, rows_found,
  in_window_rows, date_range_in_data, columns_seen, aggregates incl. which
  column was used for each metric). It also includes drive_actual_count (how
  many spreadsheets were found under the configured Drive root folders) and
  EXPECTED_UNIVERSE (the division x data_type x month sources the pipeline knows
  to look for, plus the fiscal-year rule: Apr -> Sale 25-26; May onward ->
  Sale 26-27).
- COVERAGE: the pipeline's own deterministic expected-minus-fetched
  reconciliation (present_but_empty, not_found_at_all, stale_suspects) and
  schema_flags.
- UNACCOUNTED_RAW: Drive spreadsheets that are neither configured nor dismissed,
  already pre-filtered to plausibly-relevant data workbooks (still contains some
  junk you must filter).

Your job is the FUZZY layer only:

1. STALE / PARTIAL: Flag fetched sources that look present-but-stale or only
   partially filled. Compare date_range_in_data and modified_time against the
   plan-month window and AS_OF (e.g. production whose data_through is several
   days before AS_OF, or in_window_rows far below the previous accepted pull).

2. DRIFT: Flag naming or column/code drift the deterministic matcher might have
   mishandled — a file_title off the naming pattern, an item_code that doesn't
   map to the roster, or a *_col_used that looks wrong for that source (e.g. a
   stock read from the wrong tab/column, or an order quantity read from a Month
   column instead of the Quantity column).

3. UNACCOUNTED FILES: From UNACCOUNTED_RAW, judge which entries look like real
   source files the pipeline SHOULD ingest (e.g. a CP production workbook, a
   current-month master, or a sales/orders file following the naming pattern)
   versus templates, archives, duplicates, or next-month/other files. Surface
   only the plausible ones, each with your guess of division / data_type /
   month and why it was likely missed (new source, renamed file, file in an
   unscanned folder, naming drift).

4. EXPLAIN: For each gap, give the likely plain-English reason.

Hard rules:
- COVERAGE is authoritative. Do NOT recompute counts or override it. If you
  think it is wrong, raise it as a flag; do not silently restate it.
- Every claim MUST cite the specific file_id (or file_title) it refers to.
  No file_id, no claim.
- Do not assert a source is missing unless it appears in
  COVERAGE.not_found_at_all. 'present_but_empty' is a CONTENT gap — label it as
  such, not as missing.
- EXPECTED_UNIVERSE is the pipeline's current scope, NOT ground truth about what
  should exist. A file outside it is a CANDIDATE, never a confirmed miss, and
  must never be treated as auto-added to ingestion.
- You are advisory. You do not approve, sign off, or modify any figure, and you
  never expand ingestion scope.
- If unsure, say 'unverified' / use low confidence rather than guessing.

BREVITY IS MANDATORY. Keep every "evidence", "suggested_action", "reason", and
"notes_for_engineer" to ONE short sentence (max ~25 words). Do not write
paragraphs. Verbose output gets truncated and discarded, so be terse.

Return ONLY valid JSON. No prose, no markdown, no code fences. Shape:

{
  "stale_or_partial": [
    {"file_id": "...", "division": "...", "data_type": "...", "month": "...",
     "type": "stale|partial",
     "evidence": "...", "suggested_action": "...",
     "confidence": "high|medium|low"}
  ],
  "drift": [
    {"file_id": "...",
     "type": "naming_drift|code_mismatch|column_identity|other",
     "evidence": "...", "suggested_action": "...",
     "confidence": "high|medium|low"}
  ],
  "unaccounted_files": [
    {"file_id": "...", "title": "...",
     "guessed_division": "...", "guessed_data_type": "...", "guessed_month": "...",
     "reason": "...",
     "should_ingest": "likely|maybe|unlikely",
     "confidence": "high|medium|low"}
  ],
  "looks_complete": true,
  "notes_for_engineer": "..."
}`;

// Resolve the full set of Drive root folders to scan: the explicit folder(s)
// plus the distinct parent folder of every configured source file. Best-effort:
// a file whose parent we cannot read is simply skipped.
async function resolveRootFolders(): Promise<string[]> {
  const roots = new Set<string>(EXPLICIT_ROOT_FOLDERS);
  const cfgs = await db.select({ fileId: sourceConfig.fileId }).from(sourceConfig);
  const distinctFiles = [...new Set(cfgs.map((c) => c.fileId))];
  for (const fileId of distinctFiles) {
    try {
      const parents = await driveGetParents(fileId);
      for (const p of parents) roots.add(p);
    } catch (err) {
      logger.warn({ err, fileId }, "coverage: parent resolution failed");
    }
  }
  return [...roots];
}

// A full Drive scan is expensive (~90s over hundreds of folders) and identical
// across divisions/months, so cache it briefly. Both scheduled syncs (PTMT and
// CP) and a manual pull then share one scan instead of repeating it.
const DRIVE_CACHE_TTL_MS = 10 * 60 * 1000;
let driveCache: { at: number; files: DriveFile[] } | null = null;

// DRIVE_ACTUAL: every spreadsheet under any configured root folder, deduped.
async function listDriveActual(): Promise<DriveFile[]> {
  if (driveCache && Date.now() - driveCache.at < DRIVE_CACHE_TTL_MS) {
    return driveCache.files;
  }
  const roots = await resolveRootFolders();
  const byId = new Map<string, DriveFile>();
  for (const root of roots) {
    try {
      const files = await driveListSpreadsheets(root);
      for (const f of files) byId.set(f.id, f);
    } catch (err) {
      logger.warn({ err, root }, "coverage: drive folder scan failed");
    }
  }
  const files = [...byId.values()];
  // Only cache a non-empty scan; an empty result is likely a transient Drive
  // failure we don't want to pin for ten minutes.
  if (files.length > 0) driveCache = { at: Date.now(), files };
  return files;
}

interface ExpectedEntry {
  division: string;
  dataType: string;
  fileId: string;
  tabPattern: string | null;
}

async function buildExpectedUniverse(): Promise<ExpectedEntry[]> {
  const rows = await db
    .select({
      division: sourceConfig.division,
      dataType: sourceConfig.dataType,
      fileId: sourceConfig.fileId,
      tabPattern: sourceConfig.tabPattern,
    })
    .from(sourceConfig);
  return rows;
}

// Deterministic COVERAGE reconciliation. Authoritative; the model must not
// override it. Scoped to the division being reviewed.
function buildCoverage(
  division: string,
  planMonth: string,
  diags: SourceDiag[],
  expected: ExpectedEntry[],
  driveActual: DriveFile[],
) {
  const driveIds = new Set(driveActual.map((f) => f.id));
  const monthStart = `${planMonth.slice(0, 7)}-01`;
  const expectedForDiv = expected.filter((e) => e.division === division);

  const present_but_empty = diags
    .filter((d) => d.empty || d.inWindowRows === 0)
    .map((d) => ({
      file_id: d.fileId,
      data_type: d.dataType,
      in_window_rows: d.inWindowRows,
      rows: d.rows,
    }));

  const not_found_at_all = expectedForDiv
    .filter((e) => !driveIds.has(e.fileId))
    .map((e) => ({ file_id: e.fileId, data_type: e.dataType }));

  const driveById = new Map(driveActual.map((f) => [f.id, f]));
  const stale_suspects = expectedForDiv
    .map((e) => driveById.get(e.fileId))
    .filter((f): f is DriveFile => Boolean(f))
    .filter((f) => (f.modifiedTime ?? "") < monthStart)
    .map((f) => ({
      file_id: f.id,
      title: f.name,
      modified_time: f.modifiedTime,
      note: `not modified within plan month (since ${monthStart})`,
    }));

  const schema_flags = diags
    .filter((d) => d.missingColumns && d.missingColumns.length > 0)
    .map((d) => ({
      file_id: d.fileId,
      data_type: d.dataType,
      missing_columns: d.missingColumns,
    }));

  return { present_but_empty, not_found_at_all, stale_suspects, schema_flags };
}

// Keyword signals that a Drive spreadsheet might be an ingestion-worthy data
// source (sales/orders/production/stock workbooks for either division). Used to
// bound UNACCOUNTED_RAW so a large shared drive's unrelated sheets never bloat
// the model prompt. Matching is case-insensitive and substring-based.
const RELEVANCE_KEYWORDS = [
  "sale",
  "sales",
  "order",
  "production",
  "prod",
  "stock",
  "inventory",
  "dispatch",
  "sap",
  "ptmt",
  " cp",
  "cp ",
  "plan",
  "master",
  "25-26",
  "26-27",
  "24-25",
];

// Maximum number of unaccounted candidates handed to the model in one pass.
// Keyword relevance only RANKS candidates (relevant first, then most-recent);
// it never drops them. So when there are fewer than this many keyword matches,
// the remaining slots are filled with the most-recent non-matching files, giving
// atypically-named sources (e.g. an unusual "SALE SHEET SAP" tab) a chance to be
// seen rather than being silently excluded. The deterministic total is reported
// separately so a tail beyond the cap is never hidden.
const MAX_UNACCOUNTED = 120;

// UNACCOUNTED_RAW: Drive files that are neither a configured source nor already
// dismissed. Returns a bounded, relevance-then-recency ranked slice for the
// model plus the true deterministic total so nothing is silently hidden. The
// model still makes the final should_ingest call.
function buildUnaccountedRaw(
  driveActual: DriveFile[],
  expected: ExpectedEntry[],
  dismissedIds: Set<string>,
): {
  items: Array<{
    file_id: string;
    title: string | null | undefined;
    modified_time: string | null | undefined;
    parents: string[] | undefined;
  }>;
  total: number;
} {
  const known = new Set(expected.map((e) => e.fileId));
  const candidates = driveActual.filter(
    (f) => !known.has(f.id) && !dismissedIds.has(f.id),
  );
  const isRelevant = (f: DriveFile): boolean => {
    const t = (f.name ?? "").toLowerCase();
    return RELEVANCE_KEYWORDS.some((k) => t.includes(k));
  };
  const ranked = [...candidates].sort((a, b) => {
    const ra = isRelevant(a) ? 1 : 0;
    const rb = isRelevant(b) ? 1 : 0;
    if (ra !== rb) return rb - ra; // relevant first
    return (b.modifiedTime ?? "").localeCompare(a.modifiedTime ?? ""); // then most recent
  });
  const items = ranked.slice(0, MAX_UNACCOUNTED).map((f) => ({
    file_id: f.id,
    title: f.name,
    modified_time: f.modifiedTime,
    parents: f.parents,
  }));
  return { items, total: candidates.length };
}

interface RawFuzzy {
  stale_or_partial?: Array<Record<string, unknown>>;
  drift?: Array<Record<string, unknown>>;
  unaccounted_files?: Array<Record<string, unknown>>;
  looks_complete?: boolean;
  notes_for_engineer?: string;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;

// Run the advisory fuzzy coverage review for one division/month and persist it.
// STRICTLY best-effort: any failure (Drive down, model error, no AI key) is
// logged and swallowed so the core data pull and content-sanity gate are never
// affected.
export async function runCoverageReview(
  division: string,
  planMonth: string,
  diags: SourceDiag[],
): Promise<void> {
  try {
    if (!anthropicAvailable) {
      logger.info("coverage: skipped (no ANTHROPIC_API_KEY)");
      return;
    }
    const pm = planMonth.slice(0, 10);
    logger.info({ division, planMonth }, "coverage: review started");
    const t0 = Date.now();
    const [expected, driveActual, dismissals] = await Promise.all([
      buildExpectedUniverse(),
      listDriveActual(),
      db
        .select({ fileId: coverageDismissals.fileId })
        .from(coverageDismissals)
        .where(eq(coverageDismissals.division, division)),
    ]);
    logger.info(
      {
        division,
        driveActual: driveActual.length,
        expected: expected.length,
        ms: Date.now() - t0,
      },
      "coverage: inputs assembled",
    );
    const dismissedIds = new Set(dismissals.map((d) => d.fileId));
    const coverage = buildCoverage(division, pm, diags, expected, driveActual);
    const unaccounted = buildUnaccountedRaw(driveActual, expected, dismissedIds);

    const manifest = {
      as_of: new Date().toISOString(),
      division,
      plan_month: pm.slice(0, 7),
      fiscal_year_rule: "Apr -> Sale 25-26; May onward -> Sale 26-27",
      per_source: diags.map((d) => ({
        file_id: d.fileId,
        data_type: d.dataType,
        tab_used: d.tab,
        expected_file_for_month: d.expectedFileId,
        configured_file_ids: d.configuredFileIds,
        is_full_history: d.isFullHistory,
        rows_found: d.rows,
        in_window_rows: d.inWindowRows,
        prev_in_window_rows: d.prevInWindowRows,
        distinct_item_codes: d.distinctCodes,
        date_range_in_data: { from: d.dateMin, to: d.dateMax },
        expected_window: d.windowFrom ? { from: d.windowFrom, to: d.windowTo } : null,
        missing_columns: d.missingColumns,
      })),
      drive_actual_count: driveActual.length,
      unaccounted_total: unaccounted.total,
      unaccounted_shown: unaccounted.items.length,
      expected_universe: expected
        .filter((e) => e.division === division)
        .map((e) => ({
          division: e.division,
          data_type: e.dataType,
          file_id: e.fileId,
          tab: e.tabPattern,
        })),
    };

    const user = JSON.stringify({
      instruction:
        "Review coverage for this division/month and return your JSON assessment.",
      MANIFEST: manifest,
      COVERAGE: coverage,
      UNACCOUNTED_RAW: unaccounted.items,
    });

    // The fast model occasionally emits slightly malformed JSON. Re-ask once
    // before giving up; coverage is advisory, so a parse failure is non-fatal.
    let res!: Awaited<ReturnType<typeof callClaude>>;
    let parsed: RawFuzzy | null = null;
    for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
      res = await callClaude({
        system: FUZZY_SYSTEM,
        user,
        tier: "fast",
        maxTokens: 8000,
      });
      try {
        parsed = extractJSON<RawFuzzy>(res.text);
      } catch (parseErr) {
        logger.warn(
          { parseErr, attempt, division },
          "coverage: model JSON parse failed, retrying",
        );
      }
    }
    if (!parsed) {
      logger.warn({ division, planMonth }, "coverage: gave up after parse failures");
      return;
    }

    const staleOrPartial: CoverageStaleItem[] = (parsed.stale_or_partial ?? [])
      .filter((x) => strOrNull(x["file_id"]))
      .map((x) => ({
        fileId: str(x["file_id"]),
        division: strOrNull(x["division"]),
        dataType: strOrNull(x["data_type"]),
        month: strOrNull(x["month"]),
        type: str(x["type"]) || "stale",
        evidence: str(x["evidence"]),
        suggestedAction: str(x["suggested_action"]),
        confidence: str(x["confidence"]) || "low",
      }));

    const drift: CoverageDriftItem[] = (parsed.drift ?? [])
      .filter((x) => strOrNull(x["file_id"]))
      .map((x) => ({
        fileId: str(x["file_id"]),
        type: str(x["type"]) || "other",
        evidence: str(x["evidence"]),
        suggestedAction: str(x["suggested_action"]),
        confidence: str(x["confidence"]) || "low",
      }));

    const unaccountedFiles: CoverageCandidate[] = (parsed.unaccounted_files ?? [])
      .filter((x) => strOrNull(x["file_id"]))
      .map((x) => ({
        fileId: str(x["file_id"]),
        title: str(x["title"]),
        guessedDivision: strOrNull(x["guessed_division"]),
        guessedDataType: strOrNull(x["guessed_data_type"]),
        guessedMonth: strOrNull(x["guessed_month"]),
        reason: str(x["reason"]),
        shouldIngest: str(x["should_ingest"]) || "maybe",
        confidence: str(x["confidence"]) || "low",
      }));

    await db.insert(coverageRuns).values({
      division,
      planMonth: pm,
      model: res.model,
      tier: res.tier,
      looksComplete: Boolean(parsed.looks_complete),
      notes: strOrNull(parsed.notes_for_engineer),
      payload: { staleOrPartial, drift, unaccountedFiles },
    });

    logger.info(
      {
        division,
        planMonth: pm,
        stale: staleOrPartial.length,
        drift: drift.length,
        unaccounted: unaccountedFiles.length,
        looksComplete: Boolean(parsed.looks_complete),
      },
      "coverage: review complete",
    );
  } catch (err) {
    logger.warn({ err, division, planMonth }, "coverage: review failed (advisory)");
  }
}

// Read the latest coverage result for a scope. Unaccounted candidates are
// re-filtered at read time against the CURRENT source_config (a candidate that
// has since been added as a source disappears) and current dismissals.
export async function getLatestCoverage(
  division: string,
  planMonth: string,
): Promise<CoverageResult | null> {
  const pm = planMonth.slice(0, 10);
  const rows = await db
    .select()
    .from(coverageRuns)
    .where(and(eq(coverageRuns.division, division), eq(coverageRuns.planMonth, pm)))
    .orderBy(desc(coverageRuns.createdAt), desc(coverageRuns.id))
    .limit(1);
  const run = rows[0];
  if (!run) return null;

  const payload = (run.payload ?? {}) as {
    staleOrPartial?: CoverageStaleItem[];
    drift?: CoverageDriftItem[];
    unaccountedFiles?: CoverageCandidate[];
  };

  const [cfgs, dismissals] = await Promise.all([
    db.select({ fileId: sourceConfig.fileId }).from(sourceConfig),
    db
      .select({ fileId: coverageDismissals.fileId })
      .from(coverageDismissals)
      .where(eq(coverageDismissals.division, division)),
  ]);
  const known = new Set(cfgs.map((c) => c.fileId));
  const dismissed = new Set(dismissals.map((d) => d.fileId));
  const unaccountedFiles = (payload.unaccountedFiles ?? []).filter(
    (c) => !known.has(c.fileId) && !dismissed.has(c.fileId),
  );

  return {
    division: run.division,
    planMonth: pm,
    model: run.model,
    tier: run.tier,
    looksComplete: Boolean(run.looksComplete),
    notes: run.notes,
    staleOrPartial: payload.staleOrPartial ?? [],
    drift: payload.drift ?? [],
    unaccountedFiles,
    createdAt: run.createdAt ? run.createdAt.toISOString() : null,
  };
}

// Human-confirmed addition of an unaccounted candidate as a real source. This
// is the ONLY way a candidate enters ingestion scope; it is never automatic.
export async function addSourceFromCandidate(input: {
  division: string;
  dataType: string;
  fileId: string;
  tabPattern?: string | null;
  appliesFrom?: string | null;
}): Promise<void> {
  if (!DIVISIONS.includes(input.division)) {
    throw new Error(`Unknown division: ${input.division}`);
  }
  const row: InsertSourceConfig = {
    division: input.division,
    dataType: input.dataType,
    fileId: input.fileId,
    tabPattern: input.tabPattern ?? null,
    appliesFrom: input.appliesFrom ?? null,
    notes: "added from coverage review",
  };
  await db.insert(sourceConfig).values(row).onConflictDoNothing();
}

// Human "not a source" decision — stop resurfacing this candidate.
export async function dismissCandidate(
  division: string,
  fileId: string,
): Promise<void> {
  await db
    .insert(coverageDismissals)
    .values({ division, fileId })
    .onConflictDoNothing();
}

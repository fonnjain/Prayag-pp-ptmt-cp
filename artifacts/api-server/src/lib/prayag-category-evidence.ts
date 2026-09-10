import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

export const PRAYAG_PLANNING_CATEGORIES = [
  "Accessorise",
  "Ball Cock",
  "Cabinet",
  "Cistern & Seat Cover",
  "Cocks Premium",
  "Cocks Standard",
  "Faucets & Jetsprays & Shower",
  "P.V.C. Connections",
  "Waste Pipes",
] as const;

export type PrayagPlanningCategory = (typeof PRAYAG_PLANNING_CATEGORIES)[number];

export type PrayagCategoryEvidence = {
  status: "loaded" | "unavailable" | "invalid";
  sourcePath: string | null;
  codeToCategory: Map<string, PrayagPlanningCategory>;
  rawCategoryByCode: Map<string, string>;
  ambiguousCodes: string[];
  unknownCategories: string[];
  appOnlyCodes: string[];
  sharedRowCount: number;
  appOnlyRowCount: number;
};

const SOURCE_RELATIVE_PATH = ".agents/outputs/round7-prayag-vs-temporary-2367-itemized.csv";
let cachedEvidence: PrayagCategoryEvidence | null = null;
let cachedSourceSignature: string | null = null;

function normalizeCode(value: unknown): string {
  return String(value ?? "").trim().toUpperCase().replace(/\.0$/, "");
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function canonicalCategory(raw: string): PrayagPlanningCategory | null {
  const normalized = raw.trim().toUpperCase().replace(/\s+/g, " ");
  const aliases: Record<string, PrayagPlanningCategory> = {
    ACCESSORISE: "Accessorise",
    "BALL COCK": "Ball Cock",
    CABINET: "Cabinet",
    "CISTERN & SEAT COVER": "Cistern & Seat Cover",
    "COCKS PREMIUM": "Cocks Premium",
    "COCKS STANDRAD": "Cocks Standard",
    "COCKS STANDARD": "Cocks Standard",
    "FAUCETS & JETSPRAYS&SHOWER": "Faucets & Jetsprays & Shower",
    "FAUCETS & JETSPRAYS & SHOWER": "Faucets & Jetsprays & Shower",
    CONNECTION: "P.V.C. Connections",
    "P.V.C. CONNECTIONS": "P.V.C. Connections",
    "WASTE PIPE": "Waste Pipes",
    "WASTE PIPES": "Waste Pipes",
  };
  return aliases[normalized] ?? null;
}

function findSourcePath(): string | null {
  const configured = process.env["PRAYAG_CATEGORY_EVIDENCE_PATH"]?.trim();
  if (configured) {
    const configuredPath = resolve(process.cwd(), configured);
    if (existsSync(configuredPath)) return configuredPath;
  }

  const candidates = [
    ...findManagedEvidenceCandidates(),
    resolve(process.cwd(), SOURCE_RELATIVE_PATH),
    resolve(process.cwd(), "..", SOURCE_RELATIVE_PATH),
    resolve(process.cwd(), "..", "..", SOURCE_RELATIVE_PATH),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function findManagedEvidenceCandidates(): string[] {
  const outputDirectories = [
    resolve(process.cwd(), ".agents/outputs"),
    resolve(process.cwd(), "..", ".agents/outputs"),
    resolve(process.cwd(), "..", "..", ".agents/outputs"),
  ];
  const candidates: Array<{ path: string; modifiedAt: number }> = [];
  for (const directory of outputDirectories) {
    if (!existsSync(directory)) continue;
    for (const filename of readdirSync(directory)) {
      if (!/prayag.*(?:itemized|itemised|category).*\.csv$/i.test(filename)) continue;
      const path = resolve(directory, filename);
      try {
        const firstLine = readFileSync(path, "utf8").split(/\r?\n/, 1)[0] ?? "";
        if (!/\bcode\b/i.test(firstLine) || !/\bmanual_category\b/i.test(firstLine)) continue;
        candidates.push({ path, modifiedAt: statSync(path).mtimeMs });
      } catch {
        // A concurrently written export is ignored until it is complete.
      }
    }
  }
  return candidates
    .sort((a, b) => b.modifiedAt - a.modifiedAt)
    .map((candidate) => candidate.path);
}

function sourceSignature(sourcePath: string | null): string | null {
  if (!sourcePath) return null;
  try {
    const stat = statSync(sourcePath);
    return `${sourcePath}:${stat.size}:${stat.mtimeMs}`;
  } catch {
    return null;
  }
}

export function getPrayagCategoryEvidence(): PrayagCategoryEvidence {
  const sourcePath = findSourcePath();
  const signature = sourceSignature(sourcePath);
  if (cachedEvidence && cachedSourceSignature === signature) return cachedEvidence;
  if (!sourcePath) {
    cachedEvidence = {
      status: "unavailable",
      sourcePath: null,
      codeToCategory: new Map(),
      rawCategoryByCode: new Map(),
       ambiguousCodes: [],
      unknownCategories: [],
      appOnlyCodes: [],
      sharedRowCount: 0,
      appOnlyRowCount: 0,
    };
    cachedSourceSignature = null;
    return cachedEvidence;
  }

  try {
    const lines = readFileSync(sourcePath, "utf8").split(/\r?\n/).filter(Boolean);
    const header = parseCsvLine(lines.shift() ?? "");
    const index = new Map(header.map((name, position) => [name.trim(), position]));
    const codePosition = index.get("code");
    const manualCategoryPosition = index.get("manual_category");
    const directionPosition = index.get("direction");
    if (codePosition === undefined || manualCategoryPosition === undefined) {
      throw new Error("Prayag category evidence is missing code or manual_category columns.");
    }

    const codeToCategory = new Map<string, PrayagPlanningCategory>();
    const rawCategoryByCode = new Map<string, string>();
    const categoriesByCode = new Map<string, Set<string>>();
    const unknownCategories = new Set<string>();
    const appOnlyCodes: string[] = [];
    let sharedRowCount = 0;
    let appOnlyRowCount = 0;
    for (const line of lines) {
      const cells = parseCsvLine(line);
      const code = normalizeCode(cells[codePosition]);
      if (!code) continue;
      // Older comparison exports have direction=SHARED/APP_ONLY. Newer
      // itemized exports contain the live category for every matched code but
      // omit direction because the file is already restricted to the roster.
      const direction = directionPosition === undefined
        ? "SHARED"
        : String(cells[directionPosition] ?? "").trim().toUpperCase();
      if (direction === "APP_ONLY") {
        appOnlyCodes.push(code);
        appOnlyRowCount += 1;
      }
      if (direction === "SHARED") sharedRowCount += 1;
      const rawCategory = String(cells[manualCategoryPosition] ?? "").trim();
      if (!rawCategory) continue;
      if (direction !== "SHARED") continue;
      const category = canonicalCategory(rawCategory);
      if (!category) {
        unknownCategories.add(rawCategory);
        continue;
      }
      const categories = categoriesByCode.get(code) ?? new Set<string>();
      categories.add(category);
      categoriesByCode.set(code, categories);
    }

    const ambiguousCodes: string[] = [];
    for (const [code, categories] of categoriesByCode) {
      const orderedCategories = [...categories].sort();
      rawCategoryByCode.set(code, orderedCategories.join(" | "));
      if (orderedCategories.length > 1) {
        ambiguousCodes.push(code);
        continue;
      }
      codeToCategory.set(code, orderedCategories[0]! as PrayagPlanningCategory);
    }

    cachedEvidence = {
      status: "loaded",
      sourcePath,
      codeToCategory,
      rawCategoryByCode,
      ambiguousCodes: ambiguousCodes.sort(),
      unknownCategories: [...unknownCategories].sort(),
      appOnlyCodes: [...new Set(appOnlyCodes)].sort(),
      sharedRowCount,
      appOnlyRowCount,
    };
    cachedSourceSignature = signature;
  } catch {
    cachedEvidence = {
      status: "invalid",
      sourcePath,
      codeToCategory: new Map(),
      rawCategoryByCode: new Map(),
      ambiguousCodes: [],
      unknownCategories: [],
      appOnlyCodes: [],
      sharedRowCount: 0,
      appOnlyRowCount: 0,
    };
    cachedSourceSignature = signature;
  }
  return cachedEvidence;
}

export function resetPrayagCategoryEvidenceCache(): void {
  cachedEvidence = null;
  cachedSourceSignature = null;
}
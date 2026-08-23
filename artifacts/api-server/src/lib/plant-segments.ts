/**
 * The supported plant reporting segments.
 *
 * Keep this registry deliberately limited to PTMT and Plumbing. CP is not a
 * reporting segment until its source contracts and parity tests exist.
 */
export const PLANT_SEGMENT_PROFILES = {
  PTMT: {
    key: "PTMT",
    label: "PTMT",
    orderGroup: "PTMT",
    workbookDivision: "PTMT",
    actualsSource: "ANUJ Production",
  },
  Plumbing: {
    key: "Plumbing",
    label: "Plumbing",
    orderGroup: "PLUMBING",
    workbookDivision: "Plumbing",
    actualsSource: "Sheet3",
  },
} as const;

export type PlantSegment = keyof typeof PLANT_SEGMENT_PROFILES;

export const PLANT_SEGMENTS = Object.keys(PLANT_SEGMENT_PROFILES) as PlantSegment[];

const BY_LOWER: ReadonlyMap<string, PlantSegment> = new Map(
  PLANT_SEGMENTS.map((segment) => [segment.toLowerCase(), segment]),
);

export function isPlantSegment(value: unknown): value is PlantSegment {
  return typeof value === "string" && BY_LOWER.has(value.trim().toLowerCase());
}

/**
 * Normalize user-facing query/body values while preserving the canonical
 * title-case value used by planning and snapshot keys.
 */
export function normalizePlantSegment(value: unknown, fallback: PlantSegment | null = "PTMT"): PlantSegment | null {
  if (value === undefined || value === null || value === "") return fallback;
  return BY_LOWER.get(String(value).trim().toLowerCase()) ?? null;
}

export function plantSegmentProfile(segment: PlantSegment) {
  return PLANT_SEGMENT_PROFILES[segment];
}
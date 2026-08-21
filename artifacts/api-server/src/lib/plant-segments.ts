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

export function isPlantSegment(value: unknown): value is PlantSegment {
  return value === "PTMT" || value === "Plumbing";
}

/**
 * Normalize user-facing query/body values while preserving the canonical
 * title-case value used by planning and snapshot keys.
 */
export function normalizePlantSegment(value: unknown, fallback: PlantSegment | null = "PTMT"): PlantSegment | null {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "ptmt") return "PTMT";
  if (normalized === "plumbing") return "Plumbing";
  return null;
}

export function plantSegmentProfile(segment: PlantSegment) {
  return PLANT_SEGMENT_PROFILES[segment];
}
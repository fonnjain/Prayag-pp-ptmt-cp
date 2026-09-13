import { useQuery } from "@tanstack/react-query";

export type MachinePlanningAllocation = {
  code: string;
  name: string;
  category: string;
  machine: string;
  pool: string;
  week: number | null;
  netPieces: number;
  grossPieces: number | null;
  kg: number | null;
  hours: number;
  routeMethod: string;
  isFallback: boolean;
};

export type MachinePlanningPayload = {
  available: boolean;
  reason?: string;
  segment: string;
  month: string;
  runId: number | null;
  sourceRunId: number | null;
  attemptId: number | null;
  generatedAt: string | null;
  status: string;
  draft: boolean;
  superseded: boolean;
  supersedingId: number | null;
  weekDays: number[];
  headline: {
    scheduledPieces: number;
    notScheduledPieces: number;
    productsCovered: number;
    routingRosterProducts: number;
    withoutRouting: number;
    withoutRoutingPieces: number;
    mouldingMachinesUsed: number;
    mouldingMachinesTotal: number;
    pipeMachinesUsed: number;
  };
  reasons: Array<{ reason: string; label: string; pieces: number; rows: number }>;
  machines: Array<{
    machine: string;
    pool: string;
    materials: string;
    weeks: Array<{ week: number; available: number; used: number; utilization: number; idle: number }>;
    month: { available: number; used: number; idle: number; utilization: number };
  }>;
  allocations: MachinePlanningAllocation[];
  unscheduled: Array<{ code: string; name: string; category: string; pieces: number; grossPieces: number | null; kg: number | null; reason: string }>;
  coverage: Array<{ code: string; name: string; category: string; requestedPieces: number; status: string; covered: boolean; reason: string }>;
  concentration: Array<{ machine: string; pool: string; products: number; pieces: number; singleMachineCount: number; overlapWarning: string | null }>;
  trace: Record<string, unknown>;
};

export function useMachinePlanning(month: string, segment: string) {
  return useQuery({
    queryKey: ["/api/machine-planning", month, segment],
    queryFn: async (): Promise<MachinePlanningPayload> => {
      const base = import.meta.env.BASE_URL;
      const res = await fetch(`${base}api/machine-planning?month=${encodeURIComponent(month)}&segment=${encodeURIComponent(segment)}`, {
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error(`Failed to fetch machine planning: ${res.statusText}`);
      }
      return res.json();
    },
    enabled: !!month && !!segment,
  });
}

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

interface MachineRow {
  id: number;
  machineId: string;
  label: string | null;
  pool: string;
  shiftsPerDay: number;
  hoursPerShift: number;
  lockedOut: boolean;
  rates: Record<string, number>;
}

interface UtilRow {
  machineId: string;
  pool: string;
  label: string | null;
  week: number;
  hoursUsed: number;
  hoursAvailable: number;
  utilisationPct: number;
}

interface UnfulfillableRow {
  itemCode: string;
  category: string;
  pieces: number;
}

interface MachineCapData {
  machines: MachineRow[];
  utilisation: UtilRow[];
  unfulfillable: UnfulfillableRow[];
}

function fmtN(n: number) { return Math.round(n).toLocaleString("en-IN"); }

function pctColor(pct: number) {
  if (pct >= 95) return "text-red-600 font-semibold";
  if (pct >= 80) return "text-amber-600 font-semibold";
  return "text-emerald-600";
}

function UtilBar({ pct }: { pct: number }) {
  const clamp = Math.min(pct, 100);
  const bg = pct >= 95 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="flex items-center gap-1.5 min-w-[80px]">
      <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
        <div className={`h-2 rounded-full ${bg}`} style={{ width: `${clamp}%` }} />
      </div>
      <span className={`text-xs tabular-nums ${pctColor(pct)}`}>{pct.toFixed(1)}%</span>
    </div>
  );
}

export default function PlumbingMachineRelease({ month }: { month: string }) {
  const [data, setData] = useState<MachineCapData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/capacity/machines?segment=Plumbing&month=${encodeURIComponent(month)}`,
      );
      if (!res.ok) {
        const b = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(b.error ?? `HTTP ${res.status}`);
      }
      setData(await res.json() as MachineCapData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [month]);

  const pipeMachines    = data?.machines.filter(m => m.pool === "PIPE") ?? [];
  const mouldMachines   = data?.machines.filter(m => m.pool === "MOULDING") ?? [];

  const utilByMachWeek = new Map<string, UtilRow>();
  for (const u of (data?.utilisation ?? [])) {
    utilByMachWeek.set(`${u.machineId}:${u.week}`, u);
  }

  const getUtil = (machineId: string, week: number) =>
    utilByMachWeek.get(`${machineId}:${week}`);

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-10">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Machine Release Schedule</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Machine-capacity-constrained weekly release · Plumbing · {month}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Loading…" : data ? "Refresh" : "Load"}
        </Button>
      </header>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
          Running machine cascade…
        </div>
      )}

      {data && (
        <>
          {data.unfulfillable.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <strong>⚠ {data.unfulfillable.length} item(s) unfulfillable</strong> — no machine slot
              available across W1–W4. These items are flagged below.
              <ul className="mt-1 list-disc ml-4 space-y-0.5">
                {data.unfulfillable.slice(0, 10).map(u => (
                  <li key={u.itemCode}>{u.itemCode} ({u.category}) — {fmtN(u.pieces)} pcs</li>
                ))}
                {data.unfulfillable.length > 10 && (
                  <li className="text-amber-700">…and {data.unfulfillable.length - 10} more</li>
                )}
              </ul>
            </div>
          )}

          {/* ── PIPE pool utilisation ── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">PIPE Pool — Weekly Machine Utilisation</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                2 shifts × 10 h/day. Working days per week excludes Sundays. M/C-7 & M/C-8 locked out.
              </p>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-md border text-sm">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-gray-50 text-xs font-semibold text-gray-600 uppercase tracking-wide">
                      <th className="px-3 py-2 text-left">Machine</th>
                      <th className="px-3 py-2 text-left">Materials</th>
                      <th className="px-3 py-2 text-center" colSpan={2}>W1</th>
                      <th className="px-3 py-2 text-center" colSpan={2}>W2</th>
                      <th className="px-3 py-2 text-center" colSpan={2}>W3</th>
                      <th className="px-3 py-2 text-center" colSpan={2}>W4</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {pipeMachines.map(m => {
                      const materials = Object.keys(m.rates).join(", ");
                      return (
                        <tr key={m.machineId} className={m.lockedOut ? "bg-gray-50 opacity-50" : "hover:bg-gray-50"}>
                          <td className="px-3 py-2 font-medium whitespace-nowrap">
                            {m.label ?? m.machineId}
                            {m.lockedOut && <span className="ml-1 text-xs text-gray-400">(locked)</span>}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500">{materials || "—"}</td>
                          {[1, 2, 3, 4].map(w => {
                            const u = m.lockedOut ? null : getUtil(m.machineId, w);
                            return (
                              <td key={w} className="px-2 py-2" colSpan={2}>
                                {u ? (
                                  <div className="space-y-0.5">
                                    <UtilBar pct={u.utilisationPct} />
                                    <div className="text-xs text-gray-400 tabular-nums">
                                      {u.hoursUsed.toFixed(1)}/{u.hoursAvailable.toFixed(0)} h
                                    </div>
                                  </div>
                                ) : <span className="text-xs text-gray-400">—</span>}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* ── MOULDING pool utilisation ── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">MOULDING Pool — Weekly Machine Utilisation ({mouldMachines.length} machines)</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                All machines process any Fitting regardless of material. Rate = kg/hr per machine.
              </p>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-md border text-sm">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-gray-50 text-xs font-semibold text-gray-600 uppercase tracking-wide">
                      <th className="px-3 py-2 text-left">Machine</th>
                      <th className="px-3 py-2 text-right">Rate (kg/hr)</th>
                      <th className="px-3 py-2">W1</th>
                      <th className="px-3 py-2">W2</th>
                      <th className="px-3 py-2">W3</th>
                      <th className="px-3 py-2">W4</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {mouldMachines.map(m => {
                      const rate = m.rates["ALL"] ?? 0;
                      return (
                        <tr key={m.machineId} className="hover:bg-gray-50">
                          <td className="px-3 py-2 font-medium">{m.label ?? m.machineId}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-600">{rate.toFixed(1)}</td>
                          {[1, 2, 3, 4].map(w => {
                            const u = getUtil(m.machineId, w);
                            return (
                              <td key={w} className="px-2 py-2">
                                {u ? <UtilBar pct={u.utilisationPct} /> : <span className="text-xs text-gray-400">—</span>}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* ── Machine config summary ── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Machine Configuration</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                {data.machines.filter(m => !m.lockedOut).length} active machines
                ({pipeMachines.filter(m => !m.lockedOut).length} PIPE + {mouldMachines.length} MOULDING).
                Edit shifts via the Data page → Machine Capacity panel.
              </p>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-muted-foreground">
                Shifts/day: <strong>2</strong> · Hours/shift: <strong>10 h</strong> ·
                Working days: calendar-based per week (Sundays excluded).
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

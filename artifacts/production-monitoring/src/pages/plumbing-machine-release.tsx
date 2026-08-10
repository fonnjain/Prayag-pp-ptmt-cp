import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw, FileSpreadsheet, ArrowRight } from "lucide-react";
import { Link } from "wouter";

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
  bindingMachine: string | null;
}

interface MachineCapData {
  machines: MachineRow[];
  utilisation: UtilRow[];
  unfulfillable: UnfulfillableRow[];
}

interface PlanItem {
  itemCode: string;
  category: string;
  maxProduction: number;
  weightKg?: number;
  w1: number;
  w2: number;
  w3: number;
  w4: number;
  machineW1?: number;
  machineW2?: number;
  machineW3?: number;
  machineW4?: number;
}

interface CategoryRow {
  category: string;
  desired: [number, number, number, number];
  feasible: [number, number, number, number];
  desiredKg: [number, number, number, number];
  feasibleKg: [number, number, number, number];
}

// ─── Imported Plan types ──────────────────────────────────────────────────────

interface ImportedUpload {
  id: number;
  month: string;
  segment: string;
  filename: string;
  itemCount: number;
  uploadedAt: string;
}

interface MachineTotal {
  machineId: string;
  pcs: number;
  kg: number;
  hrs: number;
  itemCount: number;
}

interface MachineSummaryResponse {
  upload: ImportedUpload | null;
  machineTotals: MachineTotal[];
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function fmtN(n: number) { return Math.round(n).toLocaleString("en-IN"); }
function fmtKg(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}t` : `${n.toFixed(0)} kg`; }
function fmtHrs(n: number) { return n === 0 ? "—" : `${n.toFixed(1)} h`; }

function pctColor(pct: number) {
  if (pct >= 95) return "text-red-600 font-semibold";
  if (pct >= 80) return "text-amber-600 font-semibold";
  return "text-emerald-600";
}

function UtilBar({ pct }: { pct: number }) {
  const clamp = Math.min(pct, 100);
  const bg = pct >= 95 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="flex items-center gap-1.5 min-w-[90px]">
      <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
        <div className={`h-2 rounded-full ${bg}`} style={{ width: `${clamp}%` }} />
      </div>
      <span className={`text-xs tabular-nums ${pctColor(pct)}`}>{pct.toFixed(1)}%</span>
    </div>
  );
}

function buildCategoryRows(items: PlanItem[]): CategoryRow[] {
  const map = new Map<string, CategoryRow>();
  for (const item of items) {
    if (!map.has(item.category)) {
      map.set(item.category, {
        category: item.category,
        desired: [0, 0, 0, 0],
        feasible: [0, 0, 0, 0],
        desiredKg: [0, 0, 0, 0],
        feasibleKg: [0, 0, 0, 0],
      });
    }
    const row = map.get(item.category)!;
    const wgt = item.weightKg ?? 0;
    const maxProd = item.maxProduction || 1;
    const kgPerPiece = wgt / maxProd;

    const desired = [item.w1, item.w2, item.w3, item.w4];
    const feasible = [item.machineW1 ?? 0, item.machineW2 ?? 0, item.machineW3 ?? 0, item.machineW4 ?? 0];

    for (let i = 0; i < 4; i++) {
      row.desired[i] += desired[i]!;
      row.feasible[i] += feasible[i]!;
      row.desiredKg[i] += desired[i]! * kgPerPiece;
      row.feasibleKg[i] += feasible[i]! * kgPerPiece;
    }
  }
  return [...map.values()].sort((a, b) => a.category.localeCompare(b.category));
}

const CATEGORY_ORDER = [
  "CPVC Pipe", "CPVC Fitting", "CPVC Solvent",
  "UPVC Pipe", "UPVC Fitting", "UPVC Solvent",
  "SWR Pipe",  "SWR Fitting",  "SWR Solvent",
  "AGRI Pipe", "AGRI Fitting", "AGRI Solvent",
];

export default function PlumbingMachineRelease({ month }: { month: string }) {
  const [capData, setCapData] = useState<MachineCapData | null>(null);
  const [planItems, setPlanItems] = useState<PlanItem[] | null>(null);
  const [machineSummary, setMachineSummary] = useState<MachineSummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [capRes, planRes, summaryRes] = await Promise.all([
        fetch(`/api/capacity/machines?segment=Plumbing&month=${encodeURIComponent(month)}`),
        fetch(`/api/plan?segment=Plumbing&month=${encodeURIComponent(month)}`),
        fetch(`/api/monitoring/plant-plan/machine-summary?month=${encodeURIComponent(month)}&segment=Plumbing`),
      ]);
      if (!capRes.ok) throw new Error(`Machines: HTTP ${capRes.status}`);
      if (!planRes.ok) throw new Error(`Plan: HTTP ${planRes.status}`);
      const [cap, items, summary] = await Promise.all([
        capRes.json() as Promise<MachineCapData>,
        planRes.json() as Promise<PlanItem[]>,
        summaryRes.ok ? (summaryRes.json() as Promise<MachineSummaryResponse>) : Promise.resolve(null),
      ]);
      setCapData(cap);
      setPlanItems(items);
      setMachineSummary(summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [month]);

  const catRows = planItems ? buildCategoryRows(planItems) : [];
  const orderedCatRows = CATEGORY_ORDER.map(c => catRows.find(r => r.category === c)).filter(Boolean) as CategoryRow[];

  const pipeMachines    = capData?.machines.filter(m => m.pool === "PIPE") ?? [];
  const mouldMachines   = capData?.machines.filter(m => m.pool === "MOULDING") ?? [];

  const utilByMachWeek = new Map<string, UtilRow>();
  for (const u of (capData?.utilisation ?? [])) {
    utilByMachWeek.set(`${u.machineId}:${u.week}`, u);
  }

  const getUtil = (machineId: string, week: number) => utilByMachWeek.get(`${machineId}:${week}`);

  const unfulfillable = capData?.unfulfillable ?? [];

  // Imported plan machine totals
  const importedUpload  = machineSummary?.upload ?? null;
  const machineTotals   = machineSummary?.machineTotals ?? [];
  const importHasHours  = machineTotals.some(t => t.hrs > 0);
  const totalImportPcs  = machineTotals.reduce((s, t) => s + t.pcs, 0);
  const totalImportKg   = machineTotals.reduce((s, t) => s + t.kg, 0);
  const totalImportHrs  = machineTotals.reduce((s, t) => s + t.hrs, 0);

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
          {loading ? "Loading…" : (capData ? "Refresh" : "Load")}
        </Button>
      </header>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && !capData && (
        <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
          Running machine cascade…
        </div>
      )}

      {/* ── Imported Plant Plan ── */}
      {!loading && (
        importedUpload ? (
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <FileSpreadsheet className="h-4 w-4 text-indigo-500" />
                    Imported Plant Plan — Machine Totals
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    From <span className="font-medium">{importedUpload.filename}</span>
                    {" · "}uploaded {new Date(importedUpload.uploadedAt).toLocaleDateString("en-IN", {
                      day: "numeric", month: "short", year: "numeric",
                    })}
                    {" · "}{importedUpload.itemCount} items
                    {importHasHours ? "" : (
                      <span className="ml-1 text-amber-600">· hours not stored for this upload (legacy format)</span>
                    )}
                  </p>
                </div>
                <Link href="/plumbing/plan-import">
                  <Button size="sm" variant="outline" className="shrink-0 text-xs">
                    Manage <ArrowRight className="h-3 w-3 ml-1" />
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-md border text-sm">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-gray-50 text-xs font-semibold text-gray-600 uppercase tracking-wide">
                      <th className="px-3 py-2 text-left">Machine</th>
                      <th className="px-3 py-2 text-right">Items</th>
                      <th className="px-3 py-2 text-right">Pcs</th>
                      <th className="px-3 py-2 text-right">Weight (kg)</th>
                      {importHasHours && <th className="px-3 py-2 text-right">Machine Hrs</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {machineTotals.map(t => (
                      <tr key={t.machineId} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-medium">{t.machineId}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-500">{t.itemCount}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtN(t.pcs)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtKg(t.kg)}</td>
                        {importHasHours && (
                          <td className="px-3 py-2 text-right tabular-nums text-indigo-700">{fmtHrs(t.hrs)}</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 font-semibold text-sm border-t-2">
                      <td className="px-3 py-2">Total</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-500">
                        {machineTotals.reduce((s, t) => s + t.itemCount, 0)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtN(totalImportPcs)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtKg(totalImportKg)}</td>
                      {importHasHours && (
                        <td className="px-3 py-2 text-right tabular-nums text-indigo-700">{fmtHrs(totalImportHrs)}</td>
                      )}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 px-6 py-5 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-gray-700">No imported plant plan for {month}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Upload the consolidated plan from the plant to see machine-level hour, kg, and pcs targets.
              </p>
            </div>
            <Link href="/plumbing/plan-import">
              <Button size="sm" variant="outline" className="shrink-0">
                Go to Plan Import <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
              </Button>
            </Link>
          </div>
        )
      )}

      {capData && planItems && (
        <>
          {unfulfillable.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <strong>⚠ {unfulfillable.length} item(s) unfulfillable</strong> — no machine slot
              available across W1–W4. These items are excluded from the feasible quantities below.
              <ul className="mt-1 list-disc ml-4 space-y-0.5 text-amber-700">
                {unfulfillable.slice(0, 8).map(u => (
                  <li key={u.itemCode}>
                    {u.itemCode} ({u.category}) — {fmtN(u.pieces)} pcs
                    {u.bindingMachine ? <span className="text-amber-600"> · bottleneck: {u.bindingMachine}</span> : ""}
                  </li>
                ))}
                {unfulfillable.length > 8 && (
                  <li className="text-amber-600">…and {unfulfillable.length - 8} more</li>
                )}
              </ul>
            </div>
          )}

          {/* ── Desired vs Feasible by category ── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Desired vs Machine-Feasible Release — by Category</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Desired = cover-band weekly assignment. Feasible = machine-cascade output.
                Solvent items are unconstrained — Desired = Feasible. Pieces and weight (kg/tonnes).
              </p>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-md border text-sm">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-gray-50 text-xs font-semibold text-gray-600 uppercase tracking-wide">
                      <th className="px-3 py-2 text-left" rowSpan={2}>Category</th>
                      {[1, 2, 3, 4].map(w => (
                        <th key={w} className="px-2 py-1 text-center border-l" colSpan={2}>W{w}</th>
                      ))}
                    </tr>
                    <tr className="bg-gray-50 text-[11px] text-gray-500 uppercase">
                      {[1, 2, 3, 4].map(w => (
                        <>
                          <th key={`d${w}`} className="px-2 py-1 text-center border-l font-normal">Desired</th>
                          <th key={`f${w}`} className="px-2 py-1 text-center font-normal">Feasible</th>
                        </>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {orderedCatRows.map(row => {
                      const isSolvent = row.category.endsWith("Solvent");
                      return (
                        <tr key={row.category} className={`hover:bg-gray-50 ${isSolvent ? "bg-gray-50/50 text-gray-500" : ""}`}>
                          <td className="px-3 py-2 font-medium whitespace-nowrap">{row.category}</td>
                          {[0, 1, 2, 3].map(wi => {
                            const des = row.desired[wi]!;
                            const feas = row.feasible[wi]!;
                            const desKg = row.desiredKg[wi]!;
                            const feasKg = row.feasibleKg[wi]!;
                            const shortfall = des - feas;
                            const hasShortfall = !isSolvent && shortfall > 0.5;
                            return (
                              <>
                                <td key={`d${wi}`} className="px-2 py-2 text-center tabular-nums border-l">
                                  <div>{fmtN(des)}</div>
                                  {desKg > 0 && <div className="text-[10px] text-gray-400">{fmtKg(desKg)}</div>}
                                </td>
                                <td key={`f${wi}`} className={`px-2 py-2 text-center tabular-nums ${hasShortfall ? "text-amber-700" : "text-emerald-700"}`}>
                                  <div>{fmtN(feas)}</div>
                                  {feasKg > 0 && <div className="text-[10px] opacity-70">{fmtKg(feasKg)}</div>}
                                  {hasShortfall && (
                                    <div className="text-[10px] text-amber-500">-{fmtN(shortfall)}</div>
                                  )}
                                </td>
                              </>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 font-semibold text-sm border-t-2">
                      <td className="px-3 py-2">Total</td>
                      {[0, 1, 2, 3].map(wi => {
                        const des  = orderedCatRows.reduce((s, r) => s + r.desired[wi]!, 0);
                        const feas = orderedCatRows.reduce((s, r) => s + r.feasible[wi]!, 0);
                        return (
                          <>
                            <td key={`td${wi}`} className="px-2 py-2 text-center tabular-nums border-l">{fmtN(des)}</td>
                            <td key={`tf${wi}`} className={`px-2 py-2 text-center tabular-nums ${feas < des - 0.5 ? "text-amber-700" : "text-emerald-700"}`}>{fmtN(feas)}</td>
                          </>
                        );
                      })}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* ── PIPE pool utilisation ── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">PIPE Pool — Weekly Machine Utilisation</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                2 shifts × 10 h/shift × calendar working days (Sundays excluded). M/C-7 &amp; M/C-8 locked out.
              </p>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-md border text-sm">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-gray-50 text-xs font-semibold text-gray-600 uppercase tracking-wide">
                      <th className="px-3 py-2 text-left">Machine</th>
                      <th className="px-3 py-2 text-left">Materials</th>
                      <th className="px-3 py-2 text-center">W1</th>
                      <th className="px-3 py-2 text-center">W2</th>
                      <th className="px-3 py-2 text-center">W3</th>
                      <th className="px-3 py-2 text-center">W4</th>
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
                              <td key={w} className="px-2 py-2">
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
              <CardTitle className="text-base">MOULDING Pool — Weekly Utilisation ({mouldMachines.length} machines)</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                All moulding machines accept any Fitting material. Sorted by machine ID.
              </p>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-md border text-sm">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-gray-50 text-xs font-semibold text-gray-600 uppercase tracking-wide">
                      <th className="px-3 py-2 text-left">Machine</th>
                      <th className="px-3 py-2 text-right">Rate (kg/hr)</th>
                      <th className="px-3 py-2 text-center">W1</th>
                      <th className="px-3 py-2 text-center">W2</th>
                      <th className="px-3 py-2 text-center">W3</th>
                      <th className="px-3 py-2 text-center">W4</th>
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
        </>
      )}
    </div>
  );
}

import { useState } from "react";
import {
  useRunCorrectiveReplan,
  useListCorrectiveRuns,
  useGetCorrectiveRun,
  useDeleteCorrectiveRun,
  usePinCorrectiveRun,
  type CorrectiveReplanResult,
  type CorrectiveItemResult,
  type CorrectiveWeekStat,
  type CorrectiveWarning,
  type CorrectivePlanRunSummary,
} from "@workspace/api-client-react";
import { ApiError } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/app-layout";
import { useSegment } from "@/contexts/segment-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
  Legend,
} from "recharts";

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  "on-plan":      { label: "On Plan",       color: "#166534", bg: "#dcfce7" },
  "carried-over": { label: "Carried Over",  color: "#92400e", bg: "#fef3c7" },
  "demand-spike": { label: "Demand Spike",  color: "#9a3412", bg: "#ffedd5" },
  "deferred":     { label: "Deferred",      color: "#b91c1c", bg: "#fee2e2" },
  "unfulfillable":{ label: "Unfulfillable", color: "#7f1d1d", bg: "#fecaca" },
  "replenished":  { label: "Replenished",   color: "#374151", bg: "#f1f5f9" },
  "new-item":     { label: "New Item",      color: "#3730a3", bg: "#e0e7ff" },
};

const SEVERITY_META: Record<string, { label: string; cls: string }> = {
  info:     { label: "Info",     cls: "bg-blue-50 text-blue-800 border-blue-200" },
  medium:   { label: "Medium",   cls: "bg-amber-50 text-amber-800 border-amber-200" },
  high:     { label: "High",     cls: "bg-orange-50 text-orange-800 border-orange-200" },
  critical: { label: "Critical", cls: "bg-red-50 text-red-800 border-red-200" },
};

const WEEK_COLORS = ["#f97316", "#eab308", "#22c55e", "#3b82f6"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtPcs(n: number) {
  return Math.round(n).toLocaleString("en-IN");
}
function fmtPct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}
function fmtDt(iso: string) {
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" });
}

// ─── StatusBadge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { label: status, color: "#374151", bg: "#f3f4f6" };
  return (
    <span
      className="inline-block px-2 py-0.5 rounded text-xs font-semibold"
      style={{ color: meta.color, backgroundColor: meta.bg }}
    >
      {meta.label}
    </span>
  );
}

// ─── Warning Card ─────────────────────────────────────────────────────────────

function WarningsCard({ warnings }: { warnings: CorrectiveWarning[] }) {
  if (!warnings || warnings.length === 0) {
    return (
      <div className="rounded-md bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-800">
        ✅ No warnings — plan is within normal parameters.
      </div>
    );
  }

  const sorted = [...warnings].sort((a, b) => {
    const ord = { critical: 0, high: 1, medium: 2, info: 3 };
    return (ord[a.severity as keyof typeof ord] ?? 4) - (ord[b.severity as keyof typeof ord] ?? 4);
  });

  return (
    <div className="space-y-2">
      {sorted.map((w, i) => {
        const meta = SEVERITY_META[w.severity] ?? SEVERITY_META.info;
        return (
          <div key={i} className={cn("rounded-md border px-3 py-2 text-sm", meta.cls)}>
            <div className="flex items-start gap-2">
              <Badge className={cn("text-xs shrink-0 mt-0.5", meta.cls)}>{meta.label}</Badge>
              <div>
                <span className="font-semibold mr-1">{w.code}:</span>
                {w.message}
                {w.items && w.items.length > 0 && (
                  <div className="mt-1 text-xs opacity-75">
                    Affected: {w.items.slice(0, 5).join(", ")}{w.items.length > 5 ? ` +${w.items.length - 5} more` : ""}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Capacity Chart ───────────────────────────────────────────────────────────

function CapacityChart({ weekStats, weekClosed }: { weekStats: CorrectiveWeekStat[]; weekClosed: number }) {
  if (!weekStats || weekStats.length === 0) return null;

  const weekCapacity = weekStats[0]?.capacity ?? 0;

  const data = weekStats.map((ws, i) => ({
    name: ws.weekLabel,
    original: Math.round(ws.released),
    produced: Math.round(ws.produced),
    fill: WEEK_COLORS[i] ?? "#6b7280",
    isClosed: ws.week <= weekClosed,
  }));

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500">
        Original release vs capacity per week. Dashed line = weekly capacity ({fmtPcs(weekCapacity)} pcs).
        Bars above the line are overloaded weeks.
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <XAxis dataKey="name" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
          <Tooltip
            formatter={(v: number, name: string) => [fmtPcs(v), name === "original" ? "Original Release" : "Produced"]}
            labelFormatter={l => `Week ${l}`}
          />
          <Legend formatter={(v) => v === "original" ? "Original Release" : "Produced"} />
          <Bar dataKey="original" name="original" radius={[3, 3, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.fill} opacity={d.isClosed ? 0.5 : 1} />
            ))}
          </Bar>
          <Bar dataKey="produced" name="produced" fill="#94a3b8" radius={[3, 3, 0, 0]} />
          <ReferenceLine y={weekCapacity} stroke="#ef4444" strokeDasharray="5 5" strokeWidth={2} label={{ value: "Capacity", fill: "#ef4444", fontSize: 11, position: "right" }} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Variance Attribution Card ────────────────────────────────────────────────

function VarianceCard({ result }: { result: CorrectiveReplanResult }) {
  const productionSatisfied = result.producedToDate;
  const newDemand = result.newOrdersQty;
  const planDrift = result.revisedMonthTotal - result.originalMonthTotal;
  const unfulfillable = result.unfulfillableQty;

  const items = [
    {
      label: "Produced to date",
      value: productionSatisfied,
      color: "text-green-700",
      bg: "bg-green-50 border-green-200",
      sign: "+",
      desc: "Demand satisfied — reduces remaining to produce",
    },
    {
      label: "New orders received",
      value: newDemand,
      color: "text-orange-700",
      bg: "bg-orange-50 border-orange-200",
      sign: "+",
      desc: "Mid-month orders added to the plan",
    },
    {
      label: "Net plan revision",
      value: Math.abs(planDrift),
      color: planDrift >= 0 ? "text-red-700" : "text-green-700",
      bg: planDrift >= 0 ? "bg-red-50 border-red-200" : "bg-green-50 border-green-200",
      sign: planDrift >= 0 ? "▲" : "▼",
      desc: planDrift >= 0 ? "Revised plan grew vs original" : "Revised plan shrank vs original",
    },
    {
      label: "Unfulfillable this month",
      value: unfulfillable,
      color: "text-red-800",
      bg: "bg-red-50 border-red-200",
      sign: "!",
      desc: "Cannot be produced within month capacity — deferred",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className={cn("rounded-md border px-3 py-2.5", item.bg)}>
          <p className="text-xs text-gray-500 mb-1">{item.label}</p>
          <p className={cn("text-lg font-bold tabular-nums", item.color)}>
            {fmtPcs(item.value)} pcs
          </p>
          <p className="text-xs text-gray-500 mt-1">{item.desc}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Corrective Actions Card ──────────────────────────────────────────────────

function CorrectiveActionsCard({ result }: { result: CorrectiveReplanResult }) {
  const weekClosed = result.weekClosed;
  const remainingWeeks = [1, 2, 3, 4].filter(w => w > weekClosed);
  const weekCapacity = result.dailyCapacity * result.workingDaysPerWeek;

  // Items to prioritize in the immediate next week (lowest cover)
  const nextWeek = remainingWeeks[0];
  const immediatePriority = nextWeek
    ? result.items
        .filter(i => i.newWeek === nextWeek && i.remainingToProduce > 0)
        .sort((a, b) => (a.coverNow ?? 999) - (b.coverNow ?? 999))
        .slice(0, 8)
    : [];

  // Items deferred (carried over from an earlier week)
  const deferred = result.items.filter(i => i.status === "carried-over" || i.status === "deferred");

  // Overtime calculation for immediate week
  const immediateWeekLoad = nextWeek
    ? result.items.filter(i => i.newWeek === nextWeek).reduce((s, i) => s + i.remainingToProduce, 0)
    : 0;
  const overloadPcs = Math.max(immediateWeekLoad - weekCapacity, 0);
  const overtimeHrs = overloadPcs > 0 && result.dailyCapacity > 0 ? Math.round(overloadPcs / (result.dailyCapacity / 8)) : 0;

  // Categories that absorbed most new demand
  const catDelta = new Map<string, number>();
  for (const item of result.items) {
    catDelta.set(item.category, (catDelta.get(item.category) ?? 0) + Math.max(item.deltaNewOrders, 0));
  }
  const topCats = [...catDelta.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .filter(([, v]) => v > 0);

  return (
    <div className="space-y-4">
      {/* Overtime */}
      {nextWeek && (
        <div className={cn(
          "rounded-md border px-3 py-2.5",
          overloadPcs > 0 ? "bg-red-50 border-red-200" : "bg-green-50 border-green-200"
        )}>
          <p className="text-sm font-semibold mb-1">
            {overloadPcs > 0
              ? `⚠ W${nextWeek} overloaded by ${fmtPcs(overloadPcs)} pcs → ~${overtimeHrs} overtime hours needed`
              : `✅ W${nextWeek} load within capacity (${fmtPcs(immediateWeekLoad)} / ${fmtPcs(weekCapacity)} pcs)`
            }
          </p>
          <p className="text-xs text-gray-600">
            Daily capacity: {fmtPcs(result.dailyCapacity)} pcs × {result.workingDaysPerWeek} days = {fmtPcs(weekCapacity)} pcs/week
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* Prioritize today */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            {nextWeek ? `Prioritize in W${nextWeek} (by cover)` : "No remaining weeks"}
          </p>
          <div className="space-y-1">
            {immediatePriority.length === 0 && (
              <p className="text-xs text-gray-400">No items need prioritisation</p>
            )}
            {immediatePriority.map((item, i) => (
              <div key={`${item.itemCode}-${item.colour}`} className="flex items-center justify-between text-xs rounded px-2 py-1 bg-orange-50 border border-orange-100">
                <div>
                  <span className="font-mono font-medium">{item.itemCode}</span>
                  <span className="text-gray-500 ml-1">/{item.colour}</span>
                </div>
                <div className="text-right">
                  <span className="text-gray-500">{item.coverNow?.toFixed(2) ?? "OS"}× cover</span>
                  <span className="ml-2 font-medium text-orange-700">{fmtPcs(item.remainingToProduce)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Defer list */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            Carried Over / Deferred ({deferred.length} items)
          </p>
          <div className="space-y-1">
            {deferred.length === 0 && (
              <p className="text-xs text-gray-400">No items carried over</p>
            )}
            {deferred.slice(0, 8).map((item) => (
              <div key={`${item.itemCode}-${item.colour}`} className="flex items-center justify-between text-xs rounded px-2 py-1 bg-amber-50 border border-amber-100">
                <div>
                  <span className="font-mono font-medium">{item.itemCode}</span>
                  <span className="text-gray-500 ml-1">/{item.colour}</span>
                </div>
                <div className="text-right text-gray-500">
                  W{item.originalWeek ?? "?"} → W{item.newWeek ?? "?"}
                  <span className="ml-2 text-amber-700 font-medium">{fmtPcs(item.remainingToProduce)}</span>
                </div>
              </div>
            ))}
            {deferred.length > 8 && (
              <p className="text-xs text-gray-400">+{deferred.length - 8} more</p>
            )}
          </div>
        </div>

        {/* Categories gaining most demand */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            Reallocate capacity toward
          </p>
          <div className="space-y-1">
            {topCats.length === 0 && (
              <p className="text-xs text-gray-400">No significant demand shifts</p>
            )}
            {topCats.map(([cat, delta]) => (
              <div key={cat} className="flex items-center justify-between text-xs rounded px-2 py-1 bg-indigo-50 border border-indigo-100">
                <span className="truncate max-w-[120px]" title={cat}>{cat}</span>
                <span className="text-indigo-700 font-medium ml-2">+{fmtPcs(delta)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Revised Release Table ────────────────────────────────────────────────────

const PTMT_CATEGORY_ORDER = [
  "Cocks Standard",
  "Cocks Premium",
  "Faucets & Jetsprays & Shower",
  "Accessorise",
  "Cistern & Seat Cover",
  "Cabinet",
  "Ball Cock",
];

const PLUMBING_CATEGORY_ORDER = [
  "CPVC Pipe",
  "CPVC Fitting",
  "CPVC Solvent",
  "UPVC Pipe",
  "UPVC Fitting",
  "UPVC Solvent",
  "SWR Pipe",
  "SWR Fitting",
  "SWR Solvent",
  "AGRI Pipe",
  "AGRI Fitting",
  "AGRI Solvent",
];

function RevisedReleaseTable({
  items,
  weekClosed,
  segment,
}: {
  items: CorrectiveItemResult[];
  weekClosed: number;
  segment: string;
}) {
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [search, setSearch] = useState("");

  const CATEGORY_ORDER = segment === "Plumbing" ? PLUMBING_CATEGORY_ORDER : PTMT_CATEGORY_ORDER;
  const allStatuses = [...new Set(items.map(i => i.status))].sort();
  const allCategories = [...new Set(items.map(i => i.category))].sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a);
    const bi = CATEGORY_ORDER.indexOf(b);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.localeCompare(b);
  });

  const filtered = items.filter(item => {
    if (filterStatus !== "all" && item.status !== filterStatus) return false;
    if (filterCategory !== "all" && item.category !== filterCategory) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!item.itemCode.toLowerCase().includes(q) && !item.colour.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const remainingWeeks = [1, 2, 3, 4].filter(w => w > weekClosed);

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search code / colour…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="h-7 w-40 text-xs"
        />
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="h-7 rounded border border-gray-300 text-xs px-2"
        >
          <option value="all">All statuses</option>
          {allStatuses.map(s => (
            <option key={s} value={s}>{STATUS_META[s]?.label ?? s}</option>
          ))}
        </select>
        <select
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value)}
          className="h-7 rounded border border-gray-300 text-xs px-2"
        >
          <option value="all">All categories</option>
          {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="text-xs text-gray-400">{filtered.length} items</span>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-xs min-w-[1100px]">
          <thead>
            <tr className="bg-gray-50 border-b text-[10px] font-semibold uppercase tracking-wide text-gray-600">
              <th className="px-2 py-2 text-left">Category</th>
              <th className="px-2 py-2 text-left">Code</th>
              <th className="px-2 py-2 text-left">Colour</th>
              <th className="px-2 py-2 text-right">Orig Plan</th>
              <th className="px-2 py-2 text-center">Orig W</th>
              <th className="px-2 py-2 text-right">Produced</th>
              <th className="px-2 py-2 text-right">New Orders Δ</th>
              <th className="px-2 py-2 text-right">Revised</th>
              <th className="px-2 py-2 text-right font-bold text-gray-800">Remaining</th>
              <th className="px-2 py-2 text-right">Cover</th>
              <th className="px-2 py-2 text-center font-bold text-gray-800">New W</th>
              {remainingWeeks.map(w => (
                <th key={w} className="px-2 py-2 text-right" style={{ color: WEEK_COLORS[w - 1] }}>W{w} Rev</th>
              ))}
              <th className="px-2 py-2 text-right">Δ Net</th>
              <th className="px-2 py-2 text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.map((item, idx) => {
              const deltaNetColor =
                item.deltaNet > 500 ? "text-red-700 font-medium" :
                item.deltaNet < -500 ? "text-green-700 font-medium" :
                "text-gray-500";
              const newOrderColor = item.deltaNewOrders > 0 ? "text-orange-700 font-medium" :
                item.deltaNewOrders < 0 ? "text-green-700" : "text-gray-400";

              return (
                <tr
                  key={idx}
                  className={cn(
                    "hover:bg-gray-50 transition-colors",
                    item.status === "unfulfillable" && "bg-red-50/50",
                    item.status === "carried-over" && "bg-amber-50/40",
                  )}
                >
                  <td className="px-2 py-1.5 text-gray-500 max-w-[120px] truncate" title={item.category}>{item.category}</td>
                  <td className="px-2 py-1.5 font-mono font-medium">{item.itemCode}</td>
                  <td className="px-2 py-1.5 text-gray-600">{item.colour}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{fmtPcs(item.originalPlan)}</td>
                  <td className="px-2 py-1.5 text-center">
                    {item.originalWeek ? (
                      <span className="inline-block w-6 h-5 rounded text-center text-[10px] font-bold"
                        style={{ color: WEEK_COLORS[(item.originalWeek ?? 1) - 1], background: `${WEEK_COLORS[(item.originalWeek ?? 1) - 1]}20` }}>
                        W{item.originalWeek}
                      </span>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-green-700">{fmtPcs(item.producedToDate)}</td>
                  <td className={cn("px-2 py-1.5 text-right tabular-nums", newOrderColor)}>
                    {item.deltaNewOrders !== 0 ? (item.deltaNewOrders > 0 ? "+" : "") + fmtPcs(item.deltaNewOrders) : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtPcs(item.planRev)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-bold">{fmtPcs(item.remainingToProduce)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {item.coverNow !== null && item.coverNow !== undefined
                      ? <span className={cn(item.coverNow < 0.2 ? "text-red-700 font-bold" : item.coverNow < 0.5 ? "text-orange-600" : "text-gray-600")}>
                          {item.coverNow.toFixed(2)}
                        </span>
                      : <span className="text-gray-400">OS</span>
                    }
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    {item.newWeek ? (
                      <span className="inline-block w-6 h-5 rounded text-center text-[10px] font-bold"
                        style={{ color: "#fff", background: WEEK_COLORS[(item.newWeek ?? 1) - 1] }}>
                        W{item.newWeek}
                      </span>
                    ) : item.status === "unfulfillable"
                      ? <span className="text-red-700 font-bold text-[10px]">UNFUL</span>
                      : <span className="text-gray-300">—</span>
                    }
                  </td>
                  {remainingWeeks.map(w => (
                    <td key={w} className="px-2 py-1.5 text-right tabular-nums">
                      {w === 1 ? (item.w1Rev > 0 ? <span style={{ color: WEEK_COLORS[0] }} className="font-medium">{fmtPcs(item.w1Rev)}</span> : "") : null}
                      {w === 2 ? (item.w2Rev > 0 ? <span style={{ color: WEEK_COLORS[1] }} className="font-medium">{fmtPcs(item.w2Rev)}</span> : "") : null}
                      {w === 3 ? (item.w3Rev > 0 ? <span style={{ color: WEEK_COLORS[2] }} className="font-medium">{fmtPcs(item.w3Rev)}</span> : "") : null}
                      {w === 4 ? (item.w4Rev > 0 ? <span style={{ color: WEEK_COLORS[3] }} className="font-medium">{fmtPcs(item.w4Rev)}</span> : "") : null}
                    </td>
                  ))}
                  <td className={cn("px-2 py-1.5 text-right tabular-nums", deltaNetColor)}>
                    {item.deltaNet !== 0 ? (item.deltaNet > 0 ? "+" : "") + fmtPcs(item.deltaNet) : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <StatusBadge status={item.status} />
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={20} className="px-3 py-6 text-center text-sm text-gray-400">
                  No items match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Category Feasibility Table ───────────────────────────────────────────────

interface EngineCategoryResult {
  category: string;
  plan: number;
  produced: number;
  remaining: number;
  capPerDay: number;
  capacityMethod?: string;
  capacityDays?: number | null;
  feasible: number;
  shortfall: number;
  daysRun?: number;
  elapsedWorkingDays?: number;
  feasibleAtRunRate?: number;
  runRateDivergenceFlag?: boolean;
  flags?: string[];
}

function CategoryFeasibilityTable({
  result,
}: {
  result: CorrectiveReplanResult;
}) {
  const cats = (result.categories as unknown as EngineCategoryResult[]) ?? [];
  const CATEGORY_ORDER =
    result.segment === "Plumbing" ? PLUMBING_CATEGORY_ORDER : PTMT_CATEGORY_ORDER;

  if (!cats || cats.length === 0) {
    return (
      <p className="text-sm text-gray-400 py-4">
        No category data available for this run.
      </p>
    );
  }

  const ordered = [...cats].sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a.category);
    const bi = CATEGORY_ORDER.indexOf(b.category);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.category.localeCompare(b.category);
  });

  const divergentCount = ordered.filter((c) => c.runRateDivergenceFlag).length;

  return (
    <div className="space-y-3">
      {divergentCount > 0 && (
        <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
          <span className="font-semibold">⚠ {divergentCount} categor{divergentCount === 1 ? "y" : "ies"} flagged for run-rate divergence</span>
          {" "}— capacity-based projection is &gt;50% more optimistic than the demonstrated run-rate.
          These categories are unlikely to achieve the capacity-based feasible figure.
        </div>
      )}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-xs min-w-[900px]">
          <thead>
            <tr className="bg-gray-50 border-b text-[10px] font-semibold uppercase tracking-wide text-gray-600">
              <th className="px-2 py-2 text-left">Category</th>
              <th className="px-2 py-2 text-right">Revised Plan</th>
              <th className="px-2 py-2 text-right">Produced</th>
              <th className="px-2 py-2 text-right">Remaining</th>
              <th className="px-2 py-2 text-right">Cap/Day</th>
              <th className="px-2 py-2 text-center">Method</th>
              <th className="px-2 py-2 text-right text-blue-700">Feasible (capacity)</th>
              <th className="px-2 py-2 text-right text-indigo-700">Feasible (run-rate)</th>
              <th className="px-2 py-2 text-right">Shortfall</th>
              <th className="px-2 py-2 text-center">Divergence</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {ordered.map((cat) => {
              const isDivergent = cat.runRateDivergenceFlag ?? false;
              const hasRunRate = cat.feasibleAtRunRate !== undefined && cat.feasibleAtRunRate > 0;
              return (
                <tr
                  key={cat.category}
                  className={cn(
                    "hover:bg-gray-50 transition-colors",
                    isDivergent && "bg-amber-50/60",
                  )}
                >
                  <td className="px-2 py-1.5 font-medium text-gray-800">
                    {cat.category}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-gray-600">
                    {fmtPcs(cat.plan)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-green-700">
                    {fmtPcs(cat.produced)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-bold">
                    {fmtPcs(cat.remaining)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-gray-600">
                    {fmtPcs(cat.capPerDay)}
                  </td>
                  <td className="px-2 py-1.5 text-center text-gray-500">
                    {cat.capacityMethod ?? "—"}
                    {cat.capacityDays != null ? (
                      <span className="ml-1 text-gray-400">({cat.capacityDays}d)</span>
                    ) : null}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-blue-700 font-medium">
                    {fmtPcs(cat.feasible)}
                  </td>
                  <td className={cn(
                    "px-2 py-1.5 text-right tabular-nums font-medium",
                    !hasRunRate ? "text-gray-400" :
                    isDivergent ? "text-orange-700" : "text-indigo-700",
                  )}>
                    {hasRunRate ? fmtPcs(cat.feasibleAtRunRate!) : "—"}
                  </td>
                  <td className={cn(
                    "px-2 py-1.5 text-right tabular-nums",
                    cat.shortfall > 0 ? "text-red-700 font-bold" : "text-gray-400",
                  )}>
                    {cat.shortfall > 0 ? fmtPcs(cat.shortfall) : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    {isDivergent ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300">
                        ⚠ Run-rate divergence
                      </span>
                    ) : hasRunRate ? (
                      <span className="text-gray-400 text-[10px]">✓ aligned</span>
                    ) : (
                      <span className="text-gray-300 text-[10px]">no data</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-gray-400">
        <strong>Feasible (capacity)</strong>: Cap/Day × working days remaining — theoretical ceiling.{" "}
        <strong>Feasible (run-rate)</strong>: (produced ÷ days elapsed) × days remaining — based on demonstrated output.{" "}
        Categories flagged <span className="text-amber-700 font-medium">⚠ Run-rate divergence</span> have capacity projection &gt;50% above run-rate.
      </p>
    </div>
  );
}

// ─── Category Rollup ──────────────────────────────────────────────────────────

function CategoryRollup({ result }: { result: CorrectiveReplanResult }) {
  const weekCapacity = result.dailyCapacity * result.workingDaysPerWeek;
  const remainingWeeks = [1, 2, 3, 4].filter(w => w > result.weekClosed);
  const CATEGORY_ORDER = result.segment === "Plumbing" ? PLUMBING_CATEGORY_ORDER : PTMT_CATEGORY_ORDER;

  const byCat = new Map<string, { w1: number; w2: number; w3: number; w4: number; original: number }>();
  for (const item of result.items) {
    const c = byCat.get(item.category) ?? { w1: 0, w2: 0, w3: 0, w4: 0, original: 0 };
    c.w1 += item.w1Rev;
    c.w2 += item.w2Rev;
    c.w3 += item.w3Rev;
    c.w4 += item.w4Rev;
    c.original += item.originalPlan;
    byCat.set(item.category, c);
  }

  const ordered = [...byCat.keys()].sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a);
    const bi = CATEGORY_ORDER.indexOf(b);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.localeCompare(b);
  });

  const data = ordered
    .filter(c => byCat.has(c))
    .map(c => {
      const v = byCat.get(c)!;
      return { name: c.replace("& Jetsprays & Shower", "…"), w1: Math.round(v.w1), w2: Math.round(v.w2), w3: Math.round(v.w3), w4: Math.round(v.w4), original: Math.round(v.original) };
    });

  return (
    <div>
      <p className="text-xs text-gray-500 mb-3">
        Revised weekly release per category. Dashed line = one week's capacity ({fmtPcs(weekCapacity)} pcs).
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 40 }}>
          <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-25} textAnchor="end" interval={0} />
          <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
          <Tooltip formatter={(v: number, name: string) => [fmtPcs(v), name === "original" ? "Original" : `W${name.slice(1)} Rev`]} />
          <Legend formatter={v => v === "original" ? "Original" : `${v.toUpperCase()} Revised`} />
          {remainingWeeks.map(w => (
            <Bar key={w} dataKey={`w${w}`} name={`w${w}`} stackId="rev" fill={WEEK_COLORS[w - 1]} radius={w === remainingWeeks.at(-1) ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
          ))}
          <ReferenceLine y={weekCapacity} stroke="#ef4444" strokeDasharray="5 5" strokeWidth={1.5} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Header Summary ───────────────────────────────────────────────────────────

function HeaderSummary({ result }: { result: CorrectiveReplanResult }) {
  const weekCapacity = result.dailyCapacity * result.workingDaysPerWeek;
  const remainingCapacity = (4 - result.weekClosed) * weekCapacity;
  const outlook = result.revisedMonthTotal - result.producedToDate;
  const outlookFeasible = outlook <= remainingCapacity;

  const closedWeekStats = result.weekStats.filter(ws => ws.week <= result.weekClosed);
  const totalLag = closedWeekStats.reduce((s, ws) => s + ws.lag, 0);
  const totalProducedForClosed = closedWeekStats.reduce((s, ws) => s + ws.produced, 0);
  const totalReleasedForClosed = closedWeekStats.reduce((s, ws) => s + ws.released, 0);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div className="rounded-md border bg-white px-3 py-2.5">
        <p className="text-xs text-gray-500">
          {(result as unknown as { asOfDate?: string | null }).asOfDate ? "As of" : "Week closed"}
        </p>
        <p className="text-2xl font-bold">
          {(result as unknown as { asOfDate?: string | null }).asOfDate
            ? new Date((result as unknown as { asOfDate: string }).asOfDate + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
            : `W${result.weekClosed}`}
        </p>
        {(result as unknown as { workingDaysUsed?: number; workingDaysRemaining?: number }).workingDaysUsed !== undefined ? (
          <p className="text-xs text-gray-400">
            {(result as unknown as { workingDaysUsed: number }).workingDaysUsed} used · {(result as unknown as { workingDaysRemaining: number }).workingDaysRemaining} remaining
          </p>
        ) : (
          <p className="text-xs text-gray-400">{result.month}</p>
        )}
      </div>
      <div className={cn("rounded-md border px-3 py-2.5", totalLag > 0 ? "bg-red-50 border-red-200" : "bg-green-50 border-green-200")}>
        <p className="text-xs text-gray-500">Produced vs Released</p>
        <p className={cn("text-xl font-bold tabular-nums", totalLag > 0 ? "text-red-700" : "text-green-700")}>
          {fmtPcs(totalProducedForClosed)} / {fmtPcs(totalReleasedForClosed)}
        </p>
        <p className="text-xs text-gray-500">
          {totalLag > 0 ? `Lag: ${fmtPcs(totalLag)} pcs` : "On track ✅"}
        </p>
      </div>
      <div className="rounded-md border bg-white px-3 py-2.5">
        <p className="text-xs text-gray-500">New orders received</p>
        <p className="text-xl font-bold tabular-nums text-orange-700">+{fmtPcs(result.newOrdersQty)}</p>
        {(() => {
          const r = result as unknown as { baselinePlanRunId?: number | null; planRunId?: number | null };
          const baselineId = r.baselinePlanRunId ?? r.planRunId ?? null;
          return (
            <p className="text-xs text-gray-400">
              {baselineId !== null
                ? <>baseline: Plan run <span className="font-medium text-gray-600">#{baselineId}</span> (frozen)</>
                : "vs live plan baseline"}
            </p>
          );
        })()}
      </div>
      <div className={cn("rounded-md border px-3 py-2.5", outlookFeasible ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200")}>
        <p className="text-xs text-gray-500">Month-end outlook</p>
        <p className={cn("text-lg font-bold tabular-nums", outlookFeasible ? "text-green-700" : "text-amber-700")}>
          {fmtPcs(result.revisedMonthTotal)} pcs
        </p>
        <p className="text-xs text-gray-400">
          {outlookFeasible ? `✅ Achievable (cap: ${fmtPcs(remainingCapacity)})` : `⚠ Exceeds remaining capacity by ${fmtPcs(outlook - remainingCapacity)}`}
        </p>
      </div>
    </div>
  );
}

// ─── Baseline Drift Banner ────────────────────────────────────────────────────

function BaselineDriftBanner({
  items,
  frozenPlanGrandMax,
}: {
  items: CorrectiveItemResult[];
  frozenPlanGrandMax: number | null | undefined;
}) {
  // frozenPlanGrandMax === undefined means the field is not present at all
  // (e.g. freshly returned live replan result that predates migration 022).
  if (frozenPlanGrandMax === undefined) return null;

  // Legacy run: column was null when the run was created.
  if (frozenPlanGrandMax === null) {
    return (
      <div className="rounded-md bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-500">
        ℹ Baseline integrity column was not recorded for this run (legacy run — predates drift tracking).
      </div>
    );
  }

  const grandOrigComputed = items.reduce(
    (s, i) => s + Math.round(Number(i.originalPlan ?? 0)),
    0,
  );
  const drift = Math.abs(grandOrigComputed - frozenPlanGrandMax);

  if (drift <= 200) return null;

  const sign = grandOrigComputed > frozenPlanGrandMax ? "+" : "−";
  const absDrift = Math.abs(grandOrigComputed - frozenPlanGrandMax);

  return (
    <div className="rounded-md bg-amber-50 border border-amber-300 px-3 py-2.5 text-sm text-amber-900">
      <div className="font-semibold mb-0.5">
        ⚠ Baseline drift detected
      </div>
      <div>
        Corrective items sum to{" "}
        <span className="font-medium tabular-nums">{grandOrigComputed.toLocaleString("en-IN")} pcs</span>
        {" "}but the frozen plan run recorded{" "}
        <span className="font-medium tabular-nums">{frozenPlanGrandMax.toLocaleString("en-IN")} pcs</span>
        {" "}({sign}{absDrift.toLocaleString("en-IN")} pcs).
      </div>
      <div className="text-xs text-amber-700 mt-1">
        The original-plan column in this corrective run does not match the frozen plan run's grand total.
        This may indicate the plan run was updated after this corrective was saved, or a rounding discrepancy.
      </div>
    </div>
  );
}

// ─── Run History Sidebar ──────────────────────────────────────────────────────

function RunHistory({ month, segment, selectedRunId, onSelect }: { month: string; segment: string; selectedRunId: number | null; onSelect: (id: number) => void }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, isLoading, refetch } = useListCorrectiveRuns({ month, segment } as any);
  const runs = (data as unknown as CorrectivePlanRunSummary[] | undefined) ?? [];
  const deleteRun = useDeleteCorrectiveRun();
  const pinRun = usePinCorrectiveRun();
  const { toast } = useToast();

  function handleDelete(e: React.MouseEvent, run: CorrectivePlanRunSummary) {
    e.stopPropagation();
    if (!confirm(`Delete corrective run #${run.id}? This cannot be undone.`)) return;
    deleteRun.mutate(
      { id: run.id },
      {
        onSuccess: () => {
          toast({ title: `Run #${run.id} deleted` });
          refetch();
        },
        onError: (err) => {
          // customFetch throws ApiError for all non-2xx; TError=void but runtime type is ApiError
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const apiErr = err as any;
          if (apiErr instanceof ApiError && apiErr.status === 409) {
            const body = apiErr.data as { error?: string };
            toast({
              title: "Cannot delete pinned run",
              description: body?.error ?? `Run #${run.id} is pinned and cannot be deleted. Unpin it first.`,
              variant: "destructive",
            });
          } else {
            toast({ title: `Failed to delete run #${run.id}`, variant: "destructive" });
          }
        },
      },
    );
  }

  function handleTogglePin(e: React.MouseEvent, run: CorrectivePlanRunSummary) {
    e.stopPropagation();
    const newPinned = !run.pinned;
    pinRun.mutate(
      { id: run.id, data: { pinned: newPinned } },
      {
        onSuccess: () => {
          toast({ title: newPinned ? `Run #${run.id} pinned` : `Run #${run.id} unpinned` });
          refetch();
        },
        onError: () => {
          toast({ title: "Failed to update pin status", variant: "destructive" });
        },
      },
    );
  }

  if (isLoading) return <p className="text-xs text-gray-400">Loading history…</p>;
  if (runs.length === 0) return <p className="text-xs text-gray-400">No runs yet for {month}</p>;

  return (
    <div className="space-y-1.5">
      {runs.map(run => (
        <div
          key={run.id}
          onClick={() => onSelect(run.id)}
          className={cn(
            "w-full text-left rounded-md border px-3 py-2 text-xs transition-colors cursor-pointer",
            selectedRunId === run.id
              ? "border-indigo-300 bg-indigo-50 text-indigo-800"
              : "border-gray-200 bg-white hover:bg-gray-50",
          )}
        >
          <div className="flex items-center justify-between mb-0.5">
            <span className="font-semibold flex items-center gap-1">
              {run.pinned && (
                <span title="Pinned — protected from deletion" className="text-amber-600">📌</span>
              )}
              {(run as unknown as { note?: string | null }).note ?? `W${run.weekClosed}`} — Run #{run.id}
            </span>
            <div className="flex items-center gap-1">
              {(run.warnings as CorrectiveWarning[]).some(w => w.severity === "critical") && (
                <span className="text-red-700 font-bold">!</span>
              )}
              <button
                onClick={(e) => handleTogglePin(e, run)}
                disabled={pinRun.isPending}
                title={run.pinned ? "Unpin this run" : "Pin to protect from deletion"}
                className={cn(
                  "px-1 py-0.5 rounded text-xs transition-colors",
                  run.pinned
                    ? "text-amber-600 hover:text-amber-800 hover:bg-amber-50"
                    : "text-gray-400 hover:text-amber-600 hover:bg-amber-50",
                )}
              >
                {run.pinned ? "📌" : "📎"}
              </button>
              <button
                onClick={(e) => handleDelete(e, run)}
                disabled={deleteRun.isPending}
                title={run.pinned ? "Pinned — unpin first to delete" : "Delete this run"}
                className={cn(
                  "px-1 py-0.5 rounded text-xs transition-colors",
                  run.pinned
                    ? "text-gray-300 cursor-not-allowed"
                    : "text-gray-400 hover:text-red-600 hover:bg-red-50",
                )}
              >
                🗑
              </button>
            </div>
          </div>
          <div className="text-gray-500">{fmtDt(String(run.createdAt))}</div>
          <div className="text-gray-400 mt-0.5">
            Revised: {fmtPcs(run.revisedMonthTotal)} pcs
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CorrectivePage() {
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const { segment } = useSegment();
  const [month, setMonth] = useState(defaultMonth);
  const [mode, setMode] = useState<"weekClosed" | "asOfDate">("weekClosed");
  const [weekClosed, setWeekClosed] = useState(1);
  const [asOfDate, setAsOfDate] = useState(() => now.toISOString().slice(0, 10));
  const [runResult, setRunResult] = useState<CorrectiveReplanResult | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"table" | "capacity" | "chart" | "actions">("table");

  const replan = useRunCorrectiveReplan();
  const { data: historicRun, isLoading: loadingHistoric } = useGetCorrectiveRun(
    selectedRunId ?? 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { query: { enabled: selectedRunId !== null && selectedRunId !== runResult?.runId } as any },
  );
  const { toast } = useToast();

  const displayResult: CorrectiveReplanResult | null =
    runResult ??
    (selectedRunId !== null && historicRun
      ? (historicRun as unknown as CorrectiveReplanResult)
      : null);

  function handleReplan() {
    const payload = mode === "asOfDate"
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? { month, asOfDate, segment } as any
      : { month, weekClosed, segment };
    replan.mutate(
      { data: payload },
      {
        onSuccess: (data) => {
          const result = data as unknown as CorrectiveReplanResult;
          setRunResult(result);
          setSelectedRunId(result.runId);
          const criticals = result.warnings.filter(w => w.severity === "critical").length;
          toast({
            title: "Corrective re-plan complete",
            description: criticals > 0
              ? `${criticals} critical warning(s) require attention.`
              : `${result.items.length} items re-planned. Plan looks feasible.`,
            variant: criticals > 0 ? "destructive" : "default",
          });
        },
        onError: (err) => {
          toast({ title: "Re-plan failed", description: String(err), variant: "destructive" });
        },
      },
    );
  }

  function handleExportExcel(runId: number) {
    window.open(`/api/corrective/runs/${runId}/export/excel`, "_blank");
  }

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h2 className="text-xl font-semibold">{segment} — Weekly Corrective Re-Plan</h2>
          <p className="text-sm text-gray-500 mt-1">
            Re-plans the remaining weeks using live production, orders, and stock — then capacity-levels
            the revised release so no week is scheduled above its capacity.
          </p>
        </div>

        {/* ── Controls ── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Re-plan parameters</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Month</label>
                <Input
                  type="month"
                  value={month}
                  onChange={e => setMonth(e.target.value)}
                  className="w-36 h-8 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Mode</label>
                <div className="flex gap-1">
                  {(["weekClosed", "asOfDate"] as const).map(m => (
                    <button
                      key={m}
                      onClick={() => setMode(m)}
                      className={cn(
                        "px-3 py-1.5 rounded text-sm font-medium border transition-colors",
                        mode === m
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50",
                      )}
                    >
                      {m === "weekClosed" ? "Week closed" : "As of date"}
                    </button>
                  ))}
                </div>
              </div>
              {mode === "weekClosed" && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Week just closed</label>
                  <div className="flex gap-1">
                    {[0, 1, 2, 3].map(w => (
                      <button
                        key={w}
                        onClick={() => setWeekClosed(w)}
                        className={cn(
                          "px-3 py-1.5 rounded text-sm font-medium border transition-colors",
                          weekClosed === w
                            ? "bg-indigo-600 text-white border-indigo-600"
                            : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50",
                        )}
                      >
                        {w === 0 ? "None" : `W${w}`}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {mode === "asOfDate" && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">As of date</label>
                  <Input
                    type="date"
                    value={asOfDate}
                    onChange={e => setAsOfDate(e.target.value)}
                    className="w-40 h-8 text-sm"
                  />
                </div>
              )}
              <Button
                onClick={handleReplan}
                disabled={replan.isPending || !month}
                className="h-8"
              >
                {replan.isPending ? "Re-planning… (reads live data)" : "Re-plan now"}
              </Button>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              {segment === "Plumbing"
                ? "Uses uploaded stock/pending files and live pending orders. CPVC/UPVC: buffer-driven formula; SWR/AGRI: demand-driven formula."
                : "Uses live production (PTMT ANUJ), live pending orders, and the latest uploaded stock/pending files."}
              {" "}Capacity is applied <strong>per category</strong> from the global table on the{" "}
              <a href="/data" className="underline text-indigo-600 hover:text-indigo-800">Data page</a>.
            </p>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_220px]">
          {/* ── Main panel ── */}
          <div className="space-y-5 min-w-0">
            {replan.isPending && (
              <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-700 animate-pulse">
                ⚙ Running {segment} corrective re-plan — computing revised requirements
                {mode === "asOfDate" ? ` as of ${asOfDate}` : `, capacity-levelling across W${weekClosed + 1}–W4`}…
              </div>
            )}

            {loadingHistoric && (
              <div className="rounded-md bg-gray-50 border border-gray-200 px-4 py-3 text-sm text-gray-500">
                Loading run #{selectedRunId}…
              </div>
            )}

            {displayResult && (
              <>
                {/* Header */}
                <HeaderSummary result={displayResult} />

                {/* Baseline drift */}
                <BaselineDriftBanner
                  items={displayResult.items}
                  frozenPlanGrandMax={displayResult.frozenPlanGrandMax}
                />

                {/* Warnings */}
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm">
                        Warnings
                        {displayResult.warnings.length > 0 && (
                          <span className="ml-2 text-xs font-normal text-gray-500">
                            ({displayResult.warnings.length})
                          </span>
                        )}
                      </CardTitle>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleExportExcel(displayResult.runId)}
                        className="h-7 text-xs"
                      >
                        Export Excel
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <WarningsCard warnings={displayResult.warnings} />
                  </CardContent>
                </Card>

                {/* Variance attribution */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Variance attribution</CardTitle>
                    <p className="text-xs text-gray-500">
                      Gap decomposed into production satisfaction vs new demand vs capacity infeasibility.
                    </p>
                  </CardHeader>
                  <CardContent>
                    <VarianceCard result={displayResult} />
                  </CardContent>
                </Card>

                {/* Tabs */}
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-3">
                      {(["table", "capacity", "chart", "actions"] as const).map(tab => {
                        const divergentCount = tab === "capacity"
                          ? ((displayResult.categories as unknown as EngineCategoryResult[]) ?? []).filter(c => c.runRateDivergenceFlag).length
                          : 0;
                        return (
                          <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={cn(
                              "px-3 py-1 rounded text-xs font-medium border transition-colors relative",
                              activeTab === tab
                                ? "bg-indigo-600 text-white border-indigo-600"
                                : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50",
                            )}
                          >
                            {tab === "table" ? "Revised Release"
                              : tab === "capacity" ? (
                                <span className="flex items-center gap-1">
                                  Category Capacity
                                  {divergentCount > 0 && (
                                    <span className={cn(
                                      "inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold",
                                      activeTab === tab ? "bg-amber-300 text-amber-900" : "bg-amber-500 text-white",
                                    )}>
                                      {divergentCount}
                                    </span>
                                  )}
                                </span>
                              )
                              : tab === "chart" ? "Capacity Chart"
                              : "Corrective Actions"}
                          </button>
                        );
                      })}
                    </div>
                  </CardHeader>
                  <CardContent>
                    {activeTab === "table" && (
                      <RevisedReleaseTable items={displayResult.items} weekClosed={displayResult.weekClosed} segment={displayResult.segment ?? segment} />
                    )}
                    {activeTab === "capacity" && (
                      <CategoryFeasibilityTable result={displayResult} />
                    )}
                    {activeTab === "chart" && (
                      <div className="space-y-6">
                        <div>
                          <h4 className="text-sm font-medium mb-2">Original W1–W4 release vs capacity</h4>
                          <CapacityChart weekStats={displayResult.weekStats} weekClosed={displayResult.weekClosed} />
                        </div>
                        <div>
                          <h4 className="text-sm font-medium mb-2">Revised release by category</h4>
                          <CategoryRollup result={displayResult} />
                        </div>
                        {/* Week stats table */}
                        <div>
                          <h4 className="text-sm font-medium mb-2">Week-by-week summary</h4>
                          <div className="rounded-md border overflow-hidden">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="bg-gray-50 border-b text-xs font-semibold text-gray-600">
                                  <th className="px-3 py-2 text-left">Week</th>
                                  <th className="px-3 py-2 text-right">Original Release</th>
                                  <th className="px-3 py-2 text-right">Capacity</th>
                                  <th className="px-3 py-2 text-right">Load Factor</th>
                                  <th className="px-3 py-2 text-right">Produced</th>
                                  <th className="px-3 py-2 text-right">Lag</th>
                                  <th className="px-3 py-2 text-center">Status</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y">
                                {displayResult.weekStats.map(ws => (
                                  <tr key={ws.week} className={cn("hover:bg-gray-50", ws.week <= displayResult.weekClosed && "text-gray-400")}>
                                    <td className="px-3 py-2 font-semibold" style={{ color: WEEK_COLORS[ws.week - 1] }}>{ws.weekLabel}</td>
                                    <td className="px-3 py-2 text-right tabular-nums">{fmtPcs(ws.released)}</td>
                                    <td className="px-3 py-2 text-right tabular-nums">{fmtPcs(ws.capacity)}</td>
                                    <td className={cn("px-3 py-2 text-right font-bold tabular-nums", ws.loadFactor > 2 ? "text-red-700" : ws.loadFactor > 1.05 ? "text-orange-600" : "text-green-700")}>
                                      {ws.loadFactor.toFixed(1)}×
                                    </td>
                                    <td className="px-3 py-2 text-right tabular-nums text-green-700">
                                      {ws.produced > 0 ? fmtPcs(ws.produced) : "—"}
                                    </td>
                                    <td className={cn("px-3 py-2 text-right tabular-nums", ws.lag > 0 ? "text-red-700 font-medium" : "text-gray-400")}>
                                      {ws.lag > 0 ? fmtPcs(ws.lag) : "—"}
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                      <Badge className={cn("text-xs capitalize", {
                                        "bg-gray-100 text-gray-700": ws.status === "closed",
                                        "bg-blue-100 text-blue-700": ws.status === "future",
                                        "bg-red-100 text-red-700": ws.status === "unfulfillable",
                                      })}>
                                        {ws.status}
                                      </Badge>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    )}
                    {activeTab === "actions" && (
                      <CorrectiveActionsCard result={displayResult} />
                    )}
                  </CardContent>
                </Card>
              </>
            )}

            {!displayResult && !replan.isPending && !loadingHistoric && (
              <div className="rounded-md bg-gray-50 border border-gray-200 px-4 py-8 text-center text-gray-500">
                <p className="text-base font-medium mb-1">No corrective plan yet</p>
                <p className="text-sm">Configure the parameters above and click <strong>Re-plan now</strong> to run the engine.</p>
                <p className="text-xs mt-2 text-gray-400">
                  {segment === "Plumbing"
                    ? "This uses uploaded stock/pending files and live orders — expect 5–15 seconds."
                    : "This reads live PTMT ANUJ production data and live pending orders — expect 5–15 seconds."}
                </p>
              </div>
            )}
          </div>

          {/* ── History sidebar ── */}
          <div className="space-y-3">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                Run history
              </h3>
              <RunHistory
                month={month}
                segment={segment}
                selectedRunId={selectedRunId}
                onSelect={id => { setSelectedRunId(id); setRunResult(null); }}
              />
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

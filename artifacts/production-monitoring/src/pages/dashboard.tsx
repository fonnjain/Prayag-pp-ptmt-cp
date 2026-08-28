import { useState } from "react";
import { useGetPlantLiveSummary, getGetPlantLiveSummaryQueryKey } from "@workspace/api-client-react";
import type { PlantLiveMachineMetrics } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlantLiveGatedBanner } from "@/components/plant-live-gated-banner";
import {
  Cpu, RefreshCw, TrendingDown, TrendingUp, AlertTriangle,
  CheckCircle2, Activity, Clock, Search, ArrowUpDown,
} from "lucide-react";

type SortKey = "name" | "utilisation" | "output" | "rejection" | "hours";
type SortDir = "asc" | "desc";

function fmt(n: number | null | undefined, dec = 1): string {
  if (n == null) return "–";
  return n.toFixed(dec);
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return "–";
  return Number(n).toLocaleString("en-IN", { maximumFractionDigits: 1 });
}

function rejectionPctLabel(basis: string | undefined): string {
  if (basis === "net") return "Rejection % · rejects ÷ good output";
  if (basis === "gross") return "Rejection % · rejects ÷ total manufactured";
  return "Rejection %";
}

function ragBg(rating: string | undefined) {
  if (rating === "green") return "bg-emerald-500/15 text-emerald-700 border-emerald-500/30";
  if (rating === "amber") return "bg-amber-500/15 text-amber-700 border-amber-500/30";
  return "bg-red-500/15 text-red-600 border-red-500/30";
}

function ragText(rating: string | undefined) {
  if (rating === "green") return "text-emerald-600";
  if (rating === "amber") return "text-amber-600";
  return "text-red-500";
}

function UtilBar({ pct }: { pct: number | null | undefined }) {
  const v = Math.min(100, Math.max(0, pct ?? 0));
  const color = v >= 60 ? "bg-emerald-500" : v >= 35 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${v}%` }} />
    </div>
  );
}

export default function MachineDashboard({ month, plant = "PTMT" }: { month: string; plant?: string }) {
  const [sortKey, setSortKey] = useState<SortKey>("utilisation");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [search, setSearch] = useState("");

  const { data: raw, isLoading, isRefetching, refetch } = useGetPlantLiveSummary(
    { period: month, plant },
    {
      query: {
        queryKey: getGetPlantLiveSummaryQueryKey({ period: month, plant }),
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
        // Keep the previous month visible while the new upstream period is
        // loading. This avoids replacing a usable dashboard with an empty
        // shell during a slow plant-service request.
        placeholderData: (previous: unknown) => previous,
      } as any,
    }
  );
  const d = raw as any;
  const overall: PlantLiveMachineMetrics | undefined = d?.overall;
  const period = d?.period;
  const byMachine: Record<string, PlantLiveMachineMetrics> = d?.by_machine ?? {};
  const figuresGated = d?.figures_gated === true;
  const rejectionLabel = rejectionPctLabel(overall?.total_count_basis);

  const machines: [string, PlantLiveMachineMetrics][] = Object.entries(byMachine).filter(
    ([name]) => !search || name.toLowerCase().includes(search.toLowerCase())
  );

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  const sorted = [...machines].sort(([an, a], [bn, b]) => {
    let av: number, bv: number;
    switch (sortKey) {
      case "name":       av = 0; bv = 0; return sortDir === "asc" ? an.localeCompare(bn) : bn.localeCompare(an);
      case "utilisation": av = a.utilisation ?? -1; bv = b.utilisation ?? -1; break;
      case "output":     av = a.good_count ?? -1; bv = b.good_count ?? -1; break;
      case "rejection":  av = a.rejection_pct ?? -1; bv = b.rejection_pct ?? -1; break;
      case "hours":      av = a.actual_hours ?? -1; bv = b.actual_hours ?? -1; break;
      default:           av = 0; bv = 0;
    }
    return sortDir === "asc" ? av - bv : bv - av;
  });

  const activeMachines = machines.filter(([, m]) => (m.actual_hours ?? 0) > 0).length;
  const topPerformers = [...machines].sort(([, a], [, b]) => (b.utilisation ?? 0) - (a.utilisation ?? 0)).slice(0, 3);
  const worstRejection = [...machines].filter(([, m]) => (m.rejection_pct ?? 0) > 0)
    .sort(([, a], [, b]) => (b.rejection_pct ?? 0) - (a.rejection_pct ?? 0)).slice(0, 3);

  function SortIcon({ col }: { col: SortKey }) {
    return <ArrowUpDown className={`h-3 w-3 ${sortKey === col ? "text-primary" : "opacity-40"}`} />;
  }

  if (isLoading) return (
    <div className="space-y-4 animate-pulse">
      <div className="h-28 bg-muted/40 rounded-xl" />
      <div className="grid grid-cols-4 gap-4">{[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-muted/40 rounded-xl" />)}</div>
      <div className="h-64 bg-muted/40 rounded-xl" />
    </div>
  );

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto pb-10">
      {/* Header */}
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2 mb-1">
            <Cpu className="h-7 w-7 text-primary" /> Machine Dashboard
          </h1>
          <p className="text-muted-foreground text-sm">
            {plant} machine-level performance &nbsp;·&nbsp;
            {period ? `${period.label} (${period.from} → ${period.to})` : month}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isRefetching} className="gap-2 mt-1">
          <RefreshCw className={`h-3.5 w-3.5 ${isRefetching ? "animate-spin" : ""}`} />
          {isRefetching ? "Refreshing…" : "Refresh"}
        </Button>
      </header>

      {figuresGated && <PlantLiveGatedBanner />}

      {/* Hero KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className={`border ${figuresGated ? "border-amber-500/20 bg-amber-500/5" : overall?.util_available ? "border-primary/20 bg-primary/5" : "border-border/50"}`}>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Activity className="h-3.5 w-3.5" /> Utilisation
            </div>
            <div className={`text-3xl font-bold ${figuresGated ? "text-muted-foreground/70" : ragText(overall?.util_rating)}`}>
              {figuresGated ? "–" : overall?.utilisation != null ? `${fmt(overall.utilisation)}%` : "–"}
            </div>
            <div className="text-xs text-muted-foreground mt-1">{figuresGated ? "Needs review" : overall?.util_rating?.toUpperCase() ?? "–"}</div>
          </CardContent>
        </Card>

        <Card className={`border ${figuresGated ? "border-amber-500/20 bg-amber-500/5" : "border-border/50"}`}>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <TrendingUp className="h-3.5 w-3.5" /> Output (kg)
            </div>
            <div className="text-3xl font-bold text-muted-foreground/70">{figuresGated ? "–" : fmtNum(overall?.good_count)}</div>
            <div className="text-xs text-muted-foreground mt-1">{figuresGated ? "Needs review" : `good output · ${overall?.unit ?? "kg"}`}</div>
          </CardContent>
        </Card>

        <Card className={`border ${figuresGated ? "border-amber-500/20 bg-amber-500/5" : (overall?.rejection_pct ?? 0) > 5 ? "border-red-500/20 bg-red-500/5" : "border-border/50"}`}>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <TrendingDown className="h-3.5 w-3.5" /> {rejectionLabel}
            </div>
            <div className={`text-3xl font-bold ${figuresGated ? "text-muted-foreground/70" : (overall?.rejection_pct ?? 0) > 5 ? "text-red-500" : (overall?.rejection_pct ?? 0) > 2 ? "text-amber-600" : "text-emerald-600"}`}>
              {figuresGated ? "–" : `${fmt(overall?.rejection_pct)}%`}
            </div>
            <div className="text-xs text-muted-foreground mt-1">{figuresGated ? "Needs review" : `${fmtNum(overall?.reject_count)} kg rejected`}</div>
          </CardContent>
        </Card>

        <Card className={`border ${figuresGated ? "border-amber-500/20 bg-amber-500/5" : "border-border/50"}`}>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Clock className="h-3.5 w-3.5" /> Run Hours
            </div>
            <div className="text-3xl font-bold text-muted-foreground/70">{figuresGated ? "–" : fmtNum(overall?.actual_hours)}</div>
            <div className="text-xs text-muted-foreground mt-1">{figuresGated ? "Needs review" : `of ${fmtNum(overall?.ideal_hours)} ideal · ${activeMachines}/${machines.length} machines active`}</div>
          </CardContent>
        </Card>
      </div>

      {/* Spotlight cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Top Performers
              <span className="font-normal text-muted-foreground text-xs">highest utilisation</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {figuresGated ? (
              <div className="py-2 text-sm text-muted-foreground">Ranked machine KPIs are withheld until source review is complete.</div>
            ) : topPerformers.map(([name, m]) => (
              <div key={name} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
                <span className="text-sm font-medium">{name}</span>
                <div className="flex items-center gap-3">
                  <UtilBar pct={m.utilisation} />
                  <span className={`text-sm font-mono font-semibold w-14 text-right ${ragText(m.util_rating)}`}>
                    {fmt(m.utilisation)}%
                  </span>
                </div>
              </div>
            ))}
            {!figuresGated && topPerformers.length === 0 && <div className="text-muted-foreground text-sm py-2">No data</div>}
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" /> Highest Rejection
              <span className="font-normal text-muted-foreground text-xs">needs attention</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {figuresGated ? (
              <div className="py-2 text-sm text-muted-foreground">Ranked machine KPIs are withheld until source review is complete.</div>
            ) : worstRejection.map(([name, m]) => (
              <div key={name} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
                <span className="text-sm font-medium">{name}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">{fmtNum(m.reject_count)} kg</span>
                  <span className={`text-sm font-mono font-semibold w-14 text-right ${(m.rejection_pct ?? 0) > 5 ? "text-red-500" : "text-amber-600"}`}>
                    {fmt(m.rejection_pct)}%
                  </span>
                </div>
              </div>
            ))}
            {!figuresGated && worstRejection.length === 0 && (
              <div className="flex items-center gap-2 text-sm text-emerald-600 py-2">
                <CheckCircle2 className="h-4 w-4" /> No rejection recorded
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Full machine table */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">All Machines — {sorted.length} of {machines.length}</CardTitle>
            <div className="relative w-52">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search machines…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-8 h-8 text-sm"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 border-y border-border/50">
                <tr>
                  <th className="text-left py-2.5 px-4 font-medium text-muted-foreground cursor-pointer hover:text-foreground" onClick={() => toggleSort("name")}>
                    <span className="flex items-center gap-1">Machine <SortIcon col="name" /></span>
                  </th>
                  <th className="text-center py-2.5 px-3 font-medium text-muted-foreground">Headline</th>
                  <th className="text-right py-2.5 px-3 font-medium text-muted-foreground cursor-pointer hover:text-foreground" onClick={() => toggleSort("utilisation")}>
                    <span className="flex items-center gap-1 justify-end">Utilisation <SortIcon col="utilisation" /></span>
                  </th>
                  <th className="text-right py-2.5 px-3 font-medium text-muted-foreground cursor-pointer hover:text-foreground" onClick={() => toggleSort("output")}>
                    <span className="flex items-center gap-1 justify-end">Output (kg) <SortIcon col="output" /></span>
                  </th>
                  <th className="text-right py-2.5 px-3 font-medium text-muted-foreground cursor-pointer hover:text-foreground" onClick={() => toggleSort("rejection")}>
                    <span className="flex items-center gap-1 justify-end">{rejectionLabel} <SortIcon col="rejection" /></span>
                  </th>
                  <th className="text-right py-2.5 px-4 font-medium text-muted-foreground cursor-pointer hover:text-foreground" onClick={() => toggleSort("hours")}>
                    <span className="flex items-center gap-1 justify-end">Run / Ideal hrs <SortIcon col="hours" /></span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {sorted.map(([name, m]) => (
                  <tr key={name} className="hover:bg-muted/20 transition-colors">
                    <td className="py-2.5 px-4 font-medium">{name}</td>
                    <td className="py-2.5 px-3 text-center">
                      <Badge variant="outline" className={`text-xs ${figuresGated ? "border-amber-500/30 text-muted-foreground" : ragBg(m.headline_rating)}`}>
                        {figuresGated ? "Needs review" : `${m.headline != null ? `${fmt(m.headline)}%` : "–"} ${m.headline_label}`}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      {!figuresGated && m.util_available ? (
                        <div className="flex items-center justify-end gap-2">
                          <UtilBar pct={m.utilisation} />
                          <span className={`font-mono font-semibold w-12 text-right ${ragText(m.util_rating)}`}>
                            {fmt(m.utilisation)}%
                          </span>
                        </div>
                      ) : <span className="text-muted-foreground/70">–</span>}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-muted-foreground/70">{figuresGated ? "–" : fmtNum(m.good_count)}</td>
                    <td className="py-2.5 px-3 text-right">
                      {!figuresGated && m.rejection_pct != null ? (
                        <span className={`font-mono font-semibold ${(m.rejection_pct) > 5 ? "text-red-500" : (m.rejection_pct) > 2 ? "text-amber-600" : "text-emerald-600"}`}>
                          {fmt(m.rejection_pct)}%
                        </span>
                      ) : <span className="text-muted-foreground">–</span>}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-muted-foreground text-xs">
                      {figuresGated ? "–" : `${fmt(m.actual_hours, 0)} / ${fmt(m.ideal_hours, 0)}`}
                    </td>
                  </tr>
                ))}
                {sorted.length === 0 && (
                  <tr><td colSpan={6} className="py-10 text-center text-muted-foreground">No machines match "{search}"</td></tr>
                )}
              </tbody>
              {/* Totals row */}
              {overall && (
                <tfoot className="bg-muted/30 border-t border-border/50 font-semibold">
                  <tr>
                    <td className="py-2.5 px-4 text-muted-foreground text-xs uppercase tracking-wider">Total / Plant</td>
                    <td className="py-2.5 px-3 text-center">
                      <Badge variant="outline" className={`text-xs ${figuresGated ? "border-amber-500/30 text-muted-foreground" : ragBg(overall.headline_rating)}`}>
                        {figuresGated ? "Needs review" : `${overall.headline != null ? `${fmt(overall.headline)}%` : "–"} ${overall.headline_label}`}
                      </Badge>
                    </td>
                    <td className={`py-2.5 px-3 text-right font-mono ${figuresGated ? "text-muted-foreground/70" : ragText(overall.util_rating)}`}>
                      {figuresGated ? "–" : `${fmt(overall.utilisation)}%`}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-muted-foreground/70">{figuresGated ? "–" : fmtNum(overall.good_count)}</td>
                    <td className={`py-2.5 px-3 text-right font-mono ${figuresGated ? "text-muted-foreground/70" : (overall.rejection_pct ?? 0) > 5 ? "text-red-500" : "text-emerald-600"}`}>
                      {figuresGated ? "–" : `${fmt(overall.rejection_pct)}%`}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-muted-foreground text-xs">
                      {figuresGated ? "–" : `${fmt(overall.actual_hours, 0)} / ${fmt(overall.ideal_hours, 0)}`}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground text-right">
        Live data from prayag-plant.com · {plant} plant · cached 5 min · {machines.length} machines tracked
      </p>
    </div>
  );
}

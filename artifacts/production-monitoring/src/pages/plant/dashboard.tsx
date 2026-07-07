import { useGetPlantBundle, getGetPlantBundleQueryKey, type PlantBundle } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, Activity, Download } from "lucide-react";

function downloadPdf(month: string, section: string) {
  const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
  window.open(`${base}/api/plant/export/pdf?month=${month}&section=${section}`, "_blank");
}

function fmt(n: number | null | undefined, decimals = 0): string {
  if (n === null || n === undefined) return "–";
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

function pct(n: number | null | undefined): string {
  if (n === null || n === undefined) return "–";
  return `${n.toFixed(1)}%`;
}

function ragColors(band: string | null | undefined) {
  if (band === "green") return { bg: "bg-emerald-500/10 border-emerald-500/30", text: "text-emerald-600", badge: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30" };
  if (band === "amber") return { bg: "bg-amber-500/10 border-amber-500/30", text: "text-amber-600", badge: "bg-amber-500/15 text-amber-700 border-amber-500/30" };
  return { bg: "bg-red-500/10 border-red-500/30", text: "text-red-600", badge: "bg-red-500/15 text-red-700 border-red-500/30" };
}

export default function PlantDashboard({ month }: { month: string }) {
  const { data, isLoading } = useGetPlantBundle(
    { month },
    { query: { queryKey: getGetPlantBundleQueryKey({ month }) } }
  );

  if (isLoading) return <div className="flex items-center justify-center h-64 text-muted-foreground">Loading plant data...</div>;
  if (!data) return <div className="text-red-500 p-4">Failed to load plant data.</div>;
  const bundle = data as unknown as PlantBundle;

  const { plant, context, categories, warnings } = bundle;
  const colors = ragColors(plant.ragBand);
  const criticalWarnings = warnings.filter((w) => w.severity === "critical").length;
  const highWarnings = warnings.filter((w) => w.severity === "high").length;

  return (
    <div className="space-y-6 max-w-[1300px] mx-auto pb-10">
      <header className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight mb-1 flex items-center gap-2">
              <Activity className="h-7 w-7 text-primary" /> Plant Dashboard
            </h1>
            <p className="text-muted-foreground text-sm">
              NOS (pieces) against Production Plan — {month} · {context.elapsed}/{context.workingDays} working days elapsed
              {context.snapshotDate ? ` · snapshot ${context.snapshotDate}` : ""}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => downloadPdf(month, "control-board")}>
            <Download className="h-4 w-4 mr-2" /> Export PDF
          </Button>
        </div>
      </header>

      {!bundle.dataAvailable && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="pt-4 text-amber-600 flex items-center gap-2 text-sm">
            <AlertTriangle className="h-4 w-4" /> No production data found for this month. Ensure the PTMT ANUJ Production tab has been updated.
          </CardContent>
        </Card>
      )}

      {bundle.caveats.length > 0 && (
        <div className="space-y-1">
          {bundle.caveats.map((c, i) => (
            <div key={i} className="text-xs text-muted-foreground bg-muted/30 rounded px-3 py-1.5 border border-border/40">{c}</div>
          ))}
        </div>
      )}

      {/* Plant hero row */}
      <div className={`grid grid-cols-2 md:grid-cols-4 gap-4 p-4 rounded-lg border ${colors.bg}`}>
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Produced to Date</div>
          <div className={`text-3xl font-bold ${colors.text}`}>{fmt(plant.producedToDate)}</div>
          <div className="text-xs text-muted-foreground mt-1">pcs</div>
        </div>
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Cumulative Attainment</div>
          <div className={`text-3xl font-bold ${colors.text}`}>{pct(plant.attainmentCumPct)}</div>
          <div className="text-xs text-muted-foreground mt-1">vs required cum. ({fmt(plant.requiredCum)} pcs)</div>
        </div>
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Month Attainment</div>
          <div className={`text-3xl font-bold ${colors.text}`}>{pct(plant.attainmentMonthPct)}</div>
          <div className="text-xs text-muted-foreground mt-1">vs Max PP ({fmt(plant.targetMax)} pcs)</div>
        </div>
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Projected End</div>
          <div className={`text-3xl font-bold ${colors.text}`}>{pct(plant.projectedAttainmentPct)}</div>
          <div className="text-xs text-muted-foreground mt-1">at {fmt(plant.actualPerDay, 0)} pcs/day</div>
        </div>
      </div>

      {/* KPI cards row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-sm text-muted-foreground">Required/Day</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{fmt(plant.requiredPerDay)}</div><div className="text-xs text-muted-foreground">pcs/working day</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-sm text-muted-foreground">Catch-up/Day</CardTitle></CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${plant.catchUpPerDay !== null && plant.catchUpPerDay > plant.requiredPerDay * 1.2 ? "text-red-500" : ""}`}>{fmt(plant.catchUpPerDay)}</div>
            <div className="text-xs text-muted-foreground">{plant.catchUpVsPlanPct !== null ? `${plant.catchUpVsPlanPct.toFixed(0)}% of plan/day` : "–"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-sm text-muted-foreground">Days Ahead/Behind</CardTitle></CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold flex items-center gap-1 ${plant.daysAheadBehind !== null && plant.daysAheadBehind < 0 ? "text-red-500" : "text-emerald-600"}`}>
              {plant.daysAheadBehind !== null ? (plant.daysAheadBehind >= 0 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />) : null}
              {plant.daysAheadBehind !== null ? `${Math.abs(plant.daysAheadBehind).toFixed(1)}d` : "–"}
            </div>
            <div className="text-xs text-muted-foreground">{plant.daysAheadBehind !== null ? (plant.daysAheadBehind >= 0 ? "ahead" : "behind") : "no data"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-sm text-muted-foreground">Linearity Index</CardTitle></CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${plant.linearityIndex !== null && plant.linearityIndex < 0.6 ? "text-amber-500" : "text-emerald-600"}`}>
              {plant.linearityIndex !== null ? plant.linearityIndex.toFixed(2) : "–"}
            </div>
            <div className="text-xs text-muted-foreground">1.0 = perfect linearity</div>
          </CardContent>
        </Card>
      </div>

      {/* Target row */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-sm text-muted-foreground">Max PP (Target)</CardTitle></CardHeader>
          <CardContent><div className="text-xl font-bold">{fmt(plant.targetMax)}</div><div className="text-xs text-muted-foreground">pcs for the month</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-sm text-muted-foreground">Min PP (Floor)</CardTitle></CardHeader>
          <CardContent>
            <div className={`text-xl font-bold ${plant.projectedMinAttainmentPct !== null && plant.projectedMinAttainmentPct < 100 ? "text-red-500" : ""}`}>{fmt(plant.targetMin)}</div>
            <div className="text-xs text-muted-foreground">Projected: {pct(plant.projectedMinAttainmentPct)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-sm text-muted-foreground">Best Day Output</CardTitle></CardHeader>
          <CardContent><div className="text-xl font-bold">{fmt(plant.bestDayOutput)}</div><div className="text-xs text-muted-foreground">pcs in best day</div></CardContent>
        </Card>
      </div>

      {/* Category summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Category Attainment Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {categories.map((cat) => {
              const cc = ragColors(cat.ragBand);
              const pct_val = cat.attainmentCumPct ?? 0;
              return (
                <div key={cat.category} className="flex items-center gap-3">
                  <div className="w-44 text-sm font-medium truncate">{cat.category}</div>
                  <div className="flex-1 bg-muted/40 rounded-full h-2 overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${cat.ragBand === "green" ? "bg-emerald-500" : cat.ragBand === "amber" ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${Math.min(pct_val, 100)}%` }} />
                  </div>
                  <div className="w-16 text-right text-sm font-mono">{pct(cat.attainmentCumPct)}</div>
                  <Badge variant="outline" className={`text-xs w-16 justify-center ${cc.badge}`}>{fmt(cat.producedToDate)} pcs</Badge>
                  <div className="text-xs text-muted-foreground w-24 text-right">target {fmt(cat.targetMax)}</div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Warnings banner */}
      {(criticalWarnings > 0 || highWarnings > 0) && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="pt-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0" />
            <div className="text-sm">
              {criticalWarnings > 0 && <span className="text-red-600 font-semibold mr-2">{criticalWarnings} critical</span>}
              {highWarnings > 0 && <span className="text-amber-600 font-semibold mr-2">{highWarnings} high</span>}
              <span className="text-muted-foreground">warnings — see Warnings page</span>
            </div>
          </CardContent>
        </Card>
      )}

      {warnings.length === 0 && bundle.dataAvailable && (
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="pt-4 flex items-center gap-2 text-sm text-emerald-600">
            <CheckCircle2 className="h-4 w-4" /> All KPIs within thresholds — no warnings.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

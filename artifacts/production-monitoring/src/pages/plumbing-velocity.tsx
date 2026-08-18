import { useGetPlantLiveSummary, getGetPlantLiveSummaryQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw, TrendingUp, Activity } from "lucide-react";

function fmt(n: number | null | undefined, dec = 0): string {
  if (n == null) return "–";
  return Number(n).toLocaleString("en-IN", { maximumFractionDigits: dec });
}

export default function PlumbingVelocity({ month }: { month: string }) {
  const { data: raw, isLoading, isError, error, isRefetching, refetch } = useGetPlantLiveSummary(
    { period: month, plant: "PIPE" },
    { query: { queryKey: getGetPlantLiveSummaryQueryKey({ period: month, plant: "PIPE" }), staleTime: 5 * 60 * 1000 } as any }
  );
  const d = raw as any;
  const overall = d?.overall;
  const byDate: Record<string, any> = d?.by_date ?? {};

  const days = Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({ date, ...data }));

  let cumGood = 0;
  let cumIdeal = 0;
  const rows = days.map((day) => {
    cumGood  += day.good_count  ?? 0;
    cumIdeal += day.ideal_output ?? 0;
    const pace = day.actual_hours > 0 ? (day.good_count / day.actual_hours) : null;
    return { ...day, cumGood, cumIdeal, pace };
  });

  const activeDays = days.filter((d) => (d.good_count ?? 0) > 0).length;
  const avgPerDay  = activeDays > 0 ? Math.round((overall?.good_count ?? 0) / activeDays) : 0;
  const totalGood  = overall?.good_count ?? 0;
  const totalIdeal = overall?.ideal_output ?? 0;

  if (isLoading) return (
    <div className="space-y-4 animate-pulse">
      <div className="h-24 bg-muted/40 rounded-xl" />
      <div className="h-64 bg-muted/40 rounded-xl" />
    </div>
  );

  if (isError) {
    const msg = (error as any)?.message ?? String(error);
    const is503 = msg.includes("503");
    return (
      <div className="space-y-6 max-w-[1200px] mx-auto pb-10">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2 mb-1">
          <TrendingUp className="h-6 w-6 text-primary" /> PIPE Plant Velocity
        </h1>
        <div className="text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-4 space-y-1">
          <p className="font-semibold text-red-600">
            {is503 ? "Plant live API not configured" : "Could not load plant live data"}
          </p>
          <p className="text-red-600/80">
            {is503
              ? "The PRAYAG_PLANT_API_KEY secret is missing in the production environment. Deploy environments do not inherit dev secrets automatically — add it via the deployment secrets panel."
              : `API returned: ${msg}. Check that the upstream plant service is reachable and the API key is valid.`}
          </p>
          <p className="text-red-600/60 text-xs pt-1">
            Diagnostic: <code className="font-mono">GET /api/plant-live/periods</code> lists valid period tokens.{" "}
            <code className="font-mono">GET /api/plant-live/summary?period={month}&plant=PIPE</code> shows the raw status.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isRefetching} className="gap-2">
          <RefreshCw className={`h-3.5 w-3.5 ${isRefetching ? "animate-spin" : ""}`} />
          {isRefetching ? "Retrying…" : "Retry"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1200px] mx-auto pb-10">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2 mb-1">
            <TrendingUp className="h-6 w-6 text-primary" /> PIPE Plant Velocity
          </h1>
          <p className="text-muted-foreground text-sm">
            Daily output pace · {month} · {activeDays} active days
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isRefetching} className="gap-2">
          <RefreshCw className={`h-3.5 w-3.5 ${isRefetching ? "animate-spin" : ""}`} />
          {isRefetching ? "Refreshing…" : "Refresh"}
        </Button>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-5">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
              <Activity className="h-3.5 w-3.5" /> Total Output
            </div>
            <div className="text-3xl font-bold">{fmt(totalGood)}</div>
            <div className="text-xs text-muted-foreground mt-1">kg good · month to date</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Avg / Active Day</div>
            <div className="text-3xl font-bold">{fmt(avgPerDay)}</div>
            <div className="text-xs text-muted-foreground mt-1">kg/day · {activeDays} days</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Ideal Output</div>
            <div className="text-3xl font-bold">{fmt(totalIdeal)}</div>
            <div className="text-xs text-muted-foreground mt-1">kg target · {overall?.ideal_hours ?? "–"}h ideal</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Output Efficiency</div>
            <div className={`text-3xl font-bold ${overall?.eff_rating === "green" ? "text-emerald-600" : overall?.eff_rating === "amber" ? "text-amber-600" : "text-red-500"}`}>
              {overall?.output_efficiency != null ? `${overall.output_efficiency.toFixed(1)}%` : "–"}
            </div>
            <div className="text-xs text-muted-foreground mt-1">{overall?.headline_label ?? "–"}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Daily Output Log</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 border-y border-border/50">
                <tr>
                  <th className="text-left py-2.5 px-4 font-medium text-muted-foreground">Date</th>
                  <th className="text-right py-2.5 px-3 font-medium text-muted-foreground">Good (kg)</th>
                  <th className="text-right py-2.5 px-3 font-medium text-muted-foreground">Reject (kg)</th>
                  <th className="text-right py-2.5 px-3 font-medium text-muted-foreground">Rej %</th>
                  <th className="text-right py-2.5 px-3 font-medium text-muted-foreground">Run hrs</th>
                  <th className="text-right py-2.5 px-3 font-medium text-muted-foreground">Util %</th>
                  <th className="text-right py-2.5 px-4 font-medium text-muted-foreground">Cum Good (kg)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {rows.map((row) => (
                  <tr key={row.date} className="hover:bg-muted/20">
                    <td className="py-2 px-4 font-medium">{row.date}</td>
                    <td className="py-2 px-3 text-right font-mono">{fmt(row.good_count)}</td>
                    <td className="py-2 px-3 text-right font-mono text-red-500/80">{row.reject_count > 0 ? fmt(row.reject_count) : "–"}</td>
                    <td className="py-2 px-3 text-right font-mono">
                      {row.rejection_pct > 0
                        ? <span className={row.rejection_pct > 10 ? "text-red-500 font-semibold" : row.rejection_pct > 5 ? "text-amber-600" : "text-emerald-600"}>{row.rejection_pct.toFixed(1)}%</span>
                        : "–"}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-muted-foreground">{fmt(row.actual_hours)}</td>
                    <td className="py-2 px-3 text-right font-mono">
                      {row.utilisation != null
                        ? <span className={row.utilisation >= 80 ? "text-emerald-600" : row.utilisation >= 60 ? "text-amber-600" : "text-red-500"}>{row.utilisation.toFixed(1)}%</span>
                        : "–"}
                    </td>
                    <td className="py-2 px-4 text-right font-mono font-semibold">{fmt(row.cumGood)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={7} className="py-10 text-center text-muted-foreground">No daily data available for {month}</td></tr>
                )}
              </tbody>
              {overall && (
                <tfoot className="bg-muted/30 border-t border-border/50 font-semibold">
                  <tr>
                    <td className="py-2.5 px-4 text-muted-foreground text-xs uppercase">Total</td>
                    <td className="py-2.5 px-3 text-right font-mono">{fmt(overall.good_count)}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-red-500/80">{fmt(overall.reject_count)}</td>
                    <td className="py-2.5 px-3 text-right font-mono">{overall.rejection_pct?.toFixed(1)}%</td>
                    <td className="py-2.5 px-3 text-right font-mono text-muted-foreground">{fmt(overall.actual_hours)}</td>
                    <td className="py-2.5 px-3 text-right font-mono">{overall.utilisation?.toFixed(1)}%</td>
                    <td className="py-2.5 px-4 text-right font-mono">{fmt(overall.good_count)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground text-right">
        Live data from prayag-plant.com · PIPE plant only (fitting/solvent excluded) · cached 5 min
      </p>
    </div>
  );
}

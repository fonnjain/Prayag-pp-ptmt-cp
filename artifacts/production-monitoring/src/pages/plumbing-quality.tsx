import { useGetPlantLiveSummary, getGetPlantLiveSummaryQueryKey } from "@workspace/api-client-react";
import type { PlantLiveMachineMetrics } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, ActivitySquare, CheckCircle2, TrendingDown } from "lucide-react";

function fmt(n: number | null | undefined, dec = 1): string {
  if (n == null) return "–";
  return n.toFixed(dec);
}
function fmtNum(n: number | null | undefined): string {
  if (n == null) return "–";
  return Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
function rejectionPctLabel(basis: string | undefined): string {
  if (basis === "net") return "Rejection % · rejects ÷ good output";
  if (basis === "gross") return "Rejection % · rejects ÷ total manufactured";
  return "Rejection %";
}
function rejColor(pct: number | null | undefined) {
  if (pct == null) return "text-muted-foreground";
  if (pct > 10) return "text-red-500 font-semibold";
  if (pct > 5)  return "text-amber-600 font-semibold";
  return "text-emerald-600";
}
function rejBg(pct: number | null | undefined) {
  if (pct == null) return "";
  if (pct > 10) return "bg-red-500/10 text-red-600 border-red-500/30";
  if (pct > 5)  return "bg-amber-500/10 text-amber-700 border-amber-500/30";
  return "bg-emerald-500/10 text-emerald-700 border-emerald-500/30";
}

export default function PlumbingQuality({ month }: { month: string }) {
  const { data: raw, isLoading, isRefetching, refetch } = useGetPlantLiveSummary(
    { period: month, plant: "PIPE" },
    { query: { queryKey: getGetPlantLiveSummaryQueryKey({ period: month, plant: "PIPE" }), staleTime: 5 * 60 * 1000 } as any }
  );
  const d = raw as any;
  const overall: PlantLiveMachineMetrics | undefined = d?.overall;
  const byMachine: Record<string, PlantLiveMachineMetrics> = d?.by_machine ?? {};
  const rejectionLabel = rejectionPctLabel(overall?.total_count_basis);

  const machines = Object.entries(byMachine)
    .filter(([, m]) => (m.rejection_pct ?? 0) > 0 || (m.reject_count ?? 0) > 0)
    .sort(([, a], [, b]) => (b.rejection_pct ?? 0) - (a.rejection_pct ?? 0));

  const noRejection = Object.entries(byMachine)
    .filter(([, m]) => (m.actual_hours ?? 0) > 0 && (m.rejection_pct ?? 0) === 0);

  if (isLoading) return (
    <div className="space-y-4 animate-pulse">
      <div className="h-24 bg-muted/40 rounded-xl" />
      <div className="h-64 bg-muted/40 rounded-xl" />
    </div>
  );

  return (
    <div className="space-y-6 max-w-[1000px] mx-auto pb-10">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2 mb-1">
            <ActivitySquare className="h-6 w-6 text-primary" /> PIPE Plant Quality
          </h1>
          <p className="text-muted-foreground text-sm">
            Rejection by machine · {month} · {Object.keys(byMachine).length} machines tracked
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isRefetching} className="gap-2">
          <RefreshCw className={`h-3.5 w-3.5 ${isRefetching ? "animate-spin" : ""}`} />
          {isRefetching ? "Refreshing…" : "Refresh"}
        </Button>
      </header>

      <div className="grid grid-cols-3 gap-4">
        <Card className={`border ${(overall?.rejection_pct ?? 0) > 5 ? "border-red-500/20 bg-red-500/5" : "border-border/50"}`}>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <TrendingDown className="h-3.5 w-3.5" /> Plant {rejectionLabel}
            </div>
            <div className={`text-3xl font-bold ${rejColor(overall?.rejection_pct)}`}>
              {fmt(overall?.rejection_pct)}%
            </div>
            <div className="text-xs text-muted-foreground mt-1">{fmtNum(overall?.reject_count)} kg rejected</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Good Output</div>
            <div className="text-3xl font-bold">{fmtNum(overall?.good_count)}</div>
            <div className="text-xs text-muted-foreground mt-1">kg · {overall?.unit ?? "kg"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Machines with Rejection</div>
            <div className={`text-3xl font-bold ${machines.length > 0 ? "text-amber-600" : "text-emerald-600"}`}>{machines.length}</div>
            <div className="text-xs text-muted-foreground mt-1">of {Object.keys(byMachine).length} active</div>
          </CardContent>
        </Card>
      </div>

      {machines.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-red-500" />
              Machines with Rejection — sorted by %
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 border-y border-border/50">
                <tr>
                  <th className="text-left py-2.5 px-4 font-medium text-muted-foreground">Machine</th>
                  <th className="text-right py-2.5 px-3 font-medium text-muted-foreground">{rejectionLabel}</th>
                  <th className="text-right py-2.5 px-3 font-medium text-muted-foreground">Rejected (kg)</th>
                  <th className="text-right py-2.5 px-3 font-medium text-muted-foreground">Good (kg)</th>
                  <th className="text-right py-2.5 px-4 font-medium text-muted-foreground">Run hrs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {machines.map(([name, m]) => (
                  <tr key={name} className="hover:bg-muted/20">
                    <td className="py-2.5 px-4 font-medium">{name}</td>
                    <td className="py-2.5 px-3 text-right">
                      <Badge variant="outline" className={`text-xs font-mono ${rejBg(m.rejection_pct)}`}>
                        {fmt(m.rejection_pct)}%
                      </Badge>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-red-500/80">{fmtNum(m.reject_count)}</td>
                    <td className="py-2.5 px-3 text-right font-mono">{fmtNum(m.good_count)}</td>
                    <td className="py-2.5 px-4 text-right font-mono text-muted-foreground">{fmt(m.actual_hours, 0)}</td>
                  </tr>
                ))}
              </tbody>
              {overall && (
                <tfoot className="bg-muted/30 border-t border-border/50 font-semibold">
                  <tr>
                    <td className="py-2.5 px-4 text-muted-foreground text-xs uppercase">Total / Plant</td>
                    <td className="py-2.5 px-3 text-right">
                      <Badge variant="outline" className={`text-xs font-mono ${rejBg(overall.rejection_pct)}`}>
                        {fmt(overall.rejection_pct)}%
                      </Badge>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-red-500/80">{fmtNum(overall.reject_count)}</td>
                    <td className="py-2.5 px-3 text-right font-mono">{fmtNum(overall.good_count)}</td>
                    <td className="py-2.5 px-4 text-right font-mono text-muted-foreground">{fmt(overall.actual_hours, 0)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-12 flex flex-col items-center gap-3 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-500" />
            <p className="text-lg font-medium">No rejection recorded</p>
            <p className="text-sm text-muted-foreground">All PIPE machines running clean for {month}</p>
          </CardContent>
        </Card>
      )}

      {noRejection.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              Zero-Rejection Machines — {noRejection.length} machines
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {noRejection.map(([name]) => (
                <Badge key={name} variant="outline" className="text-xs bg-emerald-500/10 text-emerald-700 border-emerald-500/30">
                  {name}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground text-right">
        Live data from prayag-plant.com · PIPE plant · cached 5 min
      </p>
    </div>
  );
}

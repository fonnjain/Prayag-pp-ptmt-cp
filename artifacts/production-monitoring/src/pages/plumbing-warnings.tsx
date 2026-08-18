import { useGetPlantLiveSummary, getGetPlantLiveSummaryQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, AlertTriangle, CheckCircle2, Info } from "lucide-react";

function severityIcon(sev: string) {
  if (sev === "error")   return <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />;
  if (sev === "warning") return <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />;
  return <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />;
}
function severityBadge(sev: string) {
  if (sev === "error")   return <Badge variant="outline" className="text-xs bg-red-500/10 text-red-600 border-red-500/30">Error</Badge>;
  if (sev === "warning") return <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-700 border-amber-500/30">Warning</Badge>;
  return <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-700 border-blue-500/30">Info</Badge>;
}

export default function PlumbingWarnings({ month }: { month: string }) {
  const { data: raw, isLoading, isRefetching, isError, error: queryError, refetch } = useGetPlantLiveSummary(
    { period: month, plant: "PIPE" },
    { query: { queryKey: getGetPlantLiveSummaryQueryKey({ period: month, plant: "PIPE" }), staleTime: 5 * 60 * 1000 } as any }
  );
  const d = raw as any;
  const issues: any[] = d?.confirmation?.issues ?? [];
  const pipeIssues = issues.filter((i) => !i.plant || i.plant === "PIPE" || i.plant === "");

  const errors   = pipeIssues.filter((i) => i.severity === "error");
  const warnings = pipeIssues.filter((i) => i.severity === "warning");
  const infos    = pipeIssues.filter((i) => i.severity === "info");

  if (isLoading) return (
    <div className="space-y-4 animate-pulse">
      <div className="h-24 bg-muted/40 rounded-xl" />
      <div className="h-64 bg-muted/40 rounded-xl" />
    </div>
  );

  // Surface plant-live errors explicitly — a failed fetch must not render as "No issues detected"
  if (isError) {
    const msg = (queryError as any)?.message ?? String(queryError ?? "unknown error");
    return (
      <div className="space-y-6 max-w-[1000px] mx-auto pb-10">
        <header className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2 mb-1">
              <AlertTriangle className="h-6 w-6 text-amber-500" /> PIPE Plant Warnings
            </h1>
            <p className="text-muted-foreground text-sm">Plant-level data quality issues · {month}</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isRefetching} className="gap-2">
            <RefreshCw className={`h-3.5 w-3.5 ${isRefetching ? "animate-spin" : ""}`} />
            {isRefetching ? "Refreshing…" : "Retry"}
          </Button>
        </header>
        <div className="text-sm text-amber-700 bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-3 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>Could not load plant-live warnings: {msg}. The plant connection may be unavailable — issue counts are not reliable while data is missing.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1000px] mx-auto pb-10">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2 mb-1">
            <AlertTriangle className="h-6 w-6 text-amber-500" /> PIPE Plant Warnings
          </h1>
          <p className="text-muted-foreground text-sm">
            Plant-level data quality issues · {month} · {pipeIssues.length} total
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isRefetching} className="gap-2">
          <RefreshCw className={`h-3.5 w-3.5 ${isRefetching ? "animate-spin" : ""}`} />
          {isRefetching ? "Refreshing…" : "Refresh"}
        </Button>
      </header>

      <div className="grid grid-cols-3 gap-4">
        <Card className={errors.length > 0 ? "border-red-500/30 bg-red-500/5" : ""}>
          <CardContent className="p-5">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Errors</div>
            <div className={`text-3xl font-bold ${errors.length > 0 ? "text-red-500" : "text-emerald-600"}`}>{errors.length}</div>
          </CardContent>
        </Card>
        <Card className={warnings.length > 0 ? "border-amber-500/30 bg-amber-500/5" : ""}>
          <CardContent className="p-5">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Warnings</div>
            <div className={`text-3xl font-bold ${warnings.length > 0 ? "text-amber-600" : "text-emerald-600"}`}>{warnings.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Info</div>
            <div className="text-3xl font-bold">{infos.length}</div>
          </CardContent>
        </Card>
      </div>

      {pipeIssues.length === 0 ? (
        <Card>
          <CardContent className="py-12 flex flex-col items-center gap-3 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-500" />
            <p className="text-lg font-medium">No issues detected</p>
            <p className="text-sm text-muted-foreground">PIPE plant data quality looks clean for {month}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">All Issues — PIPE Plant</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border/40">
            {[...errors, ...warnings, ...infos].map((issue, idx) => (
              <div key={idx} className="flex gap-3 py-3">
                {severityIcon(issue.severity)}
                <div className="flex-1 min-w-0">
                  <p className="text-sm leading-snug">{issue.message}</p>
                  {issue.plant && (
                    <p className="text-xs text-muted-foreground mt-0.5">Plant: {issue.plant}</p>
                  )}
                </div>
                <div className="shrink-0">{severityBadge(issue.severity)}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground text-right">
        Live data from prayag-plant.com · PIPE plant · cached 5 min
      </p>
    </div>
  );
}

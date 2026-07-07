import { useGetPlantBundle, getGetPlantBundleQueryKey, type PlantBundle } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, AlertCircle, Info, CheckCircle2 } from "lucide-react";

const SEV_CONFIG = {
  critical: { icon: AlertCircle, border: "border-red-500/40 bg-red-500/5", badge: "text-red-600 border-red-500/30 bg-red-500/5", label: "Critical" },
  high: { icon: AlertTriangle, border: "border-amber-500/40 bg-amber-500/5", badge: "text-amber-600 border-amber-500/30 bg-amber-500/5", label: "High" },
  medium: { icon: AlertTriangle, border: "border-yellow-500/40 bg-yellow-500/5", badge: "text-yellow-600 border-yellow-500/30 bg-yellow-500/5", label: "Medium" },
  info: { icon: Info, border: "border-blue-500/20 bg-blue-500/5", badge: "text-blue-500 border-blue-500/20 bg-blue-500/5", label: "Info" },
};

export default function PlantWarnings({ month }: { month: string }) {
  const { data, isLoading } = useGetPlantBundle(
    { month },
    { query: { queryKey: getGetPlantBundleQueryKey({ month }) } }
  );

  if (isLoading) return <div className="flex items-center justify-center h-64 text-muted-foreground">Loading...</div>;
  if (!data) return <div className="text-red-500 p-4">Failed to load plant data.</div>;
  const bundle = data as unknown as PlantBundle;

  const { warnings } = bundle;

  const bySeverity = {
    critical: warnings.filter((w) => w.severity === "critical"),
    high: warnings.filter((w) => w.severity === "high"),
    medium: warnings.filter((w) => w.severity === "medium"),
    info: warnings.filter((w) => w.severity === "info"),
  };

  return (
    <div className="space-y-6 max-w-[1200px] mx-auto pb-10">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight mb-1">Plant Warnings</h1>
        <p className="text-muted-foreground text-sm">
          {warnings.length} warning{warnings.length !== 1 ? "s" : ""} for {month}
          {bySeverity.critical.length > 0 && <span className="ml-2 text-red-500 font-medium">{bySeverity.critical.length} critical</span>}
          {bySeverity.high.length > 0 && <span className="ml-2 text-amber-500 font-medium">{bySeverity.high.length} high</span>}
        </p>
      </header>

      {warnings.length === 0 && (
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="pt-6 flex items-center gap-3 text-emerald-600">
            <CheckCircle2 className="h-5 w-5" />
            <div>
              <div className="font-medium">No warnings — all KPIs within thresholds</div>
              <div className="text-sm text-muted-foreground mt-0.5">Production is on track for {month}.</div>
            </div>
          </CardContent>
        </Card>
      )}

      {(["critical", "high", "medium", "info"] as const).map((sev) => {
        const group = bySeverity[sev];
        if (group.length === 0) return null;
        const cfg = SEV_CONFIG[sev];
        const Icon = cfg.icon;
        return (
          <div key={sev}>
            <div className="flex items-center gap-2 mb-3">
              <Icon className={`h-4 w-4 ${sev === "critical" ? "text-red-500" : sev === "high" ? "text-amber-500" : sev === "medium" ? "text-yellow-500" : "text-blue-400"}`} />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{cfg.label} ({group.length})</h2>
            </div>
            <div className="space-y-3">
              {group.map((w, i) => (
                <Card key={i} className={`border ${cfg.border}`}>
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1.5">
                          <Badge variant="outline" className={`text-xs font-mono ${cfg.badge}`}>{w.code}</Badge>
                          <Badge variant="outline" className="text-xs text-muted-foreground">{w.scope}</Badge>
                          <Badge variant="outline" className="text-xs text-muted-foreground">{w.source}</Badge>
                        </div>
                        <p className="text-sm font-medium">{w.message}</p>
                        {w.value !== null && w.threshold !== null && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Value: <span className="font-mono">{w.value}</span> · Threshold: <span className="font-mono">{w.threshold}</span>
                          </p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        );
      })}

      {/* Needs review */}
      {bundle.needsReview.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Items Needing Review</CardTitle>
            <CardDescription>These produced items have no matching plan entry — excluded from category attainment totals</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {bundle.needsReview.map((i, idx) => (
                <Badge key={idx} variant="outline" className="text-xs text-muted-foreground">
                  {i.itemCode}{i.colour ? `/${i.colour}` : ""}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

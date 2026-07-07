import { useGetPlantBundle, getGetPlantBundleQueryKey, type PlantBundle } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckSquare, Clock } from "lucide-react";

const EFFORT_CONFIG = {
  low: { label: "Low effort", className: "text-emerald-600 border-emerald-500/30 bg-emerald-500/5" },
  med: { label: "Medium effort", className: "text-amber-600 border-amber-500/30 bg-amber-500/5" },
  high: { label: "High effort", className: "text-red-600 border-red-500/30 bg-red-500/5" },
};

const CODE_ICONS: Record<string, string> = {
  OVERTIME: "⏰",
  REALLOCATE_CAPACITY: "🔄",
  RESEQUENCE: "📋",
  VITAL_FEW: "🎯",
  PROTECT_FLOOR: "🛡️",
  INFEASIBLE_RECOVERY: "🚨",
};

export default function PlantActions({ month }: { month: string }) {
  const { data, isLoading } = useGetPlantBundle(
    { month },
    { query: { queryKey: getGetPlantBundleQueryKey({ month }) } }
  );

  if (isLoading) return <div className="flex items-center justify-center h-64 text-muted-foreground">Loading...</div>;
  if (!data) return <div className="text-red-500 p-4">Failed to load plant data.</div>;
  const bundle = data as unknown as PlantBundle;

  const { recommendations } = bundle;

  return (
    <div className="space-y-6 max-w-[1200px] mx-auto pb-10">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight mb-1 flex items-center gap-2">
          <CheckSquare className="h-7 w-7 text-primary" /> Recommended Actions
        </h1>
        <p className="text-muted-foreground text-sm">
          Prioritised recovery actions for {month} — {recommendations.length} recommendation{recommendations.length !== 1 ? "s" : ""}
        </p>
      </header>

      {recommendations.length === 0 && (
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="pt-6 text-emerald-600 text-sm">
            No corrective actions needed — plant is on track.
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {recommendations.map((rec) => {
          const effort = EFFORT_CONFIG[rec.effort] ?? EFFORT_CONFIG.med;
          const icon = CODE_ICONS[rec.code] ?? "•";
          return (
            <Card key={rec.priority} className="border-border/60">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm">
                    {rec.priority}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="text-lg">{icon}</span>
                      <h3 className="font-semibold text-base">{rec.action}</h3>
                      <Badge variant="outline" className="text-xs text-muted-foreground">{rec.scope}</Badge>
                      <Badge variant="outline" className={`text-xs ${effort.className}`}>{effort.label}</Badge>
                      <Badge variant="outline" className="text-xs font-mono text-muted-foreground">{rec.code}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">{rec.rationale}</p>
                    <div className="flex items-center gap-2 text-xs text-emerald-600">
                      <Clock className="h-3 w-3" />
                      <span>Impact: {rec.quantifiedImpact}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Summary table */}
      {recommendations.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Summary Matrix</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 text-muted-foreground">
                  <th className="text-left py-2 pr-4 font-medium">#</th>
                  <th className="text-left py-2 pr-4 font-medium">Code</th>
                  <th className="text-left py-2 pr-4 font-medium">Scope</th>
                  <th className="text-left py-2 pr-4 font-medium">Action</th>
                  <th className="text-left py-2 font-medium">Effort</th>
                </tr>
              </thead>
              <tbody>
                {recommendations.map((rec) => {
                  const effort = EFFORT_CONFIG[rec.effort] ?? EFFORT_CONFIG.med;
                  return (
                    <tr key={rec.priority} className="border-b border-border/20 hover:bg-muted/20">
                      <td className="py-1.5 pr-4">{rec.priority}</td>
                      <td className="py-1.5 pr-4 font-mono text-xs">{rec.code}</td>
                      <td className="py-1.5 pr-4 text-muted-foreground text-xs">{rec.scope}</td>
                      <td className="py-1.5 pr-4">{rec.action}</td>
                      <td className="py-1.5">
                        <Badge variant="outline" className={`text-xs ${effort.className}`}>{rec.effort}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

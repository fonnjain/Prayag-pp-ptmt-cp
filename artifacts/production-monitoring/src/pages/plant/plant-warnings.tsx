import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetPlantBundle, getGetPlantBundleQueryKey, useGetPlantConfig, getGetPlantConfigQueryKey, usePatchPlantConfig, type PlantBundle, type PlantConfigData } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, AlertCircle, Info, CheckCircle2, ChevronDown, ChevronUp, Settings2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const SEV_CONFIG = {
  critical: { icon: AlertCircle, border: "border-red-500/40 bg-red-500/5", badge: "text-red-600 border-red-500/30 bg-red-500/5", label: "Critical" },
  high: { icon: AlertTriangle, border: "border-amber-500/40 bg-amber-500/5", badge: "text-amber-600 border-amber-500/30 bg-amber-500/5", label: "High" },
  medium: { icon: AlertTriangle, border: "border-yellow-500/40 bg-yellow-500/5", badge: "text-yellow-600 border-yellow-500/30 bg-yellow-500/5", label: "Medium" },
  info: { icon: Info, border: "border-blue-500/20 bg-blue-500/5", badge: "text-blue-500 border-blue-500/20 bg-blue-500/5", label: "Info" },
};

const THRESHOLD_LABELS: Record<string, { label: string; unit: string; description: string }> = {
  behindPaceHigh: { label: "Behind Pace — High", unit: "%", description: "Cum. attainment below this triggers a HIGH warning" },
  behindPaceCritical: { label: "Behind Pace — Critical", unit: "%", description: "Cum. attainment below this triggers a CRITICAL warning" },
  willMissPpGapMedium: { label: "Will Miss PP — Medium gap", unit: "pcs", description: "Projected shortfall above this triggers MEDIUM" },
  willMissPpGapHigh: { label: "Will Miss PP — High gap", unit: "pcs", description: "Projected shortfall above this triggers HIGH" },
  willMissPpGapCritical: { label: "Will Miss PP — Critical gap", unit: "pcs", description: "Projected shortfall above this triggers CRITICAL" },
  catchupInfeasibleRatio: { label: "Catch-up Infeasible Ratio", unit: "×", description: "Catch-up rate / required rate above this is deemed infeasible" },
  categoryLaggingGap: { label: "Category Lagging Gap", unit: "%", description: "Category attainment gap % below this triggers a lagging warning" },
  backloadingIndex: { label: "Backloading Index", unit: "", description: "Linearity index below this threshold triggers a backloading warning" },
  noProductionDays: { label: "No Production Days", unit: "days", description: "Item with zero output for this many days triggers a warning" },
};

interface PlantThresholds {
  behindPaceHigh?: number;
  behindPaceCritical?: number;
  willMissPpGapMedium?: number;
  willMissPpGapHigh?: number;
  willMissPpGapCritical?: number;
  catchupInfeasibleRatio?: number;
  categoryLaggingGap?: number;
  backloadingIndex?: number;
  noProductionDays?: number;
}

export default function PlantWarnings({ month }: { month: string }) {
  const { data, isLoading } = useGetPlantBundle(
    { month },
    { query: { queryKey: getGetPlantBundleQueryKey({ month }) } }
  );
  const { data: configData } = useGetPlantConfig(
    { month },
    { query: { queryKey: getGetPlantConfigQueryKey({ month }) } }
  );
  const { mutateAsync: patchConfig, isPending: isSaving } = usePatchPlantConfig();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [thresholdOpen, setThresholdOpen] = useState(false);
  const [localThresholds, setLocalThresholds] = useState<PlantThresholds | null>(null);

  if (isLoading) return <div className="flex items-center justify-center h-64 text-muted-foreground">Loading...</div>;
  if (!data) return <div className="text-red-500 p-4">Failed to load plant data.</div>;
  const bundle = data as unknown as PlantBundle;
  const cfg = configData as unknown as PlantConfigData & { thresholds?: PlantThresholds };

  const activeThresholds: PlantThresholds = localThresholds ?? (cfg?.thresholds as PlantThresholds | undefined) ?? {};

  const { warnings } = bundle;

  const bySeverity = {
    critical: warnings.filter((w) => w.severity === "critical"),
    high: warnings.filter((w) => w.severity === "high"),
    medium: warnings.filter((w) => w.severity === "medium"),
    info: warnings.filter((w) => w.severity === "info"),
  };

  function handleThresholdChange(key: string, value: string) {
    const parsed = parseFloat(value);
    setLocalThresholds((prev) => ({
      ...(prev ?? activeThresholds),
      [key]: isNaN(parsed) ? undefined : parsed,
    }));
  }

  async function handleSaveThresholds() {
    if (!localThresholds) return;
    try {
      await patchConfig({ data: { month, thresholds: localThresholds as Record<string, unknown> } });
      await queryClient.invalidateQueries({ queryKey: getGetPlantBundleQueryKey({ month }) });
      await queryClient.invalidateQueries({ queryKey: getGetPlantConfigQueryKey({ month }) });
      toast({ title: "Thresholds saved", description: "Warning thresholds updated for " + month });
      setLocalThresholds(null);
    } catch {
      toast({ title: "Save failed", description: "Could not save thresholds", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-6 max-w-[1200px] mx-auto pb-10">
      <header className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight mb-1">Plant Warnings</h1>
            <p className="text-muted-foreground text-sm">
              {warnings.length} warning{warnings.length !== 1 ? "s" : ""} for {month}
              {bySeverity.critical.length > 0 && <span className="ml-2 text-red-500 font-medium">{bySeverity.critical.length} critical</span>}
              {bySeverity.high.length > 0 && <span className="ml-2 text-amber-500 font-medium">{bySeverity.high.length} high</span>}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setThresholdOpen((v) => !v)}>
            <Settings2 className="h-4 w-4 mr-2" />
            Thresholds {thresholdOpen ? <ChevronUp className="ml-1 h-3 w-3" /> : <ChevronDown className="ml-1 h-3 w-3" />}
          </Button>
        </div>
      </header>

      {/* Inline threshold editor */}
      {thresholdOpen && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2"><Settings2 className="h-4 w-4" /> Warning Thresholds</CardTitle>
            <CardDescription>Adjust when each warning fires — changes apply to this month only</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Object.entries(THRESHOLD_LABELS).map(([key, meta]) => {
                const currentVal = (activeThresholds as Record<string, number | undefined>)[key];
                return (
                  <div key={key} className="space-y-1.5">
                    <Label htmlFor={`threshold-${key}`} className="text-xs font-medium">{meta.label}</Label>
                    <div className="flex items-center gap-1.5">
                      <Input
                        id={`threshold-${key}`}
                        type="number"
                        step="any"
                        value={currentVal !== undefined ? currentVal : ""}
                        onChange={(e) => handleThresholdChange(key, e.target.value)}
                        className="h-8 text-xs font-mono w-28"
                        placeholder="default"
                      />
                      {meta.unit && <span className="text-xs text-muted-foreground">{meta.unit}</span>}
                    </div>
                    <p className="text-xs text-muted-foreground leading-tight">{meta.description}</p>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-2 mt-4">
              <Button size="sm" onClick={handleSaveThresholds} disabled={isSaving || !localThresholds}>
                {isSaving ? "Saving…" : "Save Thresholds"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setLocalThresholds(null)} disabled={!localThresholds}>
                Reset
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

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
        const cfg2 = SEV_CONFIG[sev];
        const Icon = cfg2.icon;
        return (
          <div key={sev}>
            <div className="flex items-center gap-2 mb-3">
              <Icon className={`h-4 w-4 ${sev === "critical" ? "text-red-500" : sev === "high" ? "text-amber-500" : sev === "medium" ? "text-yellow-500" : "text-blue-400"}`} />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{cfg2.label} ({group.length})</h2>
            </div>
            <div className="space-y-3">
              {group.map((w, i) => (
                <Card key={i} className={`border ${cfg2.border}`}>
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1.5">
                          <Badge variant="outline" className={`text-xs font-mono ${cfg2.badge}`}>{w.code}</Badge>
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

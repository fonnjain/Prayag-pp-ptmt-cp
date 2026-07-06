import { useGetMonitoringDashboard, getGetMonitoringDashboardQueryKey, type MonitoringDashboard } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Calendar as CalendarIcon, Activity } from "lucide-react";

function RagBadge({ band }: { band: "green" | "amber" | "red" | null }) {
  if (!band) return <Badge variant="outline" className="text-muted-foreground border-muted">N/A</Badge>;
  const colors = {
    green: "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 border-emerald-500/20",
    amber: "bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 border-amber-500/20",
    red: "bg-red-500/10 text-red-500 hover:bg-red-500/20 border-red-500/20",
  };
  return <Badge variant="outline" className={colors[band]}>{band.toUpperCase()}</Badge>;
}

export default function Dashboard({ month }: { month: string }) {
  const { data: dashboard, isLoading } = useGetMonitoringDashboard(
    { month },
    { query: { queryKey: getGetMonitoringDashboardQueryKey({ month }) } }
  );

  if (isLoading) {
    return <div className="animate-pulse space-y-4">
      <div className="h-32 bg-muted/50 rounded-lg"></div>
      <div className="grid grid-cols-3 gap-4"><div className="h-40 bg-muted/50 rounded-lg"></div></div>
    </div>;
  }

  if (!dashboard) return null;

  const data = dashboard as unknown as MonitoringDashboard;

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Plant Dashboard</h1>
        <p className="text-muted-foreground flex items-center gap-2">
          <CalendarIcon className="h-4 w-4" />
          Data as of {data.lastDataDate ? new Date(data.lastDataDate).toLocaleDateString() : "No data"}
        </p>
      </header>

      {!data.dataAvailable && (
        <div className="bg-amber-500/10 border border-amber-500/20 text-amber-600 p-4 rounded-lg flex items-start gap-3">
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-medium">No Report-5 Data Available</h3>
            <p className="text-sm opacity-90 mt-1">
              Production data for this month hasn't been synced yet, or no shifts have been recorded.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="border-border/50 shadow-sm md:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Plant Pace & Attainment</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end justify-between mb-6">
              <div>
                <div className="text-4xl font-bold tracking-tighter flex items-center gap-3">
                  {data.plant?.attainmentPct != null ? `${data.plant.attainmentPct.toFixed(1)}%` : "--"}
                  <RagBadge band={data.plant?.ragBand ?? null} />
                </div>
                <div className="text-sm text-muted-foreground mt-1">Current Attainment</div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold tracking-tight">
                  {data.plant?.targetKg != null ? (data.plant.targetKg / 1000).toFixed(1) + "t" : "--"}
                </div>
                <div className="text-sm text-muted-foreground mt-1">Monthly Target</div>
              </div>
            </div>
            
            <div className="grid grid-cols-3 gap-4 pt-4 border-t border-border/50">
              <div>
                <div className="text-sm text-muted-foreground mb-1">Required / Day</div>
                <div className="font-mono">{data.plant?.requiredPerDay != null ? data.plant.requiredPerDay.toFixed(0) : "--"} kg</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground mb-1">Actual / Day</div>
                <div className="font-mono">{data.plant?.actualPerDay != null ? data.plant.actualPerDay.toFixed(0) : "--"} kg</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground mb-1">Days Ahead/Behind</div>
                <div className={`font-mono ${data.plant?.daysAheadBehind && data.plant.daysAheadBehind < 0 ? 'text-red-500' : ''}`}>
                  {data.plant?.daysAheadBehind != null ? data.plant.daysAheadBehind.toFixed(1) : "--"}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border-border/50 shadow-sm bg-primary/5 border-primary/10">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-2">
                <Activity className="h-5 w-5 text-primary" />
                <h3 className="font-medium text-primary">Utilisation</h3>
              </div>
              <p className="text-2xl font-bold tracking-tight">{data.utilisationHeadline || "--"}</p>
            </CardContent>
          </Card>

          <Card className="border-border/50 shadow-sm bg-destructive/5 border-destructive/10">
            <CardContent className="p-6 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <AlertCircle className="h-4 w-4 text-destructive" />
                  <h3 className="font-medium text-destructive">Active Warnings</h3>
                </div>
                <p className="text-sm text-destructive/80">Requires attention</p>
              </div>
              <div className="text-3xl font-bold text-destructive">{data.warningCount ?? 0}</div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="border-border/50 shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Category Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {data.categories?.map((cat: any) => (
                <div key={cat.category} className="flex items-center justify-between p-3 rounded-md bg-muted/30">
                  <div className="font-medium">{cat.category}</div>
                  <div className="flex items-center gap-4">
                    <div className="text-right text-sm">
                      <div className="text-muted-foreground">Req/Day</div>
                      <div className="font-mono">{cat.requiredPerDay != null ? cat.requiredPerDay.toFixed(0) : "--"} kg</div>
                    </div>
                    <RagBadge band={cat.ragBand} />
                  </div>
                </div>
              ))}
              {(!data.categories || data.categories.length === 0) && (
                <div className="text-sm text-muted-foreground text-center py-4">No category data</div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Needs Review</CardTitle>
            <Badge variant="secondary">{data.needsReviewItems?.length || 0} items</Badge>
          </CardHeader>
          <CardContent>
            {data.needsReviewItems && data.needsReviewItems.length > 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground mb-4">The following items are missing weights. Target Kg calculations cannot be completed.</p>
                <div className="max-h-[300px] overflow-y-auto pr-2 space-y-2">
                  {data.needsReviewItems.map((item: any, i: number) => (
                    <div key={i} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0 text-sm">
                      <div>
                        <span className="font-medium">{item.itemCode}</span>
                        <span className="text-muted-foreground ml-2">{item.colour}</span>
                      </div>
                      <Badge variant="outline" className="text-xs font-normal">{item.category}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground text-center py-8 flex flex-col items-center">
                <CheckCircle className="h-8 w-8 text-emerald-500 mb-2 opacity-50" />
                All items have configured weights.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function CheckCircle(props: any) {
  return <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>;
}

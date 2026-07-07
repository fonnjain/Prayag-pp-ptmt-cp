import { useGetMonitoringWarnings, getGetMonitoringWarningsQueryKey, type MonitoringWarnings } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, Info, AlertCircle, XOctagon, FileSpreadsheet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { exportXlsx } from "@/lib/excel";

const severityConfig: Record<string, { icon: any, color: string, bg: string, label: string }> = {
  info: { icon: Info, color: "text-blue-500", bg: "bg-blue-500/10 border-blue-500/20", label: "Info" },
  medium: { icon: AlertCircle, color: "text-amber-500", bg: "bg-amber-500/10 border-amber-500/20", label: "Medium" },
  high: { icon: AlertTriangle, color: "text-orange-500", bg: "bg-orange-500/10 border-orange-500/20", label: "High" },
  critical: { icon: XOctagon, color: "text-red-500", bg: "bg-red-500/10 border-red-500/20", label: "Critical" }
};

export default function Warnings({ month }: { month: string }) {
  const { data: monitoring, isLoading } = useGetMonitoringWarnings(
    { month },
    { query: { queryKey: getGetMonitoringWarningsQueryKey({ month }) } }
  );

  if (isLoading) return <div className="p-8 animate-pulse text-muted-foreground">Loading warnings...</div>;
  
  const warnings = (monitoring as unknown as MonitoringWarnings | undefined)?.warnings || [];

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">Active Warnings</h1>
          <p className="text-muted-foreground">Issues detected for {month}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => exportXlsx(`warnings-${month}`, [
            { name: "Warnings", rows: warnings.map((w: any) => ({ Severity: w.severity, Code: w.code, Scope: w.scope, Message: w.message, Value: w.value, Threshold: w.threshold, Source: w.source })) },
          ])}>
            <FileSpreadsheet className="h-4 w-4 mr-2" /> Export Excel
          </Button>
          <Badge variant="outline" className="text-lg px-4 py-1">{warnings.length} Total</Badge>
        </div>
      </header>

      {warnings.length === 0 ? (
        <div className="text-center py-16 border border-dashed rounded-lg text-muted-foreground">
          <Info className="h-8 w-8 mx-auto mb-3 opacity-50" />
          <p>No active warnings for this month.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {warnings.map((warning: any, i: number) => {
            const config = severityConfig[warning.severity] || severityConfig.info;
            const Icon = config.icon;
            return (
              <Card key={i} className={`border ${config.bg} shadow-none`}>
                <CardContent className="p-4 flex gap-4 items-start">
                  <div className={`mt-0.5 ${config.color}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`font-semibold text-sm uppercase tracking-wider ${config.color}`}>
                        {warning.code.replace(/_/g, ' ')}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-background/50 border">
                        {warning.scope}
                      </span>
                    </div>
                    <p className="text-foreground/90 font-medium">{warning.message}</p>
                    <div className="mt-3 flex items-center gap-4 text-sm font-mono text-muted-foreground">
                      {warning.value != null && <span>Value: {warning.value.toFixed(1)}</span>}
                      {warning.threshold != null && <span>Threshold: {warning.threshold.toFixed(1)}</span>}
                      {warning.source && <span>Source: {warning.source}</span>}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

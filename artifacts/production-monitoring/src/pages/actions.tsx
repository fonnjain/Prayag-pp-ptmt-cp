import { useGetMonitoringActions, getGetMonitoringActionsQueryKey, type MonitoringActions } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckSquare, ArrowRightCircle } from "lucide-react";

export default function Actions({ month }: { month: string }) {
  const { data: monitoring, isLoading } = useGetMonitoringActions(
    { month },
    { query: { queryKey: getGetMonitoringActionsQueryKey({ month }) } }
  );

  if (isLoading) return <div className="p-8 animate-pulse text-muted-foreground">Loading actions...</div>;
  
  const actions = (monitoring as unknown as MonitoringActions | undefined)?.actions || [];

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">Recommended Actions</h1>
          <p className="text-muted-foreground">Prioritized operational recommendations for {month}</p>
        </div>
        <Badge variant="outline" className="text-lg px-4 py-1">{actions.length} Actions</Badge>
      </header>

      {actions.length === 0 ? (
        <div className="text-center py-16 border border-dashed rounded-lg text-muted-foreground">
          <CheckSquare className="h-8 w-8 mx-auto mb-3 opacity-50" />
          <p>No recommended actions for this month. You're all caught up.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {actions.map((action: any, i: number) => (
            <Card key={i} className="border-l-4 border-l-primary shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-5 flex gap-4 items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <Badge variant={action.priority === 1 ? "default" : "secondary"}>
                      Priority {action.priority}
                    </Badge>
                    <span className="font-semibold text-sm uppercase tracking-wider text-primary">
                      {action.code.replace(/_/g, ' ')}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted border">
                      {action.scope}
                    </span>
                  </div>
                  <p className="text-foreground/90 font-medium text-lg leading-relaxed">{action.message}</p>
                  {action.suggestedQty != null && (
                    <div className="mt-3 inline-flex items-center gap-2 text-sm font-mono bg-primary/10 text-primary px-3 py-1 rounded-md">
                      <ArrowRightCircle className="h-4 w-4" />
                      Suggested Quantity: {action.suggestedQty.toLocaleString()}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

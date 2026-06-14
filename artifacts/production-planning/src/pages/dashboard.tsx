import { useData } from "@/lib/data-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, XCircle, Activity, BarChart3, AlertOctagon } from "lucide-react";
import { CategorySummary } from "@/lib/types";

function RAGBadge({ status }: { status: CategorySummary["rag"] }) {
  switch (status) {
    case "green":
      return <Badge className="bg-green-500/10 text-green-700 hover:bg-green-500/20 border-green-200">On Track</Badge>;
    case "amber":
      return <Badge className="bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 border-amber-200">At Risk</Badge>;
    case "red":
      return <Badge variant="destructive" className="bg-red-500/10 text-red-700 hover:bg-red-500/20 border-red-200">Critical</Badge>;
  }
}

export default function Dashboard() {
  const { division, planMonth, categorySummaries, planLines, sanityResult } = useData();

  const urgentCount = planLines.filter(l => l.urgent).length;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Overview for {division} • {planMonth}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Urgent Items</CardTitle>
            <AlertTriangle className={`h-4 w-4 ${urgentCount > 0 ? 'text-destructive' : 'text-muted-foreground'}`} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{urgentCount}</div>
            <p className="text-xs text-muted-foreground">Require immediate attention</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Data Health</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              {sanityResult?.verdict === 'ok' && <CheckCircle2 className="h-5 w-5 text-green-500" />}
              {sanityResult?.verdict === 'warn' && <AlertTriangle className="h-5 w-5 text-amber-500" />}
              {sanityResult?.verdict === 'block' && <XCircle className="h-5 w-5 text-destructive" />}
              <span className="text-2xl font-bold capitalize">{sanityResult?.verdict || "Unknown"}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1 truncate">{sanityResult?.summary || "No recent data pull"}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Categories</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{categorySummaries.length}</div>
            <p className="text-xs text-muted-foreground">Tracked this month</p>
          </CardContent>
        </Card>
      </div>

      <h2 className="text-xl font-semibold mt-8 mb-4">Category Performance</h2>
      <div className="grid grid-cols-1 gap-4">
        {categorySummaries.map(cat => (
          <Card key={cat.category} className="overflow-hidden">
            <div className="flex flex-col md:flex-row md:items-center justify-between p-4 md:p-6 gap-4">
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-lg">{cat.category}</h3>
                  <RAGBadge status={cat.rag} />
                </div>
                <div className="text-sm text-muted-foreground flex gap-4">
                  <span>Target: {cat.targetMin.toLocaleString()} - {cat.targetMax.toLocaleString()}</span>
                  <span>Per Day: {cat.perDayTarget.toLocaleString()}</span>
                </div>
              </div>
              
              <div className="flex-1 max-w-md w-full">
                <div className="flex justify-between text-sm mb-1">
                  <span>Produced: {cat.produced.toLocaleString()}</span>
                  <span className="font-medium">{cat.achievementPct}%</span>
                </div>
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <div 
                    className={`h-full rounded-full transition-all ${cat.rag === 'red' ? 'bg-destructive' : cat.rag === 'amber' ? 'bg-amber-500' : 'bg-green-500'}`} 
                    style={{ width: `${Math.min(cat.achievementPct, 100)}%` }} 
                  />
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

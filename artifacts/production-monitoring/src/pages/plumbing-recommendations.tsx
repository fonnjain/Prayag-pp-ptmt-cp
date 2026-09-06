import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, ListChecks, AlertTriangle, CheckCircle2, TrendingUp } from "lucide-react";
import { Link } from "wouter";
import { MonitoringSourceBanner } from "@/components/monitoring-source-banner";

export default function PlumbingRecommendations({ month }: { month: string }) {
  const [data, setData]       = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    try {
      setRefreshing(true);
      setError(null);
      const res = await fetch(`/api/monitoring/dashboard?month=${month}&segment=Plumbing`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => { load(); }, [month]);

  if (loading) return (
    <div className="space-y-4 animate-pulse">
      <div className="h-24 bg-muted/40 rounded-xl" />
      <div className="h-48 bg-muted/40 rounded-xl" />
    </div>
  );

  if (error) return (
    <div className="space-y-4 max-w-[1000px] mx-auto pb-10">
      <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
        <ListChecks className="h-6 w-6 text-primary" /> Plumbing Recommendations
      </h1>
      <div className="text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 space-y-1">
        <p className="font-semibold text-red-600">Failed to load monitoring data</p>
        <p className="text-red-600/80">{error} — <code className="font-mono">GET /api/monitoring/dashboard?month={month}&amp;segment=Plumbing</code></p>
      </div>
      <Button size="sm" variant="outline" onClick={load} className="gap-2">
        <RefreshCw className="h-3.5 w-3.5" /> Retry
      </Button>
    </div>
  );

  const cats: any[] = data?.categories ?? [];
  const sourceBanner = (
    <MonitoringSourceBanner
      warning={data?.sourceWarning}
      sourceMonth={data?.sourceMonth}
      requestedMonth={month}
    />
  );
  // API returns { plant: { produced, mapped, unmapped, runRatePerDay }, categories, weeks }
  // cumPct must use mappedActual (summed from categories) for both numerator and denominator —
  // plant.produced = mapped + unmapped and would inflate the ratio by the unmapped quantity.
  const mappedActual  = cats.reduce((s: number, c: any) => s + (c.totalActual  ?? 0), 0);
  const totalRelease  = cats.reduce((s: number, c: any) => s + (c.totalRelease ?? 0), 0);
  const cumPct        = totalRelease > 0 ? (mappedActual / totalRelease) * 100 : null;
  const notStarted: string[]  = data?.notStartedCategories
    ?? cats.filter((c: any) => c.notStarted).map((c: any) => c.category);
  const unmappedCodes: number = data?.unmappedCodes ?? data?.plant?.unmapped ?? 0;

  // Derive simple actionable recommendations from monitoring data
  const recs: { priority: "high" | "medium" | "low"; title: string; detail: string }[] = [];

  if (notStarted.length > 0) {
    recs.push({
      priority: "high",
      title: `${notStarted.length} categor${notStarted.length > 1 ? "ies" : "y"} not yet started`,
      detail: `${notStarted.join(", ")} — zero production recorded this month. Escalate with production team.`,
    });
  }

  cats.forEach((c: any) => {
    const att = c.totalRelease > 0 ? (c.totalActual / c.totalRelease) * 100 : null;
    if (att != null && att < 50 && c.totalRelease > 0) {
      recs.push({
        priority: att < 25 ? "high" : "medium",
        title: `${c.category} — attainment critically low (${att.toFixed(1)}%)`,
        detail: `Released ${Math.round(c.totalRelease).toLocaleString("en-IN")} pcs, produced only ${Math.round(c.totalActual).toLocaleString("en-IN")} pcs. Review machine allocation.`,
      });
    }
  });

  if (unmappedCodes > 0) {
    recs.push({
      priority: "medium",
      title: `${unmappedCodes.toLocaleString("en-IN")} unmapped production codes`,
      detail: "Production recorded against codes not in the plan master. Update BOM or item master to capture this output.",
    });
  }

  if (cumPct != null && cumPct >= 85) {
    recs.push({
      priority: "low",
      title: "Cumulative attainment on track",
      detail: `Overall attainment is ${cumPct.toFixed(1)}% — no immediate corrective action required.`,
    });
  }

  const sortOrder = { high: 0, medium: 1, low: 2 };
  recs.sort((a, b) => sortOrder[a.priority] - sortOrder[b.priority]);

  const priorityStyle = {
    high:   { badge: "bg-red-500/10 text-red-600 border-red-500/30",   icon: <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" /> },
    medium: { badge: "bg-amber-500/10 text-amber-700 border-amber-500/30", icon: <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" /> },
    low:    { badge: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30", icon: <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" /> },
  };

  return (
    <div className="space-y-6 max-w-[1000px] mx-auto pb-10">
      {sourceBanner}
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2 mb-1">
            <ListChecks className="h-6 w-6 text-primary" /> Plumbing Recommendations
          </h1>
          <p className="text-muted-foreground text-sm">
            Actionable insights from monitoring data · {month}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={load} disabled={refreshing} className="gap-2">
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
          <Link href="/plumbing">
            <Button size="sm" className="gap-2">
              <TrendingUp className="h-3.5 w-3.5" /> View Corrective Plan
            </Button>
          </Link>
        </div>
      </header>

      {recs.length === 0 ? (
        <Card>
          <CardContent className="py-12 flex flex-col items-center gap-3 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-500" />
            <p className="text-lg font-medium">No immediate actions required</p>
            <p className="text-sm text-muted-foreground">Plumbing production looks on track for {month}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{recs.length} Recommendation{recs.length > 1 ? "s" : ""}</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border/40 p-0">
            {recs.map((rec, i) => (
              <div key={i} className="flex gap-3 px-6 py-4">
                {priorityStyle[rec.priority].icon}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-snug">{rec.title}</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{rec.detail}</p>
                </div>
                <div className="shrink-0">
                  <Badge variant="outline" className={`text-xs ${priorityStyle[rec.priority].badge}`}>
                    {rec.priority.charAt(0).toUpperCase() + rec.priority.slice(1)}
                  </Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

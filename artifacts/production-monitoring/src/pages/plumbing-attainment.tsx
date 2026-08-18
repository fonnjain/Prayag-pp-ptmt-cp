import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, Layers, TrendingUp, TrendingDown } from "lucide-react";

const CATEGORY_ORDER = [
  "CPVC Pipe", "CPVC Fitting", "CPVC Solvent",
  "UPVC Pipe", "UPVC Fitting", "UPVC Solvent",
  "SWR Pipe",  "SWR Fitting",  "SWR Solvent",
  "AGRI Pipe", "AGRI Fitting", "AGRI Solvent",
];

function fmtN(n: number | null | undefined) {
  if (n == null) return "–";
  return Math.round(n).toLocaleString("en-IN");
}
function fmtPct(n: number | null | undefined) {
  if (n == null) return "–";
  return `${n.toFixed(1)}%`;
}

export default function PlumbingAttainment({ month }: { month: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    try {
      setRefreshing(true);
      const res = await fetch(`/api/monitoring/dashboard?month=${month}&segment=Plumbing`);
      if (!res.ok) throw new Error(`${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, [month]);

  if (loading) return (
    <div className="space-y-4 animate-pulse">
      <div className="h-24 bg-muted/40 rounded-xl" />
      <div className="h-64 bg-muted/40 rounded-xl" />
    </div>
  );

  const cats: any[] = data?.categories ?? [];
  // API returns { plant: { produced, mapped, unmapped }, categories: [...], weeks: [...] }
  // totalRelease and mappedActual must share the same population (categories = mapped items only).
  // plant.produced = mapped + unmapped; using it in the ratio inflates attainment by the unmapped
  // quantity and makes the metric improve as data quality worsens — wrong direction.
  const totalRelease = cats.reduce((s: number, c: any) => s + (c.totalRelease ?? 0), 0);
  const mappedActual = cats.reduce((s: number, c: any) => s + (c.totalActual  ?? 0), 0);
  const attPct       = totalRelease > 0 ? (mappedActual / totalRelease) * 100 : null;
  // Sheet3 total (mapped + unmapped) — for the PRODUCED TO DATE card only, not the ratio.
  const totalActual  = data?.plant?.produced ?? mappedActual;
  const unmappedPcs  = data?.plant?.unmapped ?? 0;

  const ragColor = (pct: number | null) => {
    if (pct == null) return "text-muted-foreground";
    if (pct >= 85)  return "text-emerald-600";
    if (pct >= 60)  return "text-amber-600";
    return "text-red-500";
  };
  const ragBadge = (pct: number | null) => {
    if (pct == null) return <Badge variant="outline">–</Badge>;
    if (pct >= 85)  return <Badge className="bg-emerald-500/10 text-emerald-700 border-emerald-500/30">{fmtPct(pct)}</Badge>;
    if (pct >= 60)  return <Badge className="bg-amber-500/10  text-amber-700  border-amber-500/30">{fmtPct(pct)}</Badge>;
    return               <Badge className="bg-red-500/10    text-red-600    border-red-500/30">{fmtPct(pct)}</Badge>;
  };

  return (
    <div className="space-y-6 max-w-[1200px] mx-auto pb-10">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2 mb-1">
            <Layers className="h-6 w-6 text-primary" /> Plumbing Attainment
          </h1>
          <p className="text-muted-foreground text-sm">
            Sheet3 actuals vs weekly release plan · {month}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={refreshing} className="gap-2">
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </header>

      {error && (
        <div className="text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
          Failed to load monitoring data: {error}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-5">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Total Released</div>
            <div className="text-3xl font-bold">{fmtN(totalRelease)}</div>
            <div className="text-xs text-muted-foreground mt-1">pcs cumulative</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Produced to Date</div>
            <div className="text-3xl font-bold">{fmtN(totalActual)}</div>
            <div className="text-xs text-muted-foreground mt-1">pcs from Sheet3</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Cum. Attainment</div>
            <div className={`text-3xl font-bold ${ragColor(attPct)}`}>{fmtPct(attPct)}</div>
            <div className="text-xs text-muted-foreground mt-1">
              mapped actual ÷ released
              {unmappedPcs > 0 && (
                <span className="ml-2 text-amber-600 font-medium">{fmtN(unmappedPcs)} unmapped</span>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Categories</div>
            <div className="text-3xl font-bold">{cats.filter(c => c.totalRelease > 0).length}</div>
            <div className="text-xs text-muted-foreground mt-1">with release plan</div>
          </CardContent>
        </Card>
      </div>

      {/* Per-category attainment table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Category-Level Attainment</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 border-y border-border/50">
                <tr>
                  <th className="text-left py-2.5 px-4 font-medium text-muted-foreground">Category</th>
                  <th className="text-right py-2.5 px-3 font-medium text-muted-foreground">W1 Released</th>
                  <th className="text-right py-2.5 px-3 font-medium text-muted-foreground">W1 Actual</th>
                  <th className="text-right py-2.5 px-3 font-medium text-muted-foreground">W2 Released</th>
                  <th className="text-right py-2.5 px-3 font-medium text-muted-foreground">W2 Actual</th>
                  <th className="text-right py-2.5 px-3 font-medium text-muted-foreground">Total Released</th>
                  <th className="text-right py-2.5 px-3 font-medium text-muted-foreground">Total Actual</th>
                  <th className="text-right py-2.5 px-4 font-medium text-muted-foreground">Attainment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {CATEGORY_ORDER.map((catName) => {
                  const c = cats.find((r: any) => r.category === catName);
                  if (!c) return (
                    <tr key={catName} className="hover:bg-muted/20 text-muted-foreground/50">
                      <td className="py-2 px-4">{catName}</td>
                      <td colSpan={7} className="py-2 px-3 text-center text-xs">no data</td>
                    </tr>
                  );
                  const att = c.totalRelease > 0 ? (c.totalActual / c.totalRelease) * 100 : null;
                  return (
                    <tr key={catName} className="hover:bg-muted/20">
                      <td className="py-2 px-4 font-medium">{catName}</td>
                      <td className="py-2 px-3 text-right font-mono">{fmtN(c.w1Release)}</td>
                      <td className="py-2 px-3 text-right font-mono">{fmtN(c.w1Actual)}</td>
                      <td className="py-2 px-3 text-right font-mono">{fmtN(c.w2Release)}</td>
                      <td className="py-2 px-3 text-right font-mono">{fmtN(c.w2Actual)}</td>
                      <td className="py-2 px-3 text-right font-mono font-semibold">{fmtN(c.totalRelease)}</td>
                      <td className="py-2 px-3 text-right font-mono font-semibold">{fmtN(c.totalActual)}</td>
                      <td className="py-2 px-4 text-right">{ragBadge(att)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

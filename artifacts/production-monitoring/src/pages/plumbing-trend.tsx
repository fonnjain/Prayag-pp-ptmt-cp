import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw, BarChart2 } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend,
} from "recharts";
import { MonitoringSourceBanner } from "@/components/monitoring-source-banner";

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

export default function PlumbingTrend({ month }: { month: string }) {
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
      <div className="h-72 bg-muted/40 rounded-xl" />
    </div>
  );

  if (error) return (
    <div className="space-y-4 max-w-[1200px] mx-auto pb-10">
      <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
        <BarChart2 className="h-6 w-6 text-primary" /> Plumbing Trend
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
  // API returns { plant, categories, weeks } — no weeklyRows field; the array is data.weeks
  const weeklyRows: any[] = data?.weeks ?? [];

  // Week-over-week trend data
  const weekTrend = weeklyRows.map((r: any) => ({
    name: r.label ?? `W${r.week}`,
    Released: Math.round(r.release ?? 0),
    Actual: Math.round(r.actual ?? 0),
  }));

  // Category bar data — total produced vs released
  const catBar = CATEGORY_ORDER
    .map((name) => {
      const c = cats.find((r: any) => r.category === name);
      return {
        name: name.replace(" ", "\n"),
        Released: c ? Math.round(c.totalRelease ?? 0) : 0,
        Actual:   c ? Math.round(c.totalActual  ?? 0) : 0,
      };
    })
    .filter((r) => r.Released > 0 || r.Actual > 0);

  return (
    <div className="space-y-6 max-w-[1200px] mx-auto pb-10">
      {sourceBanner}
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2 mb-1">
            <BarChart2 className="h-6 w-6 text-primary" /> Plumbing Trend
          </h1>
          <p className="text-muted-foreground text-sm">
            Weekly and category production trends · {month}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={refreshing} className="gap-2">
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </header>

      {/* Week-over-week chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Weekly Released vs Actual</CardTitle>
        </CardHeader>
        <CardContent>
          {weekTrend.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No weekly data available for {month}</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={weekTrend} margin={{ top: 8, right: 24, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={(v) => v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => v.toLocaleString("en-IN")} />
                <Legend />
                <Line type="monotone" dataKey="Released" stroke="hsl(var(--primary))" strokeWidth={2} dot />
                <Line type="monotone" dataKey="Actual"   stroke="#10b981"              strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Category bar chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Category — Released vs Actual (month to date)</CardTitle>
        </CardHeader>
        <CardContent>
          {catBar.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No category data available for {month}</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={catBar} margin={{ top: 8, right: 24, bottom: 40, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" interval={0} />
                <YAxis tickFormatter={(v) => v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => v.toLocaleString("en-IN")} />
                <Legend verticalAlign="top" />
                <Bar dataKey="Released" fill="hsl(var(--primary))" opacity={0.6} radius={[3, 3, 0, 0]} />
                <Bar dataKey="Actual"   fill="#10b981"             radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, CheckSquare, Database, FileCog, PackageMinus, RefreshCw, Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Mode = "actions" | "backlog" | "ai" | "settings";

interface PlumbingCategory {
  category: string;
  totalRelease: number;
  totalActual: number;
  notStarted?: boolean;
}

interface PlumbingDashboard {
  month: string;
  lastDataDate: string | null;
  dataAvailable: boolean;
  plant?: { produced?: number; mapped?: number; unmapped?: number; runRatePerDay?: number };
  categories?: PlumbingCategory[];
  unmapped?: { total?: number; topCodes?: { code: string; qty: number }[] };
}

const MODE_COPY: Record<Mode, { title: string; description: string; icon: typeof CheckSquare }> = {
  actions: {
    title: "Plumbing Actions",
    description: "Prioritised actions from Plumbing Sheet3 production and release data.",
    icon: CheckSquare,
  },
  backlog: {
    title: "Plumbing Backlog",
    description: "Open Plumbing release work, calculated from the Plumbing plan and Sheet3 actuals.",
    icon: PackageMinus,
  },
  ai: {
    title: "Plumbing AI Analytics",
    description: "Plumbing-only signals for review, grounded in the Sheet3 monitoring feed.",
    icon: Sparkles,
  },
  settings: {
    title: "Plumbing Settings",
    description: "Plumbing data sources and configuration shortcuts. PTMT settings are not used here.",
    icon: FileCog,
  },
};

function fmt(n: number | null | undefined) {
  return Math.round(n ?? 0).toLocaleString("en-IN");
}

export default function PlumbingOperations({ month, mode }: { month: string; mode: Mode }) {
  const [data, setData] = useState<PlumbingDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const copy = MODE_COPY[mode];
  const Icon = copy.icon;

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/monitoring/dashboard?month=${encodeURIComponent(month)}&segment=Plumbing`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setData(await response.json() as PlumbingDashboard);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Plumbing monitoring data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [month]);

  const categories = data?.categories ?? [];
  const backlog = useMemo(
    () => categories
      .map((category) => ({
        ...category,
        remaining: Math.max(0, (category.totalRelease ?? 0) - (category.totalActual ?? 0)),
      }))
      .filter((category) => category.remaining > 0)
      .sort((a, b) => b.remaining - a.remaining),
    [categories],
  );
  const notStarted = categories.filter((category) => category.notStarted);
  const unmapped = data?.unmapped?.total ?? data?.plant?.unmapped ?? 0;

  return (
    <div className="space-y-6 max-w-[1100px] mx-auto pb-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Icon className="h-6 w-6 text-primary" /> {copy.title}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{copy.description} · {month}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading} className="gap-2">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Loading…" : "Refresh"}
        </Button>
      </header>

      {error && (
        <Card className="border-red-500/30">
          <CardContent className="pt-6 flex items-center gap-3 text-sm text-red-600">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
          </CardContent>
        </Card>
      )}

      {loading && !data && <div className="h-48 rounded-xl bg-muted/40 animate-pulse" />}

      {data && mode === "actions" && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Needs attention</CardTitle>
              <CardDescription>These signals are computed only from the Plumbing monitoring payload.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {notStarted.length > 0 && (
                <div className="flex gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span><strong>{notStarted.length} categories not started.</strong> {notStarted.map((c) => c.category).join(", ")}</span>
                </div>
              )}
              {unmapped > 0 && (
                <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span><strong>{fmt(unmapped)} unmapped pieces.</strong> Map production codes into the Plumbing plan master.</span>
                </div>
              )}
              {backlog.slice(0, 5).map((category) => (
                <div key={category.category} className="flex items-center justify-between rounded-lg border px-4 py-3 text-sm">
                  <span className="font-medium">{category.category}</span>
                  <span className="text-muted-foreground">{fmt(category.remaining)} pcs still open</span>
                </div>
              ))}
              {notStarted.length === 0 && unmapped === 0 && backlog.length === 0 && (
                <p className="text-sm text-emerald-600">No Plumbing actions are currently raised.</p>
              )}
            </CardContent>
          </Card>
          <Link href="/plumbing/recommendations">
            <Button variant="outline">Open detailed recommendations</Button>
          </Link>
        </div>
      )}

      {data && mode === "backlog" && (
        <Card>
          <CardHeader>
            <CardTitle>Open release backlog</CardTitle>
            <CardDescription>Remaining = released plan minus mapped Sheet3 actuals, never PTMT stockout data.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-xs text-muted-foreground">
                  <tr><th className="text-left py-2">Category</th><th className="text-right py-2">Released</th><th className="text-right py-2">Actual</th><th className="text-right py-2">Open</th></tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {backlog.map((category) => (
                    <tr key={category.category}>
                      <td className="py-2 font-medium">{category.category}</td>
                      <td className="py-2 text-right font-mono">{fmt(category.totalRelease)}</td>
                      <td className="py-2 text-right font-mono">{fmt(category.totalActual)}</td>
                      <td className="py-2 text-right font-mono font-semibold">{fmt(category.remaining)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {backlog.length === 0 && <p className="text-sm text-muted-foreground py-8 text-center">No open Plumbing release backlog.</p>}
            </div>
          </CardContent>
        </Card>
      )}

      {data && mode === "ai" && (
        <Card>
          <CardHeader>
            <CardTitle>Plumbing signal summary</CardTitle>
            <CardDescription>
              This view is intentionally scoped to Plumbing Sheet3 data. It does not show PTMT AI analyses or mix PTMT and Plumbing figures.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">Run rate</p><p className="text-2xl font-bold">{fmt(data.plant?.runRatePerDay)} pcs/day</p></div>
            <div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">Open release</p><p className="text-2xl font-bold">{fmt(backlog.reduce((sum, c) => sum + c.remaining, 0))} pcs</p></div>
            <div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">Unmapped</p><p className="text-2xl font-bold">{fmt(unmapped)} pcs</p></div>
          </CardContent>
        </Card>
      )}

      {data && mode === "settings" && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Database className="h-4 w-4" /> Plumbing source</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>Actuals: <strong>Sheet3</strong> daily production feed.</p>
              <p>Last data date: <strong>{data.lastDataDate ?? "Unavailable"}</strong></p>
              <p>Categories: <strong>12 Plumbing categories</strong></p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Plumbing configuration</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Link href="/plumbing/config"><Button variant="outline">Open monitoring config</Button></Link>
              <Link href="/plumbing/plan-import"><Button variant="outline">Open plan import</Button></Link>
              <Link href="/plumbing/reports"><Button variant="outline">Open reports</Button></Link>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
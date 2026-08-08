import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, SlidersHorizontal, Database, ExternalLink } from "lucide-react";
import { Link } from "wouter";

function fmtN(n: number | null | undefined) {
  if (n == null) return "–";
  return Math.round(n).toLocaleString("en-IN");
}

export default function PlumbingConfig({ month }: { month: string }) {
  const [capacity, setCapacity] = useState<any[]>([]);
  const [workbook, setWorkbook] = useState<any>(null);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    try {
      setRefreshing(true);
      const [capRes, wbRes] = await Promise.all([
        fetch(`/api/capacity/categories?segment=Plumbing`),
        fetch(`/api/workbook-config/resolved`),
      ]);
      if (capRes.ok) setCapacity(await capRes.json());
      if (wbRes.ok) {
        const wbData = await wbRes.json() as any;
        setWorkbook(wbData);
      }
    } catch { /* silent */ }
    finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => { load(); }, [month]);

  if (loading) return (
    <div className="space-y-4 animate-pulse">
      <div className="h-24 bg-muted/40 rounded-xl" />
      <div className="h-64 bg-muted/40 rounded-xl" />
    </div>
  );

  const plumbCap = capacity.filter((c: any) => c.segment === "Plumbing" || !c.segment);
  const plumbWb  = workbook?.Plumbing;

  return (
    <div className="space-y-6 max-w-[900px] mx-auto pb-10">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2 mb-1">
            <SlidersHorizontal className="h-6 w-6 text-primary" /> Plumbing Config
          </h1>
          <p className="text-muted-foreground text-sm">
            Capacity settings, workbook configuration · {month}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={refreshing} className="gap-2">
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </header>

      {/* Workbook configuration */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><Database className="h-4 w-4" /> Active Workbook</CardTitle>
          <CardDescription>Drive workbook used for Sheet3 production actuals this month</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {plumbWb ? (
            <div className="flex items-start justify-between gap-4 p-4 bg-muted/30 rounded-lg border border-border/40">
              <div>
                <p className="text-sm font-medium">{plumbWb.title ?? "—"}</p>
                <p className="text-xs text-muted-foreground mt-0.5 font-mono break-all">{plumbWb.fileId ?? "—"}</p>
              </div>
              {plumbWb.fileId && (
                <a
                  href={`https://docs.google.com/spreadsheets/d/${plumbWb.fileId}`}
                  target="_blank" rel="noopener noreferrer"
                  className="shrink-0"
                >
                  <Button size="sm" variant="outline" className="gap-1.5">
                    <ExternalLink className="h-3.5 w-3.5" /> Open
                  </Button>
                </a>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No Plumbing workbook resolved for {month}.</p>
          )}
          <p className="text-xs text-muted-foreground">
            To change the workbook ID, go to{" "}
            <Link href="/plumbing/plan-import" className="underline">Plan Import</Link> or use the
            Workbook Config panel on the Production Planning Data page.
          </p>
        </CardContent>
      </Card>

      {/* Capacity configuration */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><SlidersHorizontal className="h-4 w-4" /> Category Capacity</CardTitle>
          <CardDescription>Suggested and override daily capacity per category (used in the corrective re-plan)</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {plumbCap.length === 0 ? (
            <p className="text-sm text-muted-foreground px-6 py-4">No capacity configuration found for Plumbing.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 border-y border-border/50">
                  <tr>
                    <th className="text-left py-2.5 px-4 font-medium text-muted-foreground">Category</th>
                    <th className="text-right py-2.5 px-3 font-medium text-muted-foreground">Suggested (pcs/day)</th>
                    <th className="text-right py-2.5 px-3 font-medium text-muted-foreground">Override</th>
                    <th className="text-right py-2.5 px-4 font-medium text-muted-foreground">Effective</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {plumbCap.map((c: any) => {
                    const effective = c.overrideCapacity ?? c.suggestedCapacity ?? 0;
                    return (
                      <tr key={c.category} className="hover:bg-muted/20">
                        <td className="py-2 px-4 font-medium">{c.category}</td>
                        <td className="py-2 px-3 text-right font-mono">{fmtN(c.suggestedCapacity)}</td>
                        <td className="py-2 px-3 text-right">
                          {c.overrideCapacity != null
                            ? <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-500/30 text-xs">{fmtN(c.overrideCapacity)}</Badge>
                            : <span className="text-muted-foreground text-xs">—</span>
                          }
                        </td>
                        <td className="py-2 px-4 text-right font-mono font-semibold">{fmtN(effective)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

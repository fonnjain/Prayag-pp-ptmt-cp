import { useState, useEffect } from "react";
import { useGetPlantBundle, getGetPlantBundleQueryKey, type PlantBundle } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LineChart, Line, ComposedChart } from "recharts";

function pct(n: number | null | undefined) { return n !== null && n !== undefined ? `${n.toFixed(1)}%` : "–"; }
function fmt(n: number) { return n.toLocaleString(); }

export default function PlantPareto({ month, selectedCategory }: { month: string; selectedCategory?: string | null }) {
  const { data, isLoading } = useGetPlantBundle(
    { month },
    { query: { queryKey: getGetPlantBundleQueryKey({ month }) } }
  );
  const bundle = data ? (data as unknown as PlantBundle) : undefined;
  const [categoryFilter, setCategoryFilter] = useState<string>(selectedCategory ?? "all");

  // Sync local dropdown when global category filter changes
  useEffect(() => {
    setCategoryFilter(selectedCategory ?? "all");
  }, [selectedCategory]);

  if (isLoading) return <div className="flex items-center justify-center h-64 text-muted-foreground">Loading...</div>;
  if (!bundle) return <div className="text-red-500 p-4">Failed to load plant data.</div>;

  const { variancePareto, items, categories, mixFlags } = bundle;
  const allCategories = [...new Set(items.map((i) => i.category))].sort();

  const filteredItems = (categoryFilter === "all" ? variancePareto : variancePareto.filter((i) => i.category === categoryFilter));

  let cumPct = 0;
  const totalGap = variancePareto.reduce((s, i) => s + Math.max(i.gapPcs, 0), 0);
  const paretoData = filteredItems.slice(0, 15).map((item) => {
    cumPct += totalGap > 0 ? (Math.max(item.gapPcs, 0) / totalGap) * 100 : 0;
    return { ...item, cumPct: Math.round(cumPct * 10) / 10, label: `${item.itemCode}${item.colour ? "/" + item.colour.slice(0, 4) : ""}` };
  });

  const zeroItems = items.filter((i) => i.producedToDate === 0 && i.targetMax > 0).sort((a, b) => b.targetMax - a.targetMax);

  return (
    <div className="space-y-6 max-w-[1300px] mx-auto pb-10">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight mb-1">Variance Pareto</h1>
        <p className="text-muted-foreground text-sm">Top items by shortfall (pcs gap) — {month}</p>
      </header>

      <div className="flex items-center gap-3">
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-56"><SelectValue placeholder="All categories" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {allCategories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="text-sm text-muted-foreground">Total gap: {fmt(totalGap)} pcs across {variancePareto.length} items</div>
      </div>

      {/* Pareto chart */}
      <Card>
        <CardHeader>
          <CardTitle>Top Items by Pcs Gap</CardTitle>
          <CardDescription>Bars = gap; line = cumulative % of total gap</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={paretoData} margin={{ top: 5, right: 40, left: 10, bottom: 50 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="label" angle={-45} textAnchor="end" tick={{ fontSize: 10 }} interval={0} />
              <YAxis yAxisId="gap" tick={{ fontSize: 11 }} tickFormatter={(v) => v.toLocaleString()} />
              <YAxis yAxisId="cum" orientation="right" tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
              <Tooltip
                formatter={(v: number, n: string) => [n === "cumPct" ? `${v}%` : v.toLocaleString(), n === "cumPct" ? "Cumulative %" : "Gap (pcs)"]}
                labelFormatter={(l, p) => `${p?.[0]?.payload?.itemCode ?? l} / ${p?.[0]?.payload?.colour ?? "–"}`}
              />
              <Bar yAxisId="gap" dataKey="gapPcs" name="Gap (pcs)" radius={[4, 4, 0, 0]}>
                {paretoData.map((d, i) => (
                  <Cell key={i} fill={d.attainmentMonthPct === null || d.attainmentMonthPct === 0 ? "#ef4444" : "#f59e0b"} />
                ))}
              </Bar>
              <Line yAxisId="cum" type="monotone" dataKey="cumPct" name="Cumulative %" stroke="#3b82f6" dot={false} strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Top items table */}
      <Card>
        <CardHeader><CardTitle>Top Items by Shortfall</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 text-muted-foreground text-right">
                  <th className="text-left py-2 pr-4 font-medium w-6">#</th>
                  <th className="text-left py-2 pr-4 font-medium">Item Code</th>
                  <th className="text-left py-2 pr-4 font-medium">Category</th>
                  <th className="py-2 pr-4 font-medium">Plan (Max PP)</th>
                  <th className="py-2 pr-4 font-medium">Produced</th>
                  <th className="py-2 pr-4 font-medium">Gap (pcs)</th>
                  <th className="py-2 pr-4 font-medium">Att %</th>
                  <th className="py-2 font-medium">No-Prod Days</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.slice(0, 20).map((item, idx) => (
                  <tr key={`${item.itemCode}/${item.colour}`} className="border-b border-border/20 hover:bg-muted/20 text-right">
                    <td className="py-1.5 pr-4 text-left text-muted-foreground">{idx + 1}</td>
                    <td className="py-1.5 pr-4 text-left font-medium">
                      {item.itemCode}
                      {item.colour && <span className="text-muted-foreground ml-1 text-xs">/ {item.colour}</span>}
                    </td>
                    <td className="py-1.5 pr-4 text-left">
                      <Badge variant="outline" className="text-xs">{item.category}</Badge>
                    </td>
                    <td className="py-1.5 pr-4 font-mono">{fmt(item.targetMax)}</td>
                    <td className="py-1.5 pr-4 font-mono">{fmt(item.producedToDate)}</td>
                    <td className="py-1.5 pr-4 font-mono text-red-500">{fmt(Math.max(item.gapPcs, 0))}</td>
                    <td className="py-1.5 pr-4 font-mono">{pct(item.attainmentMonthPct)}</td>
                    <td className={`py-1.5 font-mono ${item.daysWithNoProduction > 3 ? "text-red-500" : "text-muted-foreground"}`}>{item.daysWithNoProduction}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Mix flags */}
      {mixFlags.length > 0 && (
        <Card className="border-amber-500/30">
          <CardHeader>
            <CardTitle className="text-amber-600">Mix Imbalance Flags</CardTitle>
            <CardDescription>High-plan items with zero output while other items are producing</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {mixFlags.map((f) => (
                <div key={`${f.itemCode}/${f.colour}`} className="flex items-center justify-between text-sm p-2 rounded border border-amber-500/20 bg-amber-500/5">
                  <div className="font-medium">{f.itemCode}{f.colour ? ` / ${f.colour}` : ""}</div>
                  <Badge variant="outline" className="text-xs">{f.category}</Badge>
                  <div className="text-muted-foreground">Plan: {fmt(f.targetMax)} pcs</div>
                  <Badge variant="outline" className="text-xs text-amber-600 border-amber-500/40">zero output</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Zero output items */}
      {zeroItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Items with Zero Output</CardTitle>
            <CardDescription>{zeroItems.length} items with plan &gt; 0 have not started production</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {zeroItems.slice(0, 30).map((i) => (
                <Badge key={`${i.itemCode}/${i.colour}`} variant="outline" className="text-xs text-red-600 border-red-500/30">
                  {i.itemCode}{i.colour ? `/${i.colour.slice(0, 3)}` : ""} ({i.targetMax.toLocaleString()})
                </Badge>
              ))}
              {zeroItems.length > 30 && <Badge variant="outline" className="text-xs">+{zeroItems.length - 30} more</Badge>}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

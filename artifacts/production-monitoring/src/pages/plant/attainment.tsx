import { useState, Fragment } from "react";
import { useGetPlantBundle, getGetPlantBundleQueryKey, type PlantBundle } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ComposedChart, Line } from "recharts";
import { FileSpreadsheet, ChevronDown, ChevronRight } from "lucide-react";
import { exportXlsx } from "@/lib/excel";

function pct(n: number | null | undefined) { return n !== null && n !== undefined ? `${n.toFixed(1)}%` : "–"; }
function fmt(n: number | null | undefined) { return n !== null && n !== undefined ? n.toLocaleString() : "–"; }

const RAG_COLORS = { green: "#10b981", amber: "#f59e0b", red: "#ef4444" };

export default function PlantAttainment({ month, selectedCategory }: { month: string; selectedCategory?: string | null }) {
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  const { data, isLoading } = useGetPlantBundle(
    { month },
    { query: { queryKey: getGetPlantBundleQueryKey({ month }) } }
  );

  if (isLoading) return <div className="flex items-center justify-center h-64 text-muted-foreground">Loading...</div>;
  if (!data) return <div className="text-red-500 p-4">Failed to load plant data.</div>;
  const bundle = data as unknown as PlantBundle;

  const { categories: allCategories, items, variancePareto, mixFlags, plant, context } = bundle;

  const categories = selectedCategory
    ? allCategories.filter((c) => c.category === selectedCategory)
    : allCategories;

  const filteredVariancePareto = selectedCategory
    ? variancePareto.filter((i) => i.category === selectedCategory)
    : variancePareto;

  const filteredMixFlags = selectedCategory
    ? mixFlags.filter((f) => f.category === selectedCategory)
    : mixFlags;

  const totalGap = filteredVariancePareto.reduce((s, i) => s + Math.max(i.gapPcs, 0), 0);

  let cumPct = 0;
  const paretoData = filteredVariancePareto.slice(0, 15).map((item) => {
    cumPct += totalGap > 0 ? (Math.max(item.gapPcs, 0) / totalGap) * 100 : 0;
    return { ...item, cumPct: Math.round(cumPct * 10) / 10, label: `${item.itemCode}${item.colour ? "/" + item.colour.slice(0, 4) : ""}` };
  });

  const filteredItems = selectedCategory
    ? items.filter((i) => i.category === selectedCategory)
    : items;
  const zeroItems = filteredItems.filter((i) => i.producedToDate === 0 && i.targetMax > 0).sort((a, b) => b.targetMax - a.targetMax);

  return (
    <div className="space-y-6 max-w-[1300px] mx-auto pb-10">
      <header className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-1">Plan vs Actual Attainment</h1>
          <p className="text-muted-foreground text-sm">
            Plant/category/item plan vs actual — {month} · {context.elapsed}/{context.workingDays} days elapsed
            {selectedCategory ? ` · filtered: ${selectedCategory}` : ""}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => exportXlsx(`attainment-${month}`, [
          { name: "Categories", rows: categories.map((c) => ({ Category: c.category, TargetMax: c.targetMax, TargetMin: c.targetMin, ProducedToDate: c.producedToDate, GapPcs: c.gapPcs, AttainmentCumPct: c.attainmentCumPct, ProjectedAttainmentPct: c.projectedAttainmentPct, RAG: c.ragBand })) },
          { name: "Variance Pareto", rows: filteredVariancePareto.map((i) => ({ ItemCode: i.itemCode, Colour: i.colour, Category: i.category, TargetMax: i.targetMax, ProducedToDate: i.producedToDate, GapPcs: i.gapPcs, AttainmentMonthPct: i.attainmentMonthPct, DaysNoProduction: i.daysWithNoProduction })) },
          { name: "Mix Flags", rows: filteredMixFlags.map((f) => ({ ItemCode: f.itemCode, Colour: f.colour, Category: f.category, TargetMax: f.targetMax })) },
        ])}>
          <FileSpreadsheet className="h-4 w-4 mr-2" /> Export Excel
        </Button>
      </header>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="pareto">Variance Pareto</TabsTrigger>
          <TabsTrigger value="mix">Mix Imbalance</TabsTrigger>
        </TabsList>

        {/* Overview tab: category summary */}
        <TabsContent value="overview" className="space-y-4 mt-4">
          <Card>
            <CardHeader><CardTitle>Category Produced vs Max PP</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={Math.max(180, categories.length * 44)}>
                <BarChart data={categories.map((c) => ({
                  name: c.category.length > 14 ? c.category.slice(0, 14) + "…" : c.category,
                  fullName: c.category,
                  produced: c.producedToDate,
                  gap: Math.max(c.gapPcs, 0),
                  ragBand: c.ragBand,
                }))} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
                  <Tooltip formatter={(v: number, n: string) => [v.toLocaleString(), n === "produced" ? "Produced" : "Remaining"]} labelFormatter={(l, p) => p?.[0]?.payload?.fullName ?? l} />
                  <Bar dataKey="produced" name="Produced" stackId="a">
                    {categories.map((d, i) => <Cell key={i} fill={RAG_COLORS[d.ragBand ?? "red"]} fillOpacity={0.85} />)}
                  </Bar>
                  <Bar dataKey="gap" name="Remaining" stackId="a" fill="#94a3b8" fillOpacity={0.2} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Category Detail</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">Click a row to expand item-level drill-down</p>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50 text-muted-foreground text-right">
                      <th className="text-left py-2 pr-4 font-medium w-6"></th>
                      <th className="text-left py-2 pr-4 font-medium">Category</th>
                      <th className="py-2 pr-4 font-medium">Max PP</th>
                      <th className="py-2 pr-4 font-medium">Min PP</th>
                      <th className="py-2 pr-4 font-medium">Produced</th>
                      <th className="py-2 pr-4 font-medium">Gap</th>
                      <th className="py-2 pr-4 font-medium">Cum Att %</th>
                      <th className="py-2 pr-4 font-medium">Proj End %</th>
                      <th className="py-2 font-medium">RAG</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categories.map((cat) => {
                      const isOpen = expandedCategory === cat.category;
                      const catItems = items
                        .filter((i) => i.category === cat.category)
                        .sort((a, b) => Math.max(b.gapPcs, 0) - Math.max(a.gapPcs, 0));
                      return (
                        <Fragment key={cat.category}>
                          {/* Category row — clickable */}
                          <tr
                            className="border-b border-border/20 hover:bg-muted/30 text-right cursor-pointer select-none"
                            onClick={() => setExpandedCategory(isOpen ? null : cat.category)}
                          >
                            <td className="py-2 pl-1 text-left text-muted-foreground">
                              {isOpen
                                ? <ChevronDown className="h-3.5 w-3.5" />
                                : <ChevronRight className="h-3.5 w-3.5" />}
                            </td>
                            <td className="py-2 pr-4 text-left font-medium">{cat.category}</td>
                            <td className="py-2 pr-4 font-mono">{fmt(cat.targetMax)}</td>
                            <td className="py-2 pr-4 font-mono text-muted-foreground">{fmt(cat.targetMin)}</td>
                            <td className="py-2 pr-4 font-mono">{fmt(cat.producedToDate)}</td>
                            <td className={`py-2 pr-4 font-mono ${cat.gapPcs > 0 ? "text-red-500" : "text-emerald-600"}`}>{fmt(cat.gapPcs)}</td>
                            <td className="py-2 pr-4 font-mono">{pct(cat.attainmentCumPct)}</td>
                            <td className="py-2 pr-4 font-mono">{pct(cat.projectedAttainmentPct)}</td>
                            <td className="py-2">
                              <Badge variant="outline" className={`text-xs ${cat.ragBand === "green" ? "text-emerald-600 border-emerald-500/40" : cat.ragBand === "amber" ? "text-amber-600 border-amber-500/40" : "text-red-600 border-red-500/40"}`}>
                                {cat.ragBand ?? "–"}
                              </Badge>
                            </td>
                          </tr>

                          {/* Expanded item rows */}
                          {isOpen && (
                            <>
                              <tr className="bg-muted/20">
                                <td colSpan={9} className="pt-2 pb-0 px-4">
                                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border/30 pb-1 mb-0">
                                    {cat.category} — {catItems.length} items
                                  </div>
                                </td>
                              </tr>
                              <tr className="bg-muted/10">
                                <td colSpan={2} />
                                <td className="py-1.5 pr-3 text-right text-xs text-muted-foreground font-medium">Item Code</td>
                                <td className="py-1.5 pr-3 text-left text-xs text-muted-foreground font-medium">Colour</td>
                                <td className="py-1.5 pr-3 text-right text-xs text-muted-foreground font-medium">Plan (Max)</td>
                                <td className="py-1.5 pr-3 text-right text-xs text-muted-foreground font-medium">Produced</td>
                                <td className="py-1.5 pr-3 text-right text-xs text-muted-foreground font-medium">Gap</td>
                                <td className="py-1.5 pr-3 text-right text-xs text-muted-foreground font-medium">Att %</td>
                                <td className="py-1.5 text-right text-xs text-muted-foreground font-medium">0-day streak</td>
                              </tr>
                              {catItems.map((item, idx) => (
                                <tr
                                  key={`${item.itemCode}/${item.colour}/${idx}`}
                                  className="bg-muted/10 border-b border-border/10 hover:bg-muted/25 text-right"
                                >
                                  <td colSpan={2} />
                                  <td className="py-1.5 pr-3 font-mono text-xs font-medium">{item.itemCode}</td>
                                  <td className="py-1.5 pr-3 text-left text-xs text-muted-foreground">{item.colour || "—"}</td>
                                  <td className="py-1.5 pr-3 font-mono text-xs">{fmt(item.targetMax)}</td>
                                  <td className="py-1.5 pr-3 font-mono text-xs">{fmt(item.producedToDate)}</td>
                                  <td className={`py-1.5 pr-3 font-mono text-xs ${item.gapPcs > 0 ? "text-red-500" : "text-emerald-600"}`}>{fmt(Math.max(item.gapPcs, 0))}</td>
                                  <td className="py-1.5 pr-3 font-mono text-xs">{pct(item.attainmentMonthPct)}</td>
                                  <td className={`py-1.5 font-mono text-xs ${item.daysWithNoProduction > 3 ? "text-red-500 font-semibold" : "text-muted-foreground"}`}>
                                    {item.daysWithNoProduction > 0 ? item.daysWithNoProduction : "–"}
                                  </td>
                                </tr>
                              ))}
                              <tr className="bg-muted/10">
                                <td colSpan={9} className="py-2" />
                              </tr>
                            </>
                          )}
                        </Fragment>
                      );
                    })}
                    {!selectedCategory && (
                      <tr className="border-t-2 border-border font-bold text-right">
                        <td className="py-2" />
                        <td className="py-2 pr-4 text-left">Plant Total</td>
                        <td className="py-2 pr-4 font-mono">{fmt(plant.targetMax)}</td>
                        <td className="py-2 pr-4 font-mono text-muted-foreground">{fmt(plant.targetMin)}</td>
                        <td className="py-2 pr-4 font-mono">{fmt(plant.producedToDate)}</td>
                        <td className={`py-2 pr-4 font-mono ${plant.targetMax - plant.producedToDate > 0 ? "text-red-500" : "text-emerald-600"}`}>{fmt(plant.targetMax - plant.producedToDate)}</td>
                        <td className="py-2 pr-4 font-mono">{pct(plant.attainmentCumPct)}</td>
                        <td className="py-2 pr-4 font-mono">{pct(plant.projectedAttainmentPct)}</td>
                        <td className="py-2">
                          <Badge variant="outline" className={`text-xs ${plant.ragBand === "green" ? "text-emerald-600 border-emerald-500/40" : plant.ragBand === "amber" ? "text-amber-600 border-amber-500/40" : "text-red-600 border-red-500/40"}`}>
                            {plant.ragBand ?? "–"}
                          </Badge>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Pareto tab */}
        <TabsContent value="pareto" className="space-y-4 mt-4">
          <div className="text-sm text-muted-foreground">
            Total gap: {fmt(totalGap)} pcs · {filteredVariancePareto.length} items
            {selectedCategory ? ` · ${selectedCategory}` : ""}
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Top Items by Pcs Shortfall</CardTitle>
              <CardDescription>Bars = gap (pcs); line = cumulative % of total gap</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={paretoData} margin={{ top: 5, right: 40, left: 10, bottom: 50 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="label" angle={-45} textAnchor="end" tick={{ fontSize: 10 }} interval={0} />
                  <YAxis yAxisId="gap" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="cum" orientation="right" tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
                  <Tooltip formatter={(v: number, n: string) => [n === "cumPct" ? `${v}%` : v.toLocaleString(), n === "cumPct" ? "Cum %" : "Gap"]} labelFormatter={(l, p) => `${p?.[0]?.payload?.itemCode ?? l}${p?.[0]?.payload?.colour ? "/" + p[0].payload.colour : ""}`} />
                  <Bar yAxisId="gap" dataKey="gapPcs" name="Gap (pcs)" radius={[4, 4, 0, 0]}>
                    {paretoData.map((d, i) => <Cell key={i} fill={d.attainmentMonthPct === null || d.attainmentMonthPct === 0 ? "#ef4444" : "#f59e0b"} />)}
                  </Bar>
                  <Line yAxisId="cum" type="monotone" dataKey="cumPct" name="Cum %" stroke="#3b82f6" dot={false} strokeWidth={2} />
                </ComposedChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Top 20 Items by Shortfall</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50 text-muted-foreground text-right">
                      <th className="text-left py-2 pr-3 w-6 font-medium">#</th>
                      <th className="text-left py-2 pr-3 font-medium">Item</th>
                      <th className="text-left py-2 pr-3 font-medium">Category</th>
                      <th className="py-2 pr-3 font-medium">Plan</th>
                      <th className="py-2 pr-3 font-medium">Produced</th>
                      <th className="py-2 pr-3 font-medium">Gap</th>
                      <th className="py-2 pr-3 font-medium">Att %</th>
                      <th className="py-2 font-medium">0-day streak</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredVariancePareto.slice(0, 20).map((item, idx) => (
                      <tr key={`${item.itemCode}/${item.colour}`} className="border-b border-border/20 hover:bg-muted/20 text-right">
                        <td className="py-1.5 pr-3 text-left text-muted-foreground">{idx + 1}</td>
                        <td className="py-1.5 pr-3 text-left font-medium">{item.itemCode}{item.colour && <span className="text-muted-foreground ml-1 text-xs">/{item.colour}</span>}</td>
                        <td className="py-1.5 pr-3 text-left"><Badge variant="outline" className="text-xs">{item.category}</Badge></td>
                        <td className="py-1.5 pr-3 font-mono">{fmt(item.targetMax)}</td>
                        <td className="py-1.5 pr-3 font-mono">{fmt(item.producedToDate)}</td>
                        <td className="py-1.5 pr-3 font-mono text-red-500">{fmt(Math.max(item.gapPcs, 0))}</td>
                        <td className="py-1.5 pr-3 font-mono">{pct(item.attainmentMonthPct)}</td>
                        <td className={`py-1.5 font-mono ${item.daysWithNoProduction > 3 ? "text-red-500" : "text-muted-foreground"}`}>{item.daysWithNoProduction}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Mix imbalance tab */}
        <TabsContent value="mix" className="space-y-4 mt-4">
          {filteredMixFlags.length > 0 ? (
            <Card className="border-amber-500/30">
              <CardHeader>
                <CardTitle className="text-amber-600">Mix Imbalance Flags ({filteredMixFlags.length})</CardTitle>
                <CardDescription>High-plan items with zero output while other items are producing</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {filteredMixFlags.map((f) => (
                    <div key={`${f.itemCode}/${f.colour}`} className="flex items-center justify-between text-sm p-2.5 rounded border border-amber-500/20 bg-amber-500/5">
                      <div className="font-medium">{f.itemCode}{f.colour ? ` / ${f.colour}` : ""}</div>
                      <Badge variant="outline" className="text-xs">{f.category}</Badge>
                      <div className="text-muted-foreground">Plan: {fmt(f.targetMax)} pcs</div>
                      <Badge variant="outline" className="text-xs text-amber-600 border-amber-500/40">zero output</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-emerald-500/30 bg-emerald-500/5">
              <CardContent className="pt-6 text-sm text-emerald-600">No mix imbalance flags{selectedCategory ? ` for ${selectedCategory}` : ""} — all planned items have begun production.</CardContent>
            </Card>
          )}

          {zeroItems.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Items with Zero Output ({zeroItems.length})</CardTitle>
                <CardDescription>Items with plan &gt; 0 that have not started production yet</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {zeroItems.slice(0, 40).map((i) => (
                    <Badge key={`${i.itemCode}/${i.colour}`} variant="outline" className="text-xs text-red-600 border-red-500/30">
                      {i.itemCode}{i.colour ? `/${i.colour.slice(0, 3)}` : ""} ({i.targetMax.toLocaleString()})
                    </Badge>
                  ))}
                  {zeroItems.length > 40 && <Badge variant="outline" className="text-xs">+{zeroItems.length - 40} more</Badge>}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

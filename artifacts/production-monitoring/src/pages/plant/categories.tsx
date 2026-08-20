import { useGetPlantBundle, getGetPlantBundleQueryKey, type PlantBundle } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

function pct(n: number | null | undefined) { return n !== null && n !== undefined ? `${n.toFixed(1)}%` : "–"; }
function fmt(n: number | null | undefined) { return n !== null && n !== undefined ? Math.round(n).toLocaleString() : "–"; }

const RAG_COLORS = { green: "#10b981", amber: "#f59e0b", red: "#ef4444" };

function CategoryTick({ x, y, payload, labels }: any) {
  const label = labels?.[payload?.index]?.fullName ?? payload?.value ?? "";
  return (
    <g transform={`translate(${x},${y})`}>
      <title>{label}</title>
      <text x={-8} y={0} dy={4} textAnchor="end" fill="currentColor" fontSize={11}>
        {payload?.value}
      </text>
    </g>
  );
}

export default function PlantCategories({ month, selectedCategory }: { month: string; selectedCategory?: string | null }) {
  const { data, isLoading } = useGetPlantBundle(
    { month },
    { query: { queryKey: getGetPlantBundleQueryKey({ month }) } }
  );

  if (isLoading) return <div className="flex items-center justify-center h-64 text-muted-foreground">Loading...</div>;
  if (!data) return <div className="text-red-500 p-4">Failed to load plant data.</div>;
  const bundle = data as unknown as PlantBundle;

  const { categories: allCategories, context, plant } = bundle;
  const categories = selectedCategory
    ? allCategories.filter((c) => c.category === selectedCategory)
    : allCategories;

  const chartData = categories.map((c) => ({
    name: c.category.length > 14 ? c.category.slice(0, 14) + "…" : c.category,
    fullName: c.category,
    produced: c.producedToDate,
    target: c.targetMax,
    gap: Math.max(c.gapPcs, 0),
    ragBand: c.ragBand,
    attainment: c.attainmentCumPct ?? 0,
  }));
  const attainmentAxisMax = Math.max(
    120,
    Math.ceil(Math.max(...chartData.map((d) => d.attainment), 0) / 20) * 20,
  );

  return (
    <div className="space-y-6 max-w-[1300px] mx-auto pb-10">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight mb-1">Category Breakdown</h1>
        <p className="text-muted-foreground text-sm">
          Output vs Plan per category in pieces (NOS) — {month} · {context.elapsed}/{context.workingDays} days elapsed
          {selectedCategory ? ` · filtered: ${selectedCategory}` : ""}
        </p>
      </header>

      {/* Category bar chart */}
      <Card>
        <CardHeader><CardTitle>Produced vs Target (Max PP) by Category</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={categories.length === 1 ? 120 : Math.max(200, categories.length * 44)}>
            <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 40, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <YAxis
                type="category"
                dataKey="name"
                tick={(props) => <CategoryTick {...props} labels={chartData} />}
                width={180}
              />
              <Tooltip
                formatter={(v: number, n: string) => [v.toLocaleString(), n === "produced" ? "Produced" : n === "gap" ? "Remaining Gap" : n]}
                labelFormatter={(l, p) => p?.[0]?.payload?.fullName ?? l}
              />
              <Bar dataKey="produced" name="Produced to Date" stackId="a" radius={[0, 0, 0, 0]}>
                {chartData.map((d, i) => (
                  <Cell key={i} fill={RAG_COLORS[d.ragBand ?? "red"]} fillOpacity={0.8} />
                ))}
              </Bar>
              <Bar dataKey="gap" name="Remaining Gap" stackId="a" fill="#94a3b8" fillOpacity={0.25} />
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground" aria-label="Chart legend">
            <span className="font-medium text-foreground">Produced to Date:</span>
            {[
              ["#10b981", "On track"],
              ["#f59e0b", "Watch"],
              ["#ef4444", "Behind"],
            ].map(([color, label]) => (
              <span key={label} className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
                {label}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-slate-400/60" />
              Remaining Gap
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Attainment chart */}
      <Card>
        <CardHeader><CardTitle>Cumulative Attainment % by Category</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top: 5, right: 40, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} unit="%" domain={[0, attainmentAxisMax]} />
              <Tooltip formatter={(v: number) => [`${v.toFixed(1)}%`, "Attainment"]} labelFormatter={(l, p) => p?.[0]?.payload?.fullName ?? l} />
              <Bar dataKey="attainment" name="Attainment %" radius={[4, 4, 0, 0]}>
                {chartData.map((d, i) => (
                  <Cell key={i} fill={RAG_COLORS[d.ragBand ?? "red"]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Category detail table */}
      <Card>
        <CardHeader><CardTitle>Category Detail</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 text-muted-foreground text-right">
                  <th className="text-left py-2 pr-4 font-medium">Category</th>
                  <th className="py-2 pr-4 font-medium">Produced</th>
                  <th className="py-2 pr-4 font-medium">Target (Max)</th>
                  <th className="py-2 pr-4 font-medium">Cum Att %</th>
                  <th className="py-2 pr-4 font-medium">Projected EOM</th>
                  <th className="py-2 pr-4 font-medium">Min PP</th>
                  <th className="py-2 pr-4 font-medium">Gap (pcs)</th>
                  <th className="py-2 pr-4 font-medium">Req/Day</th>
                  <th className="py-2 pr-4 font-medium">Act/Day</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((cat) => (
                  <tr key={cat.category} className="border-b border-border/20 hover:bg-muted/20 text-right">
                    <td className="py-2 pr-4 text-left font-medium" title={cat.category}>{cat.category}</td>
                    <td className="py-2 pr-4 font-mono">{fmt(cat.producedToDate)}</td>
                    <td className="py-2 pr-4 font-mono">{fmt(cat.targetMax)}</td>
                    <td className="py-2 pr-4 font-mono">{pct(cat.attainmentCumPct)}</td>
                    <td className="py-2 pr-4 font-mono">{pct(cat.projectedAttainmentPct)}</td>
                    <td className="py-2 pr-4 font-mono text-muted-foreground">{fmt(cat.targetMin)}</td>
                    <td className={`py-2 pr-4 font-mono ${cat.gapPcs > 0 ? "text-red-500" : "text-emerald-600"}`}>{fmt(cat.gapPcs)}</td>
                    <td className="py-2 pr-4 font-mono text-muted-foreground">{fmt(cat.requiredPerDay)}</td>
                    <td className="py-2 pr-4 font-mono">{fmt(cat.actualPerDay)}</td>
                    <td className="py-2">
                      <Badge variant="outline" className={`text-xs ${cat.ragBand === "green" ? "text-emerald-600 border-emerald-500/40" : cat.ragBand === "amber" ? "text-amber-600 border-amber-500/40" : "text-red-600 border-red-500/40"}`}>
                        {cat.ragBand ?? "–"}
                      </Badge>
                    </td>
                  </tr>
                ))}
                {!selectedCategory && (
                  <tr className="border-t-2 border-border font-bold text-right">
                    <td className="py-2 pr-4 text-left">Plant Total</td>
                    <td className="py-2 pr-4 font-mono">{fmt(plant.producedToDate)}</td>
                    <td className="py-2 pr-4 font-mono">{fmt(plant.targetMax)}</td>
                    <td className="py-2 pr-4 font-mono">{pct(plant.attainmentCumPct)}</td>
                    <td className="py-2 pr-4 font-mono">{pct(plant.projectedAttainmentPct)}</td>
                    <td className="py-2 pr-4 font-mono text-muted-foreground">{fmt(plant.targetMin)}</td>
                    <td className={`py-2 pr-4 font-mono ${(plant.targetMax - plant.producedToDate) > 0 ? "text-red-500" : "text-emerald-600"}`}>{fmt(plant.targetMax - plant.producedToDate)}</td>
                    <td className="py-2 pr-4 font-mono text-muted-foreground">{fmt(plant.requiredPerDay)}</td>
                    <td className="py-2 pr-4 font-mono">{fmt(plant.actualPerDay)}</td>
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
    </div>
  );
}

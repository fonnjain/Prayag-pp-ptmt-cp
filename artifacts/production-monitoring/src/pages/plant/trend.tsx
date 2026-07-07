import { useGetPlantTrend, getGetPlantTrendQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from "recharts";
import { TrendingUp, TrendingDown } from "lucide-react";

interface PlantTrendSummary {
  month: string;
  attainmentMaxPct: number | null;
  attainmentMinPct: number | null;
  avgDailyPcs: number | null;
  linearityIndex: number | null;
  producedTotal: number | null;
  targetMax: number | null;
  targetMin: number | null;
  workingDays: number;
  bestCategory: string | null;
  worstCategory: string | null;
  ragBand: string | null;
}

function fmt(n: number | null | undefined, d = 0) { return n !== null && n !== undefined ? n.toLocaleString(undefined, { maximumFractionDigits: d }) : "–"; }
function pct(n: number | null | undefined) { return n !== null && n !== undefined ? `${n.toFixed(1)}%` : "–"; }
const RAG = { green: "#10b981", amber: "#f59e0b", red: "#ef4444", null: "#94a3b8" };

export default function PlantTrend({ month }: { month: string }) {
  const { data, isLoading } = useGetPlantTrend(
    { query: { queryKey: getGetPlantTrendQueryKey() } }
  );

  if (isLoading) return <div className="flex items-center justify-center h-64 text-muted-foreground">Loading trend data...</div>;
  if (!data) return <div className="text-red-500 p-4">Failed to load trend data.</div>;
  const summaries = (data as unknown as { data: PlantTrendSummary[] }).data ?? (data as unknown as PlantTrendSummary[]);
  if (!summaries || summaries.length === 0) {
    return (
      <div className="max-w-[1200px] mx-auto pb-10">
        <h1 className="text-3xl font-bold tracking-tight mb-4">Month-over-Month Trend</h1>
        <Card>
          <CardContent className="pt-6 text-muted-foreground text-sm">
            No historical data available yet. Data will appear here as months accumulate.
          </CardContent>
        </Card>
      </div>
    );
  }

  const chartData = summaries.map((s) => ({
    month: s.month,
    attainmentMax: s.attainmentMaxPct,
    attainmentMin: s.attainmentMinPct,
    avgDaily: s.avgDailyPcs,
    linearity: s.linearityIndex !== null ? s.linearityIndex * 100 : null,
    ragBand: s.ragBand,
  }));

  return (
    <div className="space-y-6 max-w-[1300px] mx-auto pb-10">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight mb-1 flex items-center gap-2">
          <TrendingUp className="h-7 w-7 text-primary" /> Month-over-Month Trend
        </h1>
        <p className="text-muted-foreground text-sm">
          Historical plant attainment, daily rate, and linearity · {summaries.length} month{summaries.length !== 1 ? "s" : ""} of data
        </p>
      </header>

      {/* Attainment trend */}
      <Card>
        <CardHeader>
          <CardTitle>Max PP Attainment % (Monthly Final)</CardTitle>
          <CardDescription>Green = ≥100%, Amber = 90–100%, Red = &lt;90%</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} unit="%" domain={[0, 130]} />
              <Tooltip formatter={(v: number) => [`${v?.toFixed(1)}%`, "Max PP Attainment"]} />
              <Bar dataKey="attainmentMax" name="Max PP %" radius={[4, 4, 0, 0]}>
                {chartData.map((d, i) => (
                  <Cell key={i} fill={RAG[d.ragBand as keyof typeof RAG] ?? RAG.null} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Daily rate + linearity */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle>Average Daily Output (pcs)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => [v.toLocaleString(), "pcs/day"]} />
                <Line type="monotone" dataKey="avgDaily" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Linearity Index</CardTitle>
            <CardDescription>100 = perfectly linear; below 60 = back-loaded</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} unit="" domain={[0, 120]} />
                <Tooltip formatter={(v: number) => [`${v?.toFixed(0)}`, "Linearity (×100)"]} />
                <Line type="monotone" dataKey="linearity" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 4 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Monthly summary table */}
      <Card>
        <CardHeader><CardTitle>Monthly Summary</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 text-muted-foreground text-right">
                  <th className="text-left py-2 pr-4 font-medium">Month</th>
                  <th className="py-2 pr-4 font-medium">WD</th>
                  <th className="py-2 pr-4 font-medium">Max PP</th>
                  <th className="py-2 pr-4 font-medium">Min PP</th>
                  <th className="py-2 pr-4 font-medium">Produced</th>
                  <th className="py-2 pr-4 font-medium">Max Att %</th>
                  <th className="py-2 pr-4 font-medium">Min Att %</th>
                  <th className="py-2 pr-4 font-medium">Avg/Day</th>
                  <th className="py-2 pr-4 font-medium">Linearity</th>
                  <th className="py-2 pr-4 font-medium">Best Cat</th>
                  <th className="py-2 font-medium">Worst Cat</th>
                </tr>
              </thead>
              <tbody>
                {summaries.map((s) => (
                  <tr key={s.month} className={`border-b border-border/20 hover:bg-muted/20 text-right ${s.month === month ? "bg-primary/5" : ""}`}>
                    <td className="py-2 pr-4 text-left font-medium font-mono">{s.month}{s.month === month && <Badge variant="outline" className="ml-2 text-xs">current</Badge>}</td>
                    <td className="py-2 pr-4">{s.workingDays}</td>
                    <td className="py-2 pr-4 font-mono">{fmt(s.targetMax)}</td>
                    <td className="py-2 pr-4 font-mono text-muted-foreground">{fmt(s.targetMin)}</td>
                    <td className="py-2 pr-4 font-mono">{fmt(s.producedTotal)}</td>
                    <td className={`py-2 pr-4 font-mono font-semibold ${s.ragBand === "green" ? "text-emerald-600" : s.ragBand === "amber" ? "text-amber-600" : "text-red-500"}`}>{pct(s.attainmentMaxPct)}</td>
                    <td className="py-2 pr-4 font-mono text-muted-foreground">{pct(s.attainmentMinPct)}</td>
                    <td className="py-2 pr-4 font-mono">{fmt(s.avgDailyPcs, 0)}</td>
                    <td className="py-2 pr-4 font-mono">{s.linearityIndex !== null ? s.linearityIndex.toFixed(2) : "–"}</td>
                    <td className="py-2 pr-4 text-xs text-emerald-600">{s.bestCategory ?? "–"}</td>
                    <td className="py-2 text-xs text-red-500">{s.worstCategory ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

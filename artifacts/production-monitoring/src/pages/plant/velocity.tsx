import { useGetPlantBundle, getGetPlantBundleQueryKey, type PlantBundle } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ResponsiveContainer } from "recharts";
import { Download, FileSpreadsheet } from "lucide-react";
import { fmtDate } from "@/lib/utils";
import { exportXlsx } from "@/lib/excel";

function downloadPdf(month: string, section: string) {
  const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
  window.open(`${base}/api/plant/export/pdf?month=${month}&section=${section}`, "_blank");
}

function fmt(n: number | null | undefined, d = 0) {
  if (n === null || n === undefined) return "–";
  return n.toLocaleString(undefined, { maximumFractionDigits: d });
}

export default function PlantVelocity({ month }: { month: string }) {
  const { data, isLoading } = useGetPlantBundle(
    { month },
    { query: { queryKey: getGetPlantBundleQueryKey({ month }) } }
  );

  if (isLoading) return <div className="flex items-center justify-center h-64 text-muted-foreground">Loading...</div>;
  if (!data) return <div className="text-red-500 p-4">Failed to load plant data.</div>;
  const bundle = data as unknown as PlantBundle;

  const { plant, dailySeries, context } = bundle;
  const chartData = dailySeries.map((d) => ({
    day: `D${d.workingDayNum}`,
    date: d.date,
    actual: d.actualPcs > 0 || d.workingDayNum <= context.elapsed ? d.actualPcs : null,
    cumActual: d.workingDayNum <= context.elapsed ? d.cumulativeActual : null,
    cumRequired: d.cumulativeRequired,
    required: d.requiredPerDay,
  }));

  return (
    <div className="space-y-6 max-w-[1300px] mx-auto pb-10">
      <header className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight mb-1">Plant Velocity</h1>
            <p className="text-muted-foreground text-sm">
              Daily output and burn-up chart in pieces (NOS) — {month} · {context.elapsed}/{context.workingDays} days elapsed
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => exportXlsx(`plant-velocity-${month}`, [
              { name: "Daily Series", rows: (bundle.dailySeries || []).map((d: any) => ({ Date: d.date, DayOfMonth: d.dayOfMonth, DailyOutput: d.dailyOutput, CumulativeOutput: d.cumulativeOutput, RequiredCumulative: d.requiredCumulative, TargetMax: d.targetMax })) },
            ])}>
              <FileSpreadsheet className="h-4 w-4 mr-2" /> Export Excel
            </Button>
            <Button variant="outline" size="sm" onClick={() => downloadPdf(month, "velocity")}>
              <Download className="h-4 w-4 mr-2" /> Export PDF
            </Button>
          </div>
        </div>
      </header>

      {/* Headline KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: "Actual/Day", value: fmt(plant.actualPerDay, 0), sub: "pcs/day" },
          { label: "Required/Day", value: fmt(plant.requiredPerDay, 0), sub: "pcs/day" },
          { label: "Cum Attainment", value: plant.attainmentCumPct !== null ? `${plant.attainmentCumPct.toFixed(1)}%` : "–", sub: "vs required cum" },
          { label: "Projected End", value: plant.projectedAttainmentPct !== null ? `${plant.projectedAttainmentPct.toFixed(1)}%` : "–", sub: "of Max PP" },
          { label: "Linearity", value: plant.linearityIndex !== null ? plant.linearityIndex.toFixed(2) : "–", sub: plant.linearityIndex !== null && plant.linearityIndex < 0.6 ? "⚠ back-loaded" : "1.0 = perfect" },
        ].map((k) => (
          <Card key={k.label}>
            <CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground uppercase tracking-wider">{k.label}</CardTitle></CardHeader>
            <CardContent><div className="text-xl font-bold">{k.value}</div><div className="text-xs text-muted-foreground">{k.sub}</div></CardContent>
          </Card>
        ))}
      </div>

      {/* Burn-up chart */}
      <Card>
        <CardHeader><CardTitle>Cumulative Burn-up</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} interval={3} />
              <YAxis yAxisId="cum" tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <YAxis yAxisId="daily" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(1)}k`} />
              <Tooltip formatter={(v: number) => v?.toLocaleString()} labelFormatter={(l, p) => `${l} (${fmtDate(p?.[0]?.payload?.date) ?? ""})`} />
              <Legend />
              <Line yAxisId="cum" type="monotone" dataKey="cumRequired" name="Required Cumulative" stroke="#94a3b8" strokeDasharray="5 5" dot={false} strokeWidth={1.5} />
              <Line yAxisId="cum" type="monotone" dataKey="cumActual" name="Actual Cumulative" stroke="#3b82f6" dot={false} strokeWidth={2} connectNulls />
              <Bar yAxisId="daily" dataKey="actual" name="Daily Output (pcs)" fill="#3b82f6" fillOpacity={0.25} barSize={8} />
              <ReferenceLine yAxisId="daily" y={plant.requiredPerDay} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: "Req/Day", fontSize: 10, fill: "#94a3b8" }} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Day-by-day table */}
      <Card>
        <CardHeader><CardTitle>Day-by-day Breakdown</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 text-muted-foreground">
                  <th className="text-left py-2 pr-4 font-medium">Day</th>
                  <th className="text-left py-2 pr-4 font-medium">Date</th>
                  <th className="text-right py-2 pr-4 font-medium">Actual (pcs)</th>
                  <th className="text-right py-2 pr-4 font-medium">Required (pcs)</th>
                  <th className="text-right py-2 pr-4 font-medium">Cum Actual</th>
                  <th className="text-right py-2 font-medium">Cum Required</th>
                </tr>
              </thead>
              <tbody>
                {dailySeries.filter((d) => d.workingDayNum <= context.elapsed).map((d) => {
                  const gap = d.cumulativeActual - d.cumulativeRequired;
                  return (
                    <tr key={d.date} className="border-b border-border/20 hover:bg-muted/20">
                      <td className="py-1.5 pr-4 font-mono">D{d.workingDayNum}</td>
                      <td className="py-1.5 pr-4 text-muted-foreground">{fmtDate(d.date)}</td>
                      <td className="py-1.5 pr-4 text-right font-mono">{d.actualPcs.toLocaleString()}</td>
                      <td className="py-1.5 pr-4 text-right text-muted-foreground font-mono">{d.requiredPerDay.toLocaleString()}</td>
                      <td className="py-1.5 pr-4 text-right font-mono">{d.cumulativeActual.toLocaleString()}</td>
                      <td className={`py-1.5 text-right font-mono ${gap >= 0 ? "text-emerald-600" : "text-red-500"}`}>{gap >= 0 ? "+" : ""}{gap.toFixed(0)}</td>
                    </tr>
                  );
                })}
                {context.elapsed === 0 && (
                  <tr><td colSpan={6} className="py-4 text-center text-muted-foreground">No production days elapsed yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

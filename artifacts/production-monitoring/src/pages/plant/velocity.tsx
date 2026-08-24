import { useGetPlantBundle, getGetPlantBundleQueryKey, type PlantBundle, useGetPlantWeeklySummary, getGetPlantWeeklySummaryQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
function pct(n: number | null | undefined) {
  if (n === null || n === undefined) return "–";
  return `${n.toFixed(1)}%`;
}

function weekIndexForDay(dayOfMonth: number): number {
  if (dayOfMonth <= 7) return 0;
  if (dayOfMonth <= 14) return 1;
  if (dayOfMonth <= 21) return 2;
  return 3;
}

const RAG_COLORS = { green: "#10b981", amber: "#f59e0b", red: "#ef4444", null: "#94a3b8" };

export default function PlantVelocity({ month, selectedCategory }: { month: string; selectedCategory?: string | null }) {
  const { data, isLoading } = useGetPlantBundle(
    { month },
    { query: { queryKey: getGetPlantBundleQueryKey({ month }) } }
  );
  const { data: weeklyRaw } = useGetPlantWeeklySummary(
    { month },
    { query: { queryKey: getGetPlantWeeklySummaryQueryKey({ month }) } as any }
  );

  if (isLoading) return <div className="flex items-center justify-center h-64 text-muted-foreground">Loading...</div>;
  if (!data) return <div className="text-red-500 p-4">Failed to load plant data.</div>;
  const bundle = data as unknown as PlantBundle;
  const weekly = weeklyRaw as any;

  const { plant, dailySeries, context } = bundle;

  const catKPIs = selectedCategory
    ? (bundle.categories as any[]).find((c) => c.category === selectedCategory)
    : null;

  const kpis = catKPIs ?? plant;

  // --- Weekly step function for cumulative released ---
  const weekTargets: number[] = weekly?.plant?.weeks?.map((w: any) => w.target) ?? [];
  const wkCum: number[] = [0, 0, 0, 0];
  if (weekTargets.length === 4) {
    wkCum[0] = weekTargets[0];
    wkCum[1] = weekTargets[0] + weekTargets[1];
    wkCum[2] = weekTargets[0] + weekTargets[1] + weekTargets[2];
    wkCum[3] = weekTargets[0] + weekTargets[1] + weekTargets[2] + weekTargets[3];
  }
  const hasWeeklyTargets = wkCum[3] > 0;

  const chartData = dailySeries.map((d) => {
    const dayOfMonth = parseInt(d.date.slice(8), 10);
    const wkIdx = weekIndexForDay(dayOfMonth);
    return {
      day: d.isNonCalendarWorkingDay ? "Sun · worked" : `D${d.workingDayNum}`,
      date: d.date,
      actual: d.actualPcs > 0 || d.workingDayNum <= context.elapsed ? d.actualPcs : null,
      cumActual: d.workingDayNum <= context.elapsed ? d.cumulativeActual : null,
      cumRequired: d.cumulativeRequired,
      cumReleased: hasWeeklyTargets ? wkCum[wkIdx] : null,
      required: d.requiredPerDay,
    };
  });

  const workedNonCalendarDays = dailySeries.filter((d) => d.isNonCalendarWorkingDay);
  const calendarElapsedDays = dailySeries.length - workedNonCalendarDays.length;
  const dayComposition = `${calendarElapsedDays} calendar workdays + ${workedNonCalendarDays.length} worked non-calendar day${workedNonCalendarDays.length === 1 ? "" : "s"}`;

  const kpiCards = [
    { label: "Actual/Day", value: fmt(kpis.actualPerDay, 0), sub: "pcs/day" },
    { label: "Required/Day", value: fmt(kpis.requiredPerDay, 0), sub: "pcs/day" },
    { label: "Cum Attainment", value: kpis.attainmentCumPct !== null ? `${(kpis.attainmentCumPct as number).toFixed(1)}%` : "–", sub: "vs required cum" },
    { label: "Projected End", value: kpis.projectedAttainmentPct !== null ? `${(kpis.projectedAttainmentPct as number).toFixed(1)}%` : "–", sub: "of Max PP" },
    { label: "Linearity", value: kpis.linearityIndex !== null ? (kpis.linearityIndex as number).toFixed(2) : "–", sub: kpis.linearityIndex !== null && (kpis.linearityIndex as number) < 0.6 ? "⚠ back-loaded" : "1.0 = perfect" },
  ];

  return (
    <div className="space-y-6 max-w-[1300px] mx-auto pb-10">
      <header className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight mb-1">
              Plant Velocity
              {catKPIs && <span className="ml-2 text-lg font-normal text-muted-foreground">— {selectedCategory}</span>}
            </h1>
            <p className="text-muted-foreground text-sm">
              Daily output and burn-up chart in pieces (NOS) — {month} · {context.elapsed}/{context.workingDays} working days elapsed ({dayComposition})
              {context.snapshotDate && <span className="ml-1 text-xs">· data through <span className="font-medium text-foreground">{fmtDate(context.snapshotDate)}</span></span>}
              {catKPIs && <span className="ml-2 text-xs text-muted-foreground">· KPIs showing {selectedCategory} · burn-up chart is plant-level</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => exportXlsx(`plant-velocity-${month}`, [
              { name: "Daily Series", rows: (bundle.dailySeries || []).map((d: any) => ({ Date: d.date, DayOfMonth: d.dayOfMonth, DailyOutput: d.actualPcs, CumulativeOutput: d.cumulativeActual, RequiredCumulative: d.cumulativeRequired, TargetMax: plant.targetMax })) },
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
        {kpiCards.map((k) => (
          <Card key={k.label}>
            <CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground uppercase tracking-wider">{k.label}</CardTitle></CardHeader>
            <CardContent><div className="text-xl font-bold">{k.value}</div><div className="text-xs text-muted-foreground">{k.sub}</div></CardContent>
          </Card>
        ))}
      </div>

      {/* Category comparison table when a category is selected */}
      {catKPIs && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Category vs. Plant</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 text-muted-foreground">
                  <th className="text-left py-2 pr-4 font-medium">Metric</th>
                  <th className="text-right py-2 pr-4 font-medium">{selectedCategory}</th>
                  <th className="text-right py-2 font-medium">Plant Total</th>
                </tr>
              </thead>
              <tbody className="text-xs">
                {[
                  { label: "Target Max (pcs)", cat: (catKPIs as any).targetMax, plant: plant.targetMax },
                  { label: "Target Min (pcs)", cat: (catKPIs as any).targetMin, plant: plant.targetMin },
                  { label: "Produced to Date", cat: (catKPIs as any).producedToDate, plant: plant.producedToDate },
                  { label: "Required/Day", cat: (catKPIs as any).requiredPerDay, plant: plant.requiredPerDay },
                  { label: "Actual/Day", cat: (catKPIs as any).actualPerDay, plant: plant.actualPerDay },
                  { label: "Cum Attainment %", cat: (catKPIs as any).attainmentCumPct, plant: plant.attainmentCumPct, pctFlag: true },
                  { label: "Projected End %", cat: (catKPIs as any).projectedAttainmentPct, plant: plant.projectedAttainmentPct, pctFlag: true },
                  { label: "Days Ahead/Behind", cat: (catKPIs as any).daysAheadBehind, plant: plant.daysAheadBehind, signed: true },
                  { label: "Linearity", cat: (catKPIs as any).linearityIndex, plant: plant.linearityIndex, dec: 2 },
                ].map((row) => (
                  <tr key={row.label} className="border-b border-border/20 hover:bg-muted/20">
                    <td className="py-1.5 pr-4 text-muted-foreground">{row.label}</td>
                    <td className="py-1.5 pr-4 text-right font-mono font-medium">
                      {row.cat == null ? "–" : row.pctFlag ? `${Number(row.cat).toFixed(1)}%` : row.signed ? `${Number(row.cat) > 0 ? "+" : ""}${Number(row.cat).toFixed(1)}` : Number(row.cat).toLocaleString(undefined, { maximumFractionDigits: row.dec ?? 0 })}
                    </td>
                    <td className="py-1.5 text-right font-mono text-muted-foreground">
                      {row.plant == null ? "–" : row.pctFlag ? `${Number(row.plant).toFixed(1)}%` : row.signed ? `${Number(row.plant) > 0 ? "+" : ""}${Number(row.plant).toFixed(1)}` : Number(row.plant).toLocaleString(undefined, { maximumFractionDigits: row.dec ?? 0 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Weekly step function context */}
      {hasWeeklyTargets && weekly?.plant?.weeks && (
        <div className="grid grid-cols-4 gap-3">
          {(weekly.plant.weeks as any[]).map((wk: any, i: number) => {
            const isCurrent = weekly.currentWeek === wk.week;
            const rag = wk.ragBand;
            const borderCls = isCurrent
              ? "border-primary/60 bg-primary/5"
              : rag === "green" ? "border-emerald-500/30 bg-emerald-500/5"
              : rag === "amber" ? "border-amber-500/30 bg-amber-500/5"
              : rag === "red" ? "border-red-500/30 bg-red-500/5"
              : "border-border";
            const textCls = rag === "green" ? "text-emerald-600" : rag === "amber" ? "text-amber-600" : rag === "red" ? "text-red-500" : "text-muted-foreground";
            const label = weekly.weekCalendar?.[i]?.label ?? `W${wk.week}`;
            return (
              <Card key={wk.week} className={`border ${borderCls}`}>
                <CardHeader className="pb-1 pt-3 px-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-xs font-semibold uppercase tracking-wider">{label}</CardTitle>
                    {isCurrent && <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">current</Badge>}
                  </div>
                </CardHeader>
                <CardContent className="px-3 pb-3 space-y-0.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Released</span>
                    <span className="font-mono font-medium">{fmt(wk.target)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Actual</span>
                    <span className="font-mono font-medium">{fmt(wk.actual)}</span>
                  </div>
                  {wk.carryover > 0 && (
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Carry-in</span>
                      <span className="font-mono text-amber-600">+{fmt(wk.carryover)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-xs pt-1 border-t border-border/30 mt-1">
                    <span className="text-muted-foreground">Attainment</span>
                    <span className={`font-mono font-bold ${textCls}`}>{pct(wk.attainmentPct)}</span>
                  </div>
                  {wk.gap > 0 && wk.attainmentPct !== null && (
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Gap</span>
                      <span className="font-mono text-red-500">{fmt(wk.gap)}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Burn-up chart — step function line for released cumulative */}
      <Card>
        <CardHeader>
          <CardTitle>
            Cumulative Burn-up{hasWeeklyTargets ? " — Weekly Release (Step) vs Actual" : ""}
            {catKPIs && <span className="ml-2 text-xs font-normal text-muted-foreground">(plant-level)</span>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} interval={3} />
              <YAxis yAxisId="cum" tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <YAxis yAxisId="daily" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(1)}k`} />
              <Tooltip formatter={(v: number) => v?.toLocaleString()} labelFormatter={(l, p) => `${l} (${fmtDate(p?.[0]?.payload?.date) ?? ""})`} />
              <Legend />
              {hasWeeklyTargets ? (
                <Line yAxisId="cum" type="stepAfter" dataKey="cumReleased" name="Released (Weekly Step)" stroke="#8b5cf6" strokeDasharray="6 3" dot={false} strokeWidth={2} connectNulls />
              ) : (
                <Line yAxisId="cum" type="monotone" dataKey="cumRequired" name="Required Cumulative" stroke="#94a3b8" strokeDasharray="5 5" dot={false} strokeWidth={1.5} />
              )}
              <Line yAxisId="cum" type="monotone" dataKey="cumActual" name="Actual Cumulative" stroke="#3b82f6" dot={false} strokeWidth={2} connectNulls />
              <Bar yAxisId="daily" dataKey="actual" name="Daily Output (pcs)" fill="#3b82f6" fillOpacity={0.25} barSize={8} />
              <ReferenceLine yAxisId="daily" y={plant.requiredPerDay} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: "Req/Day", fontSize: 10, fill: "#94a3b8" }} />
            </ComposedChart>
          </ResponsiveContainer>
          {workedNonCalendarDays.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-amber-700">Worked non-calendar days:</span>
              {workedNonCalendarDays.map((day) => (
                <Badge key={day.date} variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
                  {new Date(`${day.date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })} — worked
                </Badge>
              ))}
            </div>
          )}
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
                  <th className="text-right py-2 pr-4 font-medium">Week</th>
                  <th className="text-right py-2 pr-4 font-medium">Actual (pcs)</th>
                  <th className="text-right py-2 pr-4 font-medium">Required (pcs)</th>
                  <th className="text-right py-2 pr-4 font-medium">Cum Actual</th>
                  <th className="text-right py-2 font-medium">Cum vs Released</th>
                </tr>
              </thead>
              <tbody>
                {dailySeries.map((d) => {
                  const dayOfMonth = parseInt(d.date.slice(8), 10);
                  const wkIdx = weekIndexForDay(dayOfMonth);
                  const released = hasWeeklyTargets ? wkCum[wkIdx] : d.cumulativeRequired;
                  const gap = d.cumulativeActual - released;
                  const wkLabel = `W${wkIdx + 1}`;
                  return (
                    <tr key={d.date} className="border-b border-border/20 hover:bg-muted/20">
                      <td className="py-1.5 pr-4 font-mono">D{d.workingDayNum}</td>
                      <td className="py-1.5 pr-4 text-muted-foreground">
                        <span>{fmtDate(d.date)}</span>
                        {d.isNonCalendarWorkingDay && (
                          <Badge variant="outline" className="ml-2 border-amber-300 bg-amber-50 px-1.5 py-0 text-[10px] font-medium text-amber-700">
                            Sun — worked
                          </Badge>
                        )}
                      </td>
                      <td className="py-1.5 pr-4 text-right font-mono text-muted-foreground">{wkLabel}</td>
                      <td className="py-1.5 pr-4 text-right font-mono">{d.actualPcs.toLocaleString()}</td>
                      <td className="py-1.5 pr-4 text-right text-muted-foreground font-mono">{d.requiredPerDay.toLocaleString()}</td>
                      <td className="py-1.5 pr-4 text-right font-mono">{d.cumulativeActual.toLocaleString()}</td>
                      <td className={`py-1.5 text-right font-mono ${gap >= 0 ? "text-emerald-600" : "text-red-500"}`}>{gap >= 0 ? "+" : ""}{gap.toFixed(0)}</td>
                    </tr>
                  );
                })}
                {context.elapsed === 0 && (
                  <tr><td colSpan={7} className="py-4 text-center text-muted-foreground">No production days elapsed yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

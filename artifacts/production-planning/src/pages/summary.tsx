import { useGetPlanSummary, useListPlanItems, type PlanSummary, type PlanItem, useGetPlantWeeklySummary, getGetPlantWeeklySummaryQueryKey, useCreatePlanRun } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/app-layout";
import { categorySlug } from "@/lib/category-slug";
import { useSegment } from "@/contexts/segment-context";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { currentMonth, formatMonthLabel } from "@/lib/month";
import { cn } from "@/lib/utils";
import { FileSpreadsheet, RefreshCw } from "lucide-react";
import { exportXlsx } from "@/lib/excel";
import { useToast } from "@/hooks/use-toast";

function ragBadge(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) return "";
  if (pct >= 85) return "bg-green-100 text-green-800";
  if (pct >= 60) return "bg-yellow-100 text-yellow-800";
  return "bg-red-100 text-red-800";
}

interface WeeklyTotals {
  category: string;
  w1: number;
  w2: number;
  w3: number;
  w4: number;
  unscheduled: number;
}

function computeWeeklyTotals(items: PlanItem[]): WeeklyTotals[] {
  const map = new Map<string, WeeklyTotals>();
  for (const item of items) {
    if (item.maxProduction <= 0) continue;
    const existing = map.get(item.category) ?? { category: item.category, w1: 0, w2: 0, w3: 0, w4: 0, unscheduled: 0 };
    existing.w1 += item.w1;
    existing.w2 += item.w2;
    existing.w3 += item.w3;
    existing.w4 += item.w4;
    if (item.week === null && item.cover !== "OS") {
      existing.unscheduled += item.maxProduction;
    }
    map.set(item.category, existing);
  }
  return [...map.values()];
}

const WEEK_COLORS = {
  1: { cell: "bg-orange-50/40 text-orange-900", header: "bg-orange-50 text-orange-800" },
  2: { cell: "bg-yellow-50/40 text-yellow-900", header: "bg-yellow-50 text-yellow-800" },
  3: { cell: "bg-green-50/40 text-green-900",  header: "bg-green-50 text-green-800" },
  4: { cell: "bg-blue-50/40 text-blue-900",    header: "bg-blue-50 text-blue-800" },
} as const;

function WeekCell({
  plan,
  attainmentPct,
  isLoading,
  colorClass,
}: {
  plan: number;
  attainmentPct: number | null | undefined;
  isLoading: boolean;
  colorClass: string;
}) {
  const hasData = attainmentPct !== null && attainmentPct !== undefined;
  return (
    <TableCell className={cn("text-right align-top font-mono", colorClass)}>
      <div className="flex flex-col items-end gap-0.5">
        <span>{plan > 0 ? plan.toLocaleString(undefined, { maximumFractionDigits: 0 }) : isLoading ? "…" : "—"}</span>
        {plan > 0 && (
          hasData ? (
            <span className={cn("text-[10px] px-1.5 py-0 rounded font-semibold leading-4", ragBadge(attainmentPct))}>
              {attainmentPct!.toFixed(1)}%
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground/40 leading-4">–</span>
          )
        )}
      </div>
    </TableCell>
  );
}

export default function SummaryPage() {
  const month = currentMonth();
  const { segment } = useSegment();
  const { data, isLoading, isError } = useGetPlanSummary({ month, segment });
  const createRun = useCreatePlanRun();
  const { toast } = useToast();

  function handleRunPlan() {
    createRun.mutate(
      { data: { month, segment } },
      {
        onSuccess: () =>
          toast({ title: "Plan run created", description: `Snapshot for ${formatMonthLabel(month)} saved to Plan Runs.` }),
        onError: () =>
          toast({ title: "Failed to create run", description: "Check that all data sources are available.", variant: "destructive" }),
      },
    );
  }
  const { data: itemsData, isLoading: itemsLoading } = useListPlanItems(
    { month, segment },
    { query: { staleTime: 5 * 60 * 1000 } as any },
  );
  const { data: weeklyRaw } = useGetPlantWeeklySummary(
    { month },
    { query: { queryKey: getGetPlantWeeklySummaryQueryKey({ month }) } as any },
  );

  const summary = data as unknown as PlanSummary | undefined;
  const categories = summary?.categories ?? [];
  const grandMin = summary?.grandMinTotal ?? 0;
  const grandMax = summary?.grandMaxTotal ?? 0;

  const allItems = (itemsData as unknown as PlanItem[] | undefined) ?? [];
  const weeklyTotals = computeWeeklyTotals(allItems);
  const grandW1 = weeklyTotals.reduce((s, t) => s + t.w1, 0);
  const grandW2 = weeklyTotals.reduce((s, t) => s + t.w2, 0);
  const grandW3 = weeklyTotals.reduce((s, t) => s + t.w3, 0);
  const grandW4 = weeklyTotals.reduce((s, t) => s + t.w4, 0);
  const grandUnscheduled = weeklyTotals.reduce((s, t) => s + t.unscheduled, 0);

  const weekly = weeklyRaw as any;

  // Build lookup: category → { w1Pct, w2Pct, w3Pct, w4Pct }
  type WeekPcts = { w1Pct: number | null; w2Pct: number | null; w3Pct: number | null; w4Pct: number | null };
  const weeklyPctMap = new Map<string, WeekPcts>();
  if (weekly?.categories) {
    for (const catRow of weekly.categories as any[]) {
      const pcts: WeekPcts = { w1Pct: null, w2Pct: null, w3Pct: null, w4Pct: null };
      for (const wk of catRow.weeks as any[]) {
        if (wk.week === 1) pcts.w1Pct = wk.attainmentPct;
        if (wk.week === 2) pcts.w2Pct = wk.attainmentPct;
        if (wk.week === 3) pcts.w3Pct = wk.attainmentPct;
        if (wk.week === 4) pcts.w4Pct = wk.attainmentPct;
      }
      weeklyPctMap.set(catRow.category, pcts);
    }
  }

  // Plant-level weekly attainment for the totals row
  const plantWeeks: any[] = weekly?.plant?.weeks ?? [];
  const plantWeekPct = (w: number): number | null =>
    plantWeeks.find((pw: any) => pw.week === w)?.attainmentPct ?? null;

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Summary — {formatMonthLabel(month)}</h2>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handleRunPlan}
              disabled={createRun.isPending}
            >
              <RefreshCw className={cn("h-4 w-4 mr-2", createRun.isPending && "animate-spin")} />
              {createRun.isPending ? "Running plan…" : "Run Plan now"}
            </Button>
            {!isLoading && !isError && (
              <Button variant="outline" size="sm" onClick={() => exportXlsx(`plan-summary-${month}`, [
                { name: "Summary", rows: categories.map((cat) => {
                  const wt = weeklyTotals.find((t) => t.category === cat.category);
                  const pcts = weeklyPctMap.get(cat.category);
                  return {
                    Category: cat.category,
                    MinRequired: cat.minTotal,
                    MaxPlan: cat.maxTotal,
                    W1_Plan: wt?.w1 ?? 0,
                    W1_Ach_Pct: pcts?.w1Pct ?? "",
                    W2_Plan: wt?.w2 ?? 0,
                    W2_Ach_Pct: pcts?.w2Pct ?? "",
                    W3_Plan: wt?.w3 ?? 0,
                    W3_Ach_Pct: pcts?.w3Pct ?? "",
                    W4_Plan: wt?.w4 ?? 0,
                    W4_Ach_Pct: pcts?.w4Pct ?? "",
                    Unscheduled: wt?.unscheduled ?? 0,
                  };
                }) },
              ])}>
                <FileSpreadsheet className="h-4 w-4 mr-2" /> Export Excel
              </Button>
            )}
          </div>
        </div>

        {isLoading && <p className="text-sm text-gray-500">Loading summary...</p>}
        {isError && (
          <p className="text-sm text-red-600">
            Could not load the summary. Make sure the required data sources are uploaded/synced.
          </p>
        )}

        {!isLoading && !isError && (
          <Card>
            <CardContent className="pt-4 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Min Reqd</TableHead>
                    <TableHead className="text-right">Max / Plan</TableHead>
                    <TableHead className={cn("text-right", WEEK_COLORS[1].header)}>
                      W1
                      <div className="text-[9px] font-normal opacity-70">days 1–7</div>
                    </TableHead>
                    <TableHead className={cn("text-right", WEEK_COLORS[2].header)}>
                      W2
                      <div className="text-[9px] font-normal opacity-70">days 8–14</div>
                    </TableHead>
                    <TableHead className={cn("text-right", WEEK_COLORS[3].header)}>
                      W3
                      <div className="text-[9px] font-normal opacity-70">days 15–21</div>
                    </TableHead>
                    <TableHead className={cn("text-right", WEEK_COLORS[4].header)}>
                      W4
                      <div className="text-[9px] font-normal opacity-70">days 22–end</div>
                    </TableHead>
                    <TableHead className="text-right text-gray-500">Unscheduled</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categories.map((cat, idx) => {
                    const wt = weeklyTotals.find((t) => t.category === cat.category);
                    const pcts = weeklyPctMap.get(cat.category);
                    return (
                      <TableRow key={cat.category}>
                        <TableCell>
                          <Link
                            href={`/category/${categorySlug(cat.category)}`}
                            className="text-primary hover:underline"
                          >
                            REPORT {idx + 1} — {cat.category}
                          </Link>
                        </TableCell>
                        <TableCell className="text-right">
                          {cat.minTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </TableCell>
                        <TableCell className="text-right">
                          {cat.maxTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </TableCell>
                        <WeekCell plan={wt?.w1 ?? 0} attainmentPct={pcts?.w1Pct} isLoading={itemsLoading} colorClass={WEEK_COLORS[1].cell} />
                        <WeekCell plan={wt?.w2 ?? 0} attainmentPct={pcts?.w2Pct} isLoading={itemsLoading} colorClass={WEEK_COLORS[2].cell} />
                        <WeekCell plan={wt?.w3 ?? 0} attainmentPct={pcts?.w3Pct} isLoading={itemsLoading} colorClass={WEEK_COLORS[3].cell} />
                        <WeekCell plan={wt?.w4 ?? 0} attainmentPct={pcts?.w4Pct} isLoading={itemsLoading} colorClass={WEEK_COLORS[4].cell} />
                        <TableCell className="text-right text-gray-500 font-mono">
                          {wt && wt.unscheduled > 0 ? wt.unscheduled.toLocaleString(undefined, { maximumFractionDigits: 0 }) : itemsLoading ? "…" : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow className="font-semibold border-t-2">
                    <TableCell>Total (Reports 1–7)</TableCell>
                    <TableCell className="text-right">
                      {grandMin.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </TableCell>
                    <TableCell className="text-right">
                      {grandMax.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </TableCell>
                    {([1, 2, 3, 4] as const).map((w) => {
                      const plan = [grandW1, grandW2, grandW3, grandW4][w - 1];
                      return (
                        <TableCell key={w} className={cn("text-right align-top font-mono", WEEK_COLORS[w].cell.replace("/40", "/60"))}>
                          <div className="flex flex-col items-end gap-0.5">
                            <span>{plan > 0 ? plan.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"}</span>
                            {plan > 0 && (() => {
                              const pct = plantWeekPct(w);
                              return pct !== null ? (
                                <span className={cn("text-[10px] px-1.5 py-0 rounded font-semibold leading-4", ragBadge(pct))}>
                                  {pct.toFixed(1)}%
                                </span>
                              ) : <span className="text-[10px] text-muted-foreground/40 leading-4">–</span>;
                            })()}
                          </div>
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-right text-gray-500 font-mono">
                      {grandUnscheduled > 0 ? grandUnscheduled.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              {weekly?.currentWeek && (
                <p className="text-[11px] text-muted-foreground mt-3 px-1">
                  Achievement % shown for elapsed/in-progress weeks only · current week: W{weekly.currentWeek} · RAG: <span className="text-green-700 font-medium">green ≥85%</span> · <span className="text-yellow-700 font-medium">amber ≥60%</span> · <span className="text-red-700 font-medium">red &lt;60%</span>
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}

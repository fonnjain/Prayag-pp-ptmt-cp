import { useGetPlanSummary, useListPlanItems, type PlanSummary, type PlanItem } from "@workspace/api-client-react";
import { AppLayout, categorySlug } from "@/components/layout/app-layout";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { FileSpreadsheet } from "lucide-react";
import { exportXlsx } from "@/lib/excel";

function achievementBand(pct: number): string {
  if (pct <= 75) return "bg-red-100 text-red-800";
  if (pct <= 90) return "bg-yellow-100 text-yellow-800";
  if (pct <= 110) return "bg-green-100 text-green-800";
  if (pct <= 140) return "bg-blue-100 text-blue-800";
  return "bg-purple-100 text-purple-800";
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

export default function SummaryPage() {
  const month = currentMonth();
  const { data, isLoading, isError } = useGetPlanSummary({ month });
  const { data: itemsData, isLoading: itemsLoading } = useListPlanItems(
    { month },
    { query: { staleTime: 5 * 60 * 1000 } as any },
  );

  const summary = data as unknown as PlanSummary | undefined;
  const categories = summary?.categories ?? [];
  const grandMin = summary?.grandMinTotal ?? 0;
  const grandMax = summary?.grandMaxTotal ?? 0;
  const achievementPct = grandMax > 0 ? (grandMin / grandMax) * 100 : 0;

  const allItems = (itemsData as unknown as PlanItem[] | undefined) ?? [];
  const weeklyTotals = computeWeeklyTotals(allItems);
  const grandW1 = weeklyTotals.reduce((s, t) => s + t.w1, 0);
  const grandW2 = weeklyTotals.reduce((s, t) => s + t.w2, 0);
  const grandW3 = weeklyTotals.reduce((s, t) => s + t.w3, 0);
  const grandW4 = weeklyTotals.reduce((s, t) => s + t.w4, 0);
  const grandUnscheduled = weeklyTotals.reduce((s, t) => s + t.unscheduled, 0);

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Summary — {formatMonthLabel(month)}</h2>
          {!isLoading && !isError && (
            <Button variant="outline" size="sm" onClick={() => exportXlsx(`plan-summary-${month}`, [
              { name: "Summary", rows: categories.map((cat) => {
                const p = cat.maxTotal > 0 ? (cat.minTotal / cat.maxTotal) * 100 : 0;
                const wt = weeklyTotals.find((t) => t.category === cat.category);
                return {
                  Category: cat.category,
                  MinRequired: cat.minTotal,
                  MaxPlan: cat.maxTotal,
                  AchievementPct: p,
                  W1: wt?.w1 ?? 0,
                  W2: wt?.w2 ?? 0,
                  W3: wt?.w3 ?? 0,
                  W4: wt?.w4 ?? 0,
                  Unscheduled: wt?.unscheduled ?? 0,
                };
              }) },
            ])}>
              <FileSpreadsheet className="h-4 w-4 mr-2" /> Export Excel
            </Button>
          )}
        </div>

        {isLoading && <p className="text-sm text-gray-500">Loading summary...</p>}
        {isError && (
          <p className="text-sm text-red-600">
            Could not load the summary. Make sure the required data sources are uploaded/synced.
          </p>
        )}

        {!isLoading && !isError && (
          <Card>
            <CardContent className="pt-6 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Min Reqd</TableHead>
                    <TableHead className="text-right">Max / Plan</TableHead>
                    <TableHead className="text-right">Achiev %</TableHead>
                    <TableHead className="text-right bg-orange-50 text-orange-800">W1</TableHead>
                    <TableHead className="text-right bg-yellow-50 text-yellow-800">W2</TableHead>
                    <TableHead className="text-right bg-green-50 text-green-800">W3</TableHead>
                    <TableHead className="text-right bg-blue-50 text-blue-800">W4</TableHead>
                    <TableHead className="text-right text-gray-500">Unscheduled</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categories.map((cat, idx) => {
                    const pct = cat.maxTotal > 0 ? (cat.minTotal / cat.maxTotal) * 100 : 0;
                    const wt = weeklyTotals.find((t) => t.category === cat.category);
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
                        <TableCell className="text-right">
                          <span className={cn("px-2 py-0.5 rounded text-xs font-medium", achievementBand(pct))}>
                            {pct.toFixed(1)}%
                          </span>
                        </TableCell>
                        <TableCell className="text-right bg-orange-50/40 text-orange-900 font-mono">
                          {wt && wt.w1 > 0 ? wt.w1.toLocaleString(undefined, { maximumFractionDigits: 0 }) : itemsLoading ? "…" : "—"}
                        </TableCell>
                        <TableCell className="text-right bg-yellow-50/40 text-yellow-900 font-mono">
                          {wt && wt.w2 > 0 ? wt.w2.toLocaleString(undefined, { maximumFractionDigits: 0 }) : itemsLoading ? "…" : "—"}
                        </TableCell>
                        <TableCell className="text-right bg-green-50/40 text-green-900 font-mono">
                          {wt && wt.w3 > 0 ? wt.w3.toLocaleString(undefined, { maximumFractionDigits: 0 }) : itemsLoading ? "…" : "—"}
                        </TableCell>
                        <TableCell className="text-right bg-blue-50/40 text-blue-900 font-mono">
                          {wt && wt.w4 > 0 ? wt.w4.toLocaleString(undefined, { maximumFractionDigits: 0 }) : itemsLoading ? "…" : "—"}
                        </TableCell>
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
                    <TableCell className="text-right">
                      <span className={cn("px-2 py-0.5 rounded text-xs font-medium", achievementBand(achievementPct))}>
                        {achievementPct.toFixed(1)}%
                      </span>
                    </TableCell>
                    <TableCell className="text-right bg-orange-100 text-orange-900 font-mono">
                      {grandW1 > 0 ? grandW1.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"}
                    </TableCell>
                    <TableCell className="text-right bg-yellow-100 text-yellow-900 font-mono">
                      {grandW2 > 0 ? grandW2.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"}
                    </TableCell>
                    <TableCell className="text-right bg-green-100 text-green-900 font-mono">
                      {grandW3 > 0 ? grandW3.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"}
                    </TableCell>
                    <TableCell className="text-right bg-blue-100 text-blue-900 font-mono">
                      {grandW4 > 0 ? grandW4.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-gray-500 font-mono">
                      {grandUnscheduled > 0 ? grandUnscheduled.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}

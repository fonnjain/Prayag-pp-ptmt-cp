import { useGetPlanSummary, type PlanSummary } from "@workspace/api-client-react";
import { AppLayout, categorySlug } from "@/components/layout/app-layout";
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
import { FileSpreadsheet } from "lucide-react";
import { exportXlsx } from "@/lib/excel";

function achievementBand(pct: number): string {
  if (pct <= 75) return "bg-red-100 text-red-800";
  if (pct <= 90) return "bg-yellow-100 text-yellow-800";
  if (pct <= 110) return "bg-green-100 text-green-800";
  if (pct <= 140) return "bg-blue-100 text-blue-800";
  return "bg-purple-100 text-purple-800";
}

export default function SummaryPage() {
  const month = currentMonth();
  const { data, isLoading, isError } = useGetPlanSummary({ month });

  const summary = data as unknown as PlanSummary | undefined;
  const categories = summary?.categories ?? [];
  const grandMin = summary?.grandMinTotal ?? 0;
  const grandMax = summary?.grandMaxTotal ?? 0;
  const achievementPct = grandMax > 0 ? (grandMin / grandMax) * 100 : 0;

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Summary — {formatMonthLabel(month)}</h2>
          {!isLoading && !isError && (
            <Button variant="outline" size="sm" onClick={() => exportXlsx(`plan-summary-${month}`, [
              { name: "Summary", rows: categories.map((cat) => {
                const p = cat.maxTotal > 0 ? (cat.minTotal / cat.maxTotal) * 100 : 0;
                return { Category: cat.category, MinRequired: cat.minTotal, MaxPlan: cat.maxTotal, AchievementPct: p };
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
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Min Production Required</TableHead>
                    <TableHead className="text-right">Max Production Required</TableHead>
                    <TableHead className="text-right">Achievement %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categories.map((cat, idx) => {
                    const pct = cat.maxTotal > 0 ? (cat.minTotal / cat.maxTotal) * 100 : 0;
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
                          <span
                            className={cn(
                              "px-2 py-0.5 rounded text-xs font-medium",
                              achievementBand(pct),
                            )}
                          >
                            {pct.toFixed(1)}%
                          </span>
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
                      <span
                        className={cn(
                          "px-2 py-0.5 rounded text-xs font-medium",
                          achievementBand(achievementPct),
                        )}
                      >
                        {achievementPct.toFixed(1)}%
                      </span>
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

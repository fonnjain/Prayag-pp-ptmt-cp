import { useState } from "react";
import { useParams } from "wouter";
import {
  useListPlanItems,
  useListWeeklyReleaseBands,
  useUpdateWeeklyReleaseBand,
  useListBufferCategories,
  type PlanItem,
  type WeeklyReleaseBand,
  type BufferCategory,
} from "@workspace/api-client-react";
import { AppLayout, categorySlug } from "@/components/layout/app-layout";
import { useSegment } from "@/contexts/segment-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { FileSpreadsheet, Settings2 } from "lucide-react";
import { exportXlsx } from "@/lib/excel";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const WEEK_ROW_CLS: Record<number, string> = {
  1: "bg-orange-50",
  2: "bg-yellow-50",
  3: "bg-green-50",
  4: "bg-blue-50",
};
const WEEK_BADGE_CLS: Record<number, string> = {
  1: "bg-orange-100 text-orange-800",
  2: "bg-yellow-100 text-yellow-800",
  3: "bg-green-100 text-green-800",
  4: "bg-blue-100 text-blue-800",
};

function coverLabel(cover: number | "OS"): string {
  if (cover === "OS") return "OS";
  return cover.toFixed(2);
}

function coverBadgeCls(cover: number | "OS"): string {
  if (cover === "OS") return "bg-gray-100 text-gray-500";
  if (cover < 0.3) return "bg-red-100 text-red-800 font-semibold";
  if (cover < 0.8) return "bg-yellow-100 text-yellow-800";
  return "bg-green-100 text-green-800";
}

function sortForWeeklyView(items: PlanItem[]): PlanItem[] {
  return [...items].sort((a, b) => {
    const wa = a.week ?? 99;
    const wb = b.week ?? 99;
    if (wa !== wb) return wa - wb;
    return b.maxProduction - a.maxProduction;
  });
}

interface BandEditorProps {
  band: WeeklyReleaseBand;
  category: string;
  onClose: () => void;
}

function BandEditor({ band, category, onClose }: BandEditorProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const mutation = useUpdateWeeklyReleaseBand();

  const [vals, setVals] = useState({
    w1Upper: String(band.w1Upper),
    w2Upper: String(band.w2Upper),
    w3Upper: String(band.w3Upper),
    w4Upper: String(band.w4Upper),
  });

  const handleSave = () => {
    const w1 = parseFloat(vals.w1Upper);
    const w2 = parseFloat(vals.w2Upper);
    const w3 = parseFloat(vals.w3Upper);
    const w4 = parseFloat(vals.w4Upper);
    if ([w1, w2, w3, w4].some(isNaN)) {
      toast({ title: "Invalid values", description: "All thresholds must be numbers.", variant: "destructive" });
      return;
    }
    if (!(w1 < w2 && w2 < w3 && w3 < w4)) {
      toast({ title: "Invalid order", description: "Thresholds must be strictly increasing: W1 < W2 < W3 < W4.", variant: "destructive" });
      return;
    }
    mutation.mutate(
      { category, data: { w1Upper: w1, w2Upper: w2, w3Upper: w3, w4Upper: w4 } },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: ["listWeeklyReleaseBands"] });
          toast({ title: "Bands updated", description: `Week thresholds saved for ${category}.` });
          onClose();
        },
        onError: () => {
          toast({ title: "Save failed", description: "Could not update the thresholds.", variant: "destructive" });
        },
      },
    );
  };

  return (
    <Card className="mt-3 border-dashed">
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm font-medium">Week Band Thresholds — {category}</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        <p className="text-xs text-gray-500">
          Cover ratio = Stock ÷ Avg 3-Mo Sale. Items are assigned to the week whose band their cover falls into.
          Bands are half-open: W1 = [0, W1 upper), W2 = [W1 upper, W2 upper), etc.
          Items with cover ≥ W4 upper are unscheduled.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(["w1Upper", "w2Upper", "w3Upper", "w4Upper"] as const).map((k, i) => (
            <div key={k} className="space-y-1">
              <label className="text-xs font-medium text-gray-700">W{i + 1} upper (months)</label>
              <Input
                type="number"
                step="0.1"
                min="0"
                value={vals[k]}
                onChange={(e) => setVals((v) => ({ ...v, [k]: e.target.value }))}
                className="h-8 text-sm"
              />
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={handleSave} disabled={mutation.isPending}>
            {mutation.isPending ? "Saving..." : "Save"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function CategoryPage() {
  const { slug } = useParams<{ slug: string }>();
  const { segment } = useSegment();
  const month = currentMonth();
  const [weeklyView, setWeeklyView] = useState(false);
  const [editingBands, setEditingBands] = useState(false);

  // Resolve category name dynamically from the API (supports PTMT + Plumbing)
  const { data: catData } = useListBufferCategories({ segment } as any);
  const allCategories = (catData as unknown as BufferCategory[] | undefined) ?? [];
  const category = allCategories.find((c) => categorySlug(c.name) === slug)?.name;

  const { data, isLoading, isError } = useListPlanItems(
    { month, segment, category: category ?? "" },
    { query: { enabled: Boolean(category) } as any },
  );

  const { data: bandsData } = useListWeeklyReleaseBands(
    { segment, ...(({} as any)) },
    { query: { enabled: Boolean(category) } as any },
  );
  const bands = (bandsData as unknown as WeeklyReleaseBand[] | undefined) ?? [];
  const categoryBand = bands.find((b) => b.categoryName === category);

  const allItems = [...((data as unknown as PlanItem[] | undefined) ?? [])];
  const items = weeklyView
    ? sortForWeeklyView(allItems)
    : [...allItems].sort((a, b) => b.maxProduction - a.maxProduction);

  const minTotal = items.reduce((s, i) => s + Math.max(i.minProduction, 0), 0);
  const maxTotal = items.reduce((s, i) => s + Math.max(i.maxProduction, 0), 0);
  const toProduceCount = items.filter((i) => i.maxProduction > 0).length;

  const w1Total = items.reduce((s, i) => s + i.w1, 0);
  const w2Total = items.reduce((s, i) => s + i.w2, 0);
  const w3Total = items.reduce((s, i) => s + i.w3, 0);
  const w4Total = items.reduce((s, i) => s + i.w4, 0);
  const scheduledCount = items.filter((i) => i.week !== null && i.maxProduction > 0).length;
  const unscheduledCount = items.filter((i) => i.week === null && i.maxProduction > 0 && i.cover !== "OS").length;
  const osCount = items.filter((i) => i.cover === "OS" && i.maxProduction > 0).length;

  const handleExport = () => {
    if (weeklyView) {
      exportXlsx(`plan-weekly-${category?.toLowerCase().replace(/\s+/g, "-")}-${month}`, [
        {
          name: "Weekly Release",
          rows: items.map((i) => ({
            ItemCode: i.itemCode,
            Colour: i.colour,
            Cover: i.cover === "OS" ? "OS" : i.cover,
            ProductionPlan: i.maxProduction,
            W1: i.w1 || undefined,
            W2: i.w2 || undefined,
            W3: i.w3 || undefined,
            W4: i.w4 || undefined,
            AssignedWeek: i.week ? `W${i.week}` : "-",
          })),
        },
      ]);
    } else {
      exportXlsx(`plan-${category?.toLowerCase().replace(/\s+/g, "-")}-${month}`, [
        {
          name: "Items",
          rows: items.map((i) => ({
            ItemCode: i.itemCode,
            Colour: i.colour,
            Cover: i.cover === "OS" ? "OS" : i.cover,
            Avg3MoSale: i.avg3MoSale,
            PendingOrder: i.pendingOrder,
            PendingOrderLastMonth: i.pendingOrderLastMonth,
            BufferReq: i.bufferReq,
            Stock: i.stock,
            MinProduction: i.minProduction,
            MaxProduction: i.maxProduction,
            Order: i.order,
          })),
        },
      ]);
    }
  };

  if (!category) {
    return (
      <AppLayout>
        <p className="text-sm text-red-600">Unknown category.</p>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold">{category}</h2>
            <p className="text-sm text-gray-500">{formatMonthLabel(month)}</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant={weeklyView ? "default" : "outline"}
              size="sm"
              onClick={() => { setWeeklyView((v) => !v); setEditingBands(false); }}
            >
              Weekly Release
            </Button>
            {!isLoading && !isError && items.length > 0 && (
              <Button variant="outline" size="sm" onClick={handleExport}>
                <FileSpreadsheet className="h-4 w-4 mr-2" /> Export Excel
              </Button>
            )}
          </div>
        </div>

        {!isLoading && !isError && (
          <div className="flex flex-wrap gap-2 text-sm">
            {weeklyView ? (
              <>
                <span className="px-3 py-1 rounded bg-orange-50 text-orange-800 border border-orange-200">
                  W1: <strong>{w1Total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong>
                </span>
                <span className="px-3 py-1 rounded bg-yellow-50 text-yellow-800 border border-yellow-200">
                  W2: <strong>{w2Total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong>
                </span>
                <span className="px-3 py-1 rounded bg-green-50 text-green-800 border border-green-200">
                  W3: <strong>{w3Total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong>
                </span>
                <span className="px-3 py-1 rounded bg-blue-50 text-blue-800 border border-blue-200">
                  W4: <strong>{w4Total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong>
                </span>
                <span className="px-3 py-1 rounded bg-gray-100 text-gray-600 border border-gray-200">
                  Scheduled: <strong>{scheduledCount}</strong>
                </span>
                {unscheduledCount > 0 && (
                  <span className="px-3 py-1 rounded bg-gray-100 text-gray-500 border border-gray-200">
                    Unscheduled: <strong>{unscheduledCount}</strong>
                  </span>
                )}
                {osCount > 0 && (
                  <span className="px-3 py-1 rounded bg-gray-100 text-gray-400 border border-gray-200">
                    OS: <strong>{osCount}</strong>
                  </span>
                )}
              </>
            ) : (
              <>
                <span className="px-3 py-1 rounded bg-gray-100">
                  Min Required: <strong>{minTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong>
                </span>
                <span className="px-3 py-1 rounded bg-gray-100">
                  Max / Plan: <strong>{maxTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong>
                </span>
                <span className="px-3 py-1 rounded bg-gray-100">
                  Items to produce: <strong>{toProduceCount}</strong>
                </span>
              </>
            )}
          </div>
        )}

        {isLoading && <p className="text-sm text-gray-500">Loading...</p>}
        {isError && (
          <p className="text-sm text-red-600">
            Could not load items for this category. Make sure the required data sources are uploaded/synced.
          </p>
        )}

        {!isLoading && !isError && (
          <>
            <Card>
              <CardContent className="pt-6 overflow-x-auto">
                {weeklyView ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item Code</TableHead>
                        <TableHead>Colour</TableHead>
                        <TableHead className="text-right">Cover (mo)</TableHead>
                        <TableHead className="text-right">Production Plan</TableHead>
                        <TableHead className="text-right bg-orange-50">W1</TableHead>
                        <TableHead className="text-right bg-yellow-50">W2</TableHead>
                        <TableHead className="text-right bg-green-50">W3</TableHead>
                        <TableHead className="text-right bg-blue-50">W4</TableHead>
                        <TableHead className="text-center">Week</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((item) => {
                        const rowCls = item.week ? WEEK_ROW_CLS[item.week] : "";
                        return (
                          <TableRow
                            key={`${item.itemCode}-${item.colour}`}
                            className={cn(rowCls, item.maxProduction <= 0 && "opacity-40")}
                          >
                            <TableCell className="font-medium">{item.itemCode}</TableCell>
                            <TableCell>{item.colour}</TableCell>
                            <TableCell className="text-right">
                              <span className={cn("px-1.5 py-0.5 rounded text-xs", coverBadgeCls(item.cover))}>
                                {coverLabel(item.cover)}
                              </span>
                            </TableCell>
                            <TableCell className={cn("text-right font-medium", item.maxProduction > 0 ? "text-red-800" : "text-green-700")}>
                              {item.maxProduction > 0 ? item.maxProduction.toFixed(0) : "—"}
                            </TableCell>
                            <TableCell className={cn("text-right", item.week === 1 && "font-bold text-orange-800")}>
                              {item.w1 > 0 ? item.w1.toFixed(0) : ""}
                            </TableCell>
                            <TableCell className={cn("text-right", item.week === 2 && "font-bold text-yellow-800")}>
                              {item.w2 > 0 ? item.w2.toFixed(0) : ""}
                            </TableCell>
                            <TableCell className={cn("text-right", item.week === 3 && "font-bold text-green-800")}>
                              {item.w3 > 0 ? item.w3.toFixed(0) : ""}
                            </TableCell>
                            <TableCell className={cn("text-right", item.week === 4 && "font-bold text-blue-800")}>
                              {item.w4 > 0 ? item.w4.toFixed(0) : ""}
                            </TableCell>
                            <TableCell className="text-center">
                              {item.week ? (
                                <span className={cn("px-2 py-0.5 rounded text-xs font-semibold", WEEK_BADGE_CLS[item.week])}>
                                  W{item.week}
                                </span>
                              ) : item.maxProduction > 0 ? (
                                <span className="text-xs text-gray-400">
                                  {item.cover === "OS" ? "OS" : "—"}
                                </span>
                              ) : null}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {items.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={9} className="text-center text-sm text-gray-500 py-6">
                            No items found for this category.
                          </TableCell>
                        </TableRow>
                      )}
                      {items.filter((i) => i.maxProduction > 0).length > 0 && (
                        <TableRow className="font-semibold border-t-2 bg-gray-50">
                          <TableCell colSpan={2}>TOTAL</TableCell>
                          <TableCell />
                          <TableCell className="text-right text-red-800">
                            {maxTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </TableCell>
                          <TableCell className="text-right bg-orange-50 text-orange-900">
                            {w1Total > 0 ? w1Total.toLocaleString(undefined, { maximumFractionDigits: 0 }) : ""}
                          </TableCell>
                          <TableCell className="text-right bg-yellow-50 text-yellow-900">
                            {w2Total > 0 ? w2Total.toLocaleString(undefined, { maximumFractionDigits: 0 }) : ""}
                          </TableCell>
                          <TableCell className="text-right bg-green-50 text-green-900">
                            {w3Total > 0 ? w3Total.toLocaleString(undefined, { maximumFractionDigits: 0 }) : ""}
                          </TableCell>
                          <TableCell className="text-right bg-blue-50 text-blue-900">
                            {w4Total > 0 ? w4Total.toLocaleString(undefined, { maximumFractionDigits: 0 }) : ""}
                          </TableCell>
                          <TableCell />
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item Code</TableHead>
                        <TableHead>Colour</TableHead>
                        <TableHead className="text-right">Cover (mo)</TableHead>
                        <TableHead className="text-right">Avg 3-Mo Sale</TableHead>
                        <TableHead className="text-right">Pending Order</TableHead>
                        <TableHead className="text-right">Pending Last Mo</TableHead>
                        <TableHead className="text-right">Buffer Req</TableHead>
                        <TableHead className="text-right">Stock</TableHead>
                        <TableHead className="text-right">Min Production</TableHead>
                        <TableHead className="text-right">Production Plan</TableHead>
                        <TableHead className="text-right">Order</TableHead>
                        <TableHead className="text-right bg-orange-50 text-orange-800">W1</TableHead>
                        <TableHead className="text-right bg-yellow-50 text-yellow-800">W2</TableHead>
                        <TableHead className="text-right bg-green-50 text-green-800">W3</TableHead>
                        <TableHead className="text-right bg-blue-50 text-blue-800">W4</TableHead>
                        <TableHead className="text-center">Week</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((item) => (
                        <TableRow key={`${item.itemCode}-${item.colour}`} className={item.week ? WEEK_ROW_CLS[item.week] : ""}>
                          <TableCell className="font-medium">{item.itemCode}</TableCell>
                          <TableCell>{item.colour}</TableCell>
                          <TableCell className="text-right">
                            <span className={cn("px-1.5 py-0.5 rounded text-xs", coverBadgeCls(item.cover))}>
                              {coverLabel(item.cover)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">{item.avg3MoSale.toFixed(1)}</TableCell>
                          <TableCell className={cn("text-right", item.pendingOrder > 0 && "bg-blue-50 text-blue-800")}>
                            {item.pendingOrder.toFixed(0)}
                          </TableCell>
                          <TableCell className="text-right">{item.pendingOrderLastMonth.toFixed(0)}</TableCell>
                          <TableCell className="text-right">{item.bufferReq.toFixed(1)}</TableCell>
                          <TableCell className="text-right">{item.stock.toFixed(0)}</TableCell>
                          <TableCell className={cn("text-right font-medium", item.minProduction > 0 ? "bg-red-50 text-red-800" : "bg-green-50 text-green-800")}>
                            {item.minProduction.toFixed(1)}
                          </TableCell>
                          <TableCell className={cn("text-right font-medium", item.maxProduction > 0 ? "bg-red-50 text-red-800" : "bg-green-50 text-green-800")}>
                            {item.maxProduction.toFixed(1)}
                          </TableCell>
                          <TableCell className={cn("text-right", item.order > 0 && "bg-blue-50 text-blue-800")}>
                            {item.order.toFixed(0)}
                          </TableCell>
                          <TableCell className={cn("text-right font-mono", item.week === 1 && "font-bold text-orange-800")}>
                            {item.w1 > 0 ? item.w1.toFixed(0) : ""}
                          </TableCell>
                          <TableCell className={cn("text-right font-mono", item.week === 2 && "font-bold text-yellow-800")}>
                            {item.w2 > 0 ? item.w2.toFixed(0) : ""}
                          </TableCell>
                          <TableCell className={cn("text-right font-mono", item.week === 3 && "font-bold text-green-800")}>
                            {item.w3 > 0 ? item.w3.toFixed(0) : ""}
                          </TableCell>
                          <TableCell className={cn("text-right font-mono", item.week === 4 && "font-bold text-blue-800")}>
                            {item.w4 > 0 ? item.w4.toFixed(0) : ""}
                          </TableCell>
                          <TableCell className="text-center">
                            {item.week ? (
                              <span className={cn("px-2 py-0.5 rounded text-xs font-semibold", WEEK_BADGE_CLS[item.week])}>
                                W{item.week}
                              </span>
                            ) : item.maxProduction > 0 ? (
                              <span className="text-xs text-gray-400">
                                {item.cover === "OS" ? "OS" : "—"}
                              </span>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ))}
                      {items.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={16} className="text-center text-sm text-gray-500 py-6">
                            No items found for this category.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {weeklyView && categoryBand && (
              <div>
                <button
                  onClick={() => setEditingBands((v) => !v)}
                  className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 transition-colors"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  {editingBands ? "Hide band settings" : "Edit week band thresholds"}
                </button>
                {editingBands && (
                  <BandEditor
                    band={categoryBand}
                    category={category}
                    onClose={() => setEditingBands(false)}
                  />
                )}
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}

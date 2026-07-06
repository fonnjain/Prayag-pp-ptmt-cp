import { useParams } from "wouter";
import { useListPlanItems, type PlanItem } from "@workspace/api-client-react";
import { AppLayout, CATEGORIES, categorySlug } from "@/components/layout/app-layout";
import { Card, CardContent } from "@/components/ui/card";
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

export default function CategoryPage() {
  const { slug } = useParams<{ slug: string }>();
  const category = CATEGORIES.find((c) => categorySlug(c) === slug);
  const month = currentMonth();

  const { data, isLoading, isError } = useListPlanItems(
    { month, category: category ?? "" },
    { query: { enabled: Boolean(category) } as any },
  );

  const items = [...((data as unknown as PlanItem[] | undefined) ?? [])].sort(
    (a, b) => b.maxProduction - a.maxProduction,
  );
  const minTotal = items.reduce((s, i) => s + Math.max(i.minProduction, 0), 0);
  const maxTotal = items.reduce((s, i) => s + Math.max(i.maxProduction, 0), 0);
  const toProduceCount = items.filter((i) => i.maxProduction > 0).length;

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
        <div>
          <h2 className="text-xl font-semibold">{category}</h2>
          <p className="text-sm text-gray-500">{formatMonthLabel(month)}</p>
        </div>

        {!isLoading && !isError && (
          <div className="flex gap-4 text-sm">
            <span className="px-3 py-1 rounded bg-gray-100">
              Min Required: <strong>{minTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong>
            </span>
            <span className="px-3 py-1 rounded bg-gray-100">
              Max / Plan: <strong>{maxTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong>
            </span>
            <span className="px-3 py-1 rounded bg-gray-100">
              Items to produce: <strong>{toProduceCount}</strong>
            </span>
          </div>
        )}

        {isLoading && <p className="text-sm text-gray-500">Loading...</p>}
        {isError && (
          <p className="text-sm text-red-600">
            Could not load items for this category. Make sure the required data sources are uploaded/synced.
          </p>
        )}

        {!isLoading && !isError && (
          <Card>
            <CardContent className="pt-6 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item Code</TableHead>
                    <TableHead>Colour</TableHead>
                    <TableHead className="text-right">Avg 3-Mo Sale</TableHead>
                    <TableHead className="text-right">Pending Order</TableHead>
                    <TableHead className="text-right">Pending Last Mo</TableHead>
                    <TableHead className="text-right">Buffer Req</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                    <TableHead className="text-right">Min Production</TableHead>
                    <TableHead className="text-right">Production Plan</TableHead>
                    <TableHead className="text-right">Order</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={`${item.itemCode}-${item.colour}`}>
                      <TableCell className="font-medium">{item.itemCode}</TableCell>
                      <TableCell>{item.colour}</TableCell>
                      <TableCell className="text-right">{item.avg3MoSale.toFixed(1)}</TableCell>
                      <TableCell
                        className={cn("text-right", item.pendingOrder > 0 && "bg-blue-50 text-blue-800")}
                      >
                        {item.pendingOrder.toFixed(0)}
                      </TableCell>
                      <TableCell className="text-right">{item.pendingOrderLastMonth.toFixed(0)}</TableCell>
                      <TableCell className="text-right">{item.bufferReq.toFixed(1)}</TableCell>
                      <TableCell className="text-right">{item.stock.toFixed(0)}</TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-medium",
                          item.minProduction > 0 ? "bg-red-50 text-red-800" : "bg-green-50 text-green-800",
                        )}
                      >
                        {item.minProduction.toFixed(1)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-medium",
                          item.maxProduction > 0 ? "bg-red-50 text-red-800" : "bg-green-50 text-green-800",
                        )}
                      >
                        {item.maxProduction.toFixed(1)}
                      </TableCell>
                      <TableCell
                        className={cn("text-right", item.order > 0 && "bg-blue-50 text-blue-800")}
                      >
                        {item.order.toFixed(0)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {items.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center text-sm text-gray-500 py-6">
                        No items found for this category.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}

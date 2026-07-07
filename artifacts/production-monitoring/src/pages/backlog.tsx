import { useGetMonitoringBacklog, getGetMonitoringBacklogQueryKey, type MonitoringBacklog } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PackageMinus, FileSpreadsheet } from "lucide-react";
import { exportXlsx } from "@/lib/excel";

export default function Backlog({ month }: { month: string }) {
  const { data: backlog, isLoading } = useGetMonitoringBacklog(
    { month },
    { query: { queryKey: getGetMonitoringBacklogQueryKey({ month }) } }
  );

  if (isLoading) return <div className="p-8 animate-pulse text-muted-foreground">Loading backlog...</div>;
  if (!backlog) return null;

  const data = backlog as unknown as MonitoringBacklog;
  const items = data.stockoutItems || [];

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">Backlog Items</h1>
          <p className="text-muted-foreground">Items where pending orders exceed current stock for {month}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => exportXlsx(`backlog-${month}`, [
            { name: "Backlog", rows: items.map((i: any) => ({ ItemCode: i.itemCode, Colour: i.colour, Category: i.category, Stock: i.stock, PendingOrder: i.pendingOrder, Gap: i.pendingOrder - i.stock })) },
          ])}>
            <FileSpreadsheet className="h-4 w-4 mr-2" /> Export Excel
          </Button>
          <Badge variant="destructive" className="text-lg px-4 py-1">{items.length} Stockouts</Badge>
        </div>
      </header>

      {items.length === 0 ? (
        <div className="text-center py-16 border border-dashed rounded-lg text-muted-foreground">
          <PackageMinus className="h-8 w-8 mx-auto mb-3 opacity-50" />
          <p>No items in backlog. All pending orders are covered by stock.</p>
        </div>
      ) : (
        <div className="border border-border/50 rounded-lg bg-card overflow-hidden shadow-sm">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead className="w-[300px] font-semibold">Item</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Current Stock</TableHead>
                <TableHead className="text-right">Pending Order</TableHead>
                <TableHead className="text-right text-destructive font-semibold">Gap</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item: any, i: number) => {
                const gap = item.pendingOrder - item.stock;
                return (
                  <TableRow key={i}>
                    <TableCell>
                      <div className="font-medium">{item.itemCode}</div>
                      <div className="text-sm text-muted-foreground">{item.colour}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{item.category}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">{item.stock.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono">{item.pendingOrder.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono text-destructive font-bold">
                      -{gap.toLocaleString()}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

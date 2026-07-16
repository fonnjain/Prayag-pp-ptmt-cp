import { useState } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { currentMonth, formatMonthLabel } from "@/lib/month";
import { cn, fmtDateTime } from "@/lib/utils";
import { useListPlanRuns, useCreatePlanRun, useFinalizePlanRun, useComparePlanRuns, type PlanRunSummary } from "@workspace/api-client-react";
import { useSegment } from "@/contexts/segment-context";

function statusColor(status: string) {
  return status === "finalized"
    ? "bg-green-100 text-green-800"
    : "bg-amber-100 text-amber-800";
}

function fmt(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function DiffView({ run1Id, run2Id, onClose }: { run1Id: number; run2Id: number; onClose: () => void }) {
  const { data, isLoading, isError } = useComparePlanRuns({ run1: run1Id, run2: run2Id });
  const diff = data as unknown as { grandMinDelta: number; grandMaxDelta: number; items: { itemCode: string; colour: string; category: string; minProductionDelta: number; productionPlanDelta: number; pendingCurrentDelta: number; stockDelta: number }[] } | undefined;

  const changedItems = (diff?.items ?? []).filter((i) => i.minProductionDelta !== 0 || i.productionPlanDelta !== 0 || i.pendingCurrentDelta !== 0 || i.stockDelta !== 0);
  changedItems.sort((a, b) => Math.abs(b.productionPlanDelta) - Math.abs(a.productionPlanDelta));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Comparing Run #{run1Id} → Run #{run2Id}</CardTitle>
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-gray-500">Loading diff...</p>}
        {isError && <p className="text-sm text-red-600">Could not load diff.</p>}
        {diff && (
          <>
            <div className="flex gap-4 mb-4 text-sm">
              <span className={cn("px-3 py-1 rounded", diff.grandMinDelta >= 0 ? "bg-red-50 text-red-800" : "bg-green-50 text-green-800")}>
                Min Required Δ: <strong>{diff.grandMinDelta > 0 ? "+" : ""}{fmt(diff.grandMinDelta)}</strong>
              </span>
              <span className={cn("px-3 py-1 rounded", diff.grandMaxDelta >= 0 ? "bg-red-50 text-red-800" : "bg-green-50 text-green-800")}>
                Plan Δ: <strong>{diff.grandMaxDelta > 0 ? "+" : ""}{fmt(diff.grandMaxDelta)}</strong>
              </span>
              <span className="px-3 py-1 rounded bg-gray-100">
                Items changed: <strong>{changedItems.length}</strong>
              </span>
            </div>
            {changedItems.length === 0 && (
              <p className="text-sm text-gray-500">No differences — identical plan outputs.</p>
            )}
            {changedItems.length > 0 && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item Code</TableHead>
                      <TableHead>Colour</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Plan Δ</TableHead>
                      <TableHead className="text-right">Min Δ</TableHead>
                      <TableHead className="text-right">Pending Δ</TableHead>
                      <TableHead className="text-right">Stock Δ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {changedItems.map((i) => (
                      <TableRow key={`${i.itemCode}-${i.colour}`}>
                        <TableCell className="font-medium">{i.itemCode}</TableCell>
                        <TableCell>{i.colour}</TableCell>
                        <TableCell className="text-xs text-gray-600">{i.category}</TableCell>
                        <TableCell className={cn("text-right font-medium", i.productionPlanDelta > 0 ? "text-red-700" : i.productionPlanDelta < 0 ? "text-green-700" : "")}>
                          {i.productionPlanDelta > 0 ? "+" : ""}{fmt(i.productionPlanDelta)}
                        </TableCell>
                        <TableCell className={cn("text-right", i.minProductionDelta > 0 ? "text-red-700" : i.minProductionDelta < 0 ? "text-green-700" : "")}>
                          {i.minProductionDelta > 0 ? "+" : ""}{fmt(i.minProductionDelta)}
                        </TableCell>
                        <TableCell className={cn("text-right", i.pendingCurrentDelta !== 0 ? "text-blue-700" : "")}>
                          {i.pendingCurrentDelta > 0 ? "+" : ""}{fmt(i.pendingCurrentDelta)}
                        </TableCell>
                        <TableCell className="text-right text-gray-600">
                          {i.stockDelta > 0 ? "+" : ""}{fmt(i.stockDelta)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function RunsPage() {
  const month = currentMonth();
  const { segment } = useSegment();
  const { toast } = useToast();
  const { data, isLoading, refetch } = useListPlanRuns({ month, segment });
  const createRun = useCreatePlanRun();
  const finalizeRun = useFinalizePlanRun();
  const [compareIds, setCompareIds] = useState<[number, number] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const runs = (data as unknown as PlanRunSummary[] | undefined) ?? [];

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < 2) {
        next.add(id);
      } else {
        // Replace oldest selection
        const [first] = next;
        next.delete(first);
        next.add(id);
      }
      return next;
    });
  };

  const handleCreate = () => {
    createRun.mutate(
      { data: { month, segment } },
      {
        onSuccess: () => {
          toast({ title: "Plan run created", description: `Draft snapshot for ${formatMonthLabel(month)} saved.` });
          refetch();
        },
        onError: () =>
          toast({ title: "Failed to create run", description: "Check that all data sources are available.", variant: "destructive" }),
      },
    );
  };

  const handleFinalize = (id: number) => {
    finalizeRun.mutate(
      { id },
      {
        onSuccess: () => {
          toast({ title: "Run finalized", description: `Run #${id} is now locked.` });
          refetch();
        },
        onError: () => toast({ title: "Failed to finalize", variant: "destructive" }),
      },
    );
  };

  const handleCompare = () => {
    const ids = [...selectedIds] as [number, number];
    ids.sort((a, b) => a - b);
    setCompareIds(ids);
  };

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">Plan Runs — {formatMonthLabel(month)}</h2>
            <p className="text-sm text-gray-500">
              Each run freezes all live inputs (pending order, stock, sales) at a point in time.
            </p>
          </div>
          <div className="flex gap-2">
            {selectedIds.size === 2 && (
              <Button variant="outline" size="sm" onClick={handleCompare}>
                Compare selected
              </Button>
            )}
            <Button
              onClick={handleCreate}
              disabled={createRun.isPending}
            >
              {createRun.isPending ? "Running plan…" : "Run Plan now"}
            </Button>
          </div>
        </div>

        {compareIds && (
          <DiffView
            run1Id={compareIds[0]}
            run2Id={compareIds[1]}
            onClose={() => { setCompareIds(null); setSelectedIds(new Set()); }}
          />
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Run history</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading && <p className="text-sm text-gray-500">Loading runs...</p>}
            {!isLoading && runs.length === 0 && (
              <p className="text-sm text-gray-500">No runs yet. Click "Run Plan now" to create the first snapshot.</p>
            )}
            {runs.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Run #</TableHead>
                    <TableHead>As-of</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Min Required</TableHead>
                    <TableHead className="text-right">Plan (Max)</TableHead>
                    <TableHead>Note</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => (
                    <TableRow
                      key={run.id}
                      className={cn(selectedIds.has(run.id) && "bg-blue-50")}
                    >
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(run.id)}
                          onChange={() => toggleSelect(run.id)}
                          className="h-4 w-4 cursor-pointer"
                        />
                      </TableCell>
                      <TableCell className="font-medium">#{run.id}</TableCell>
                      <TableCell className="text-sm">{fmtDateTime(run.asOfAt)}</TableCell>
                      <TableCell>
                        <Badge className={cn("capitalize text-xs", statusColor(run.status))}>
                          {run.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{fmt(run.grandMinTotal)}</TableCell>
                      <TableCell className="text-right">{fmt(run.grandMaxTotal)}</TableCell>
                      <TableCell className="text-sm text-gray-500">{run.note ?? "—"}</TableCell>
                      <TableCell>
                        {run.status === "draft" && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleFinalize(run.id)}
                            disabled={finalizeRun.isPending}
                          >
                            Finalize
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div className="text-xs text-gray-400 space-y-1">
          <p>• <strong>Draft</strong> — snapshot saved; re-run to capture updated live data (creates a new run).</p>
          <p>• <strong>Finalized</strong> — locked; frozen inputs and outputs are permanently preserved.</p>
          <p>• Select any two runs and click "Compare selected" to see per-item deltas.</p>
        </div>
      </div>
    </AppLayout>
  );
}

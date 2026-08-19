import { useState } from "react";
import { useQueries } from "@tanstack/react-query";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { currentMonth, formatMonthLabel } from "@/lib/month";
import { cn, fmtDateTime } from "@/lib/utils";
import {
  useListPlanRuns,
  useCreatePlanRun,
  useFinalizePlanRun,
  useDeletePlanRun,
  getPlanRun,
  getGetPlanRunQueryKey,
  useGetPlanRunDrift,
  type PlanRunSummary,
  type PlanRunDrift,
} from "@workspace/api-client-react";
import { useSegment } from "@/contexts/segment-context";
import { Trash2, GitCompare, Activity } from "lucide-react";

function statusColor(status: string) {
  return status === "finalized"
    ? "bg-green-100 text-green-800"
    : "bg-amber-100 text-amber-800";
}

function fmt(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function fmtDelta(n: number) {
  if (n === 0) return <span className="text-gray-400">–</span>;
  return (
    <span className={n > 0 ? "text-red-700 font-medium" : "text-green-700 font-medium"}>
      {n > 0 ? "+" : ""}{fmt(n)}
    </span>
  );
}

type RunDetail = {
  run: PlanRunSummary;
  items: { itemCode: string; colour: string; category: string; minProduction: number; productionPlan: number }[];
};

function MultiRunCompare({ ids, onClose }: { ids: number[]; onClose: () => void }) {
  const sorted = [...ids].sort((a, b) => a - b);

  const queries = useQueries({
    queries: sorted.map((id) => ({
      queryKey: getGetPlanRunQueryKey(id),
      queryFn: () => getPlanRun(id),
    })),
  });

  const loading = queries.some((q) => q.isLoading);
  const allData = queries
    .map((q) => q.data as unknown as RunDetail | undefined)
    .filter((d): d is RunDetail => !!d);

  if (loading) return (
    <Card>
      <CardContent className="py-8 text-center text-sm text-gray-400">
        Loading {sorted.length} runs…
      </CardContent>
    </Card>
  );

  const categorySet = new Set<string>();
  for (const d of allData) for (const item of d.items) categorySet.add(item.category);
  const categories = [...categorySet].sort();

  const catMin = (d: RunDetail, cat: string) =>
    d.items.filter((i) => i.category === cat).reduce((s, i) => s + Math.max(i.minProduction, 0), 0);
  const catMax = (d: RunDetail, cat: string) =>
    d.items.filter((i) => i.category === cat).reduce((s, i) => s + Math.max(i.productionPlan, 0), 0);

  const showDelta = sorted.length === 2;
  const [d1, d2] = allData;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <GitCompare className="h-4 w-4" />
            Comparing {sorted.length} Runs — #{sorted.join(", #")}
          </CardTitle>
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Side-by-side totals + category breakdown */}
        <div className="overflow-x-auto rounded-lg border border-border/50">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 border-b border-border/50">
              <tr>
                <th className="text-left py-2.5 px-4 font-medium text-muted-foreground w-44">Category</th>
                {allData.map((d) => (
                  <th key={d.run.id} colSpan={2} className="text-center py-2.5 px-3 border-l border-border/30">
                    <div className="font-semibold">Run #{d.run.id}</div>
                    <div className="text-xs font-normal text-muted-foreground">{fmtDateTime(d.run.asOfAt)}</div>
                    <Badge className={cn("text-xs mt-0.5", statusColor(d.run.status))}>{d.run.status}</Badge>
                  </th>
                ))}
                {showDelta && (
                  <th className="text-center py-2.5 px-3 border-l border-border/30 text-muted-foreground text-xs">
                    <div className="font-medium">Δ Plan</div>
                    <div className="font-normal">#{sorted[0]}→#{sorted[1]}</div>
                  </th>
                )}
              </tr>
              <tr className="border-b border-border/30 text-xs text-muted-foreground">
                <th className="py-1.5 px-4"></th>
                {allData.map((d) => (
                  <>
                    <th key={`${d.run.id}-min-h`} className="py-1.5 px-3 text-right border-l border-border/30 font-normal">Min</th>
                    <th key={`${d.run.id}-max-h`} className="py-1.5 px-3 text-right font-normal">Plan</th>
                  </>
                ))}
                {showDelta && <th className="py-1.5 px-3 text-right border-l border-border/30 font-normal">Plan Δ</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {categories.map((cat) => (
                <tr key={cat} className="hover:bg-muted/20">
                  <td className="py-2 px-4 font-medium text-xs">{cat}</td>
                  {allData.map((d) => (
                    <>
                      <td key={`${d.run.id}-${cat}-min`} className="py-2 px-3 text-right font-mono text-xs border-l border-border/30">{fmt(catMin(d, cat))}</td>
                      <td key={`${d.run.id}-${cat}-max`} className="py-2 px-3 text-right font-mono text-xs">{fmt(catMax(d, cat))}</td>
                    </>
                  ))}
                  {showDelta && d1 && d2 && (
                    <td className="py-2 px-3 text-right font-mono text-xs border-l border-border/30">
                      {fmtDelta(catMax(d2, cat) - catMax(d1, cat))}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-border font-semibold bg-muted/30">
              <tr>
                <td className="py-2.5 px-4 text-xs uppercase text-muted-foreground">Grand Total</td>
                {allData.map((d) => (
                  <>
                    <td key={`${d.run.id}-tot-min`} className="py-2.5 px-3 text-right font-mono border-l border-border/30">{fmt(d.run.grandMinTotal)}</td>
                    <td key={`${d.run.id}-tot-max`} className="py-2.5 px-3 text-right font-mono">{fmt(d.run.grandMaxTotal)}</td>
                  </>
                ))}
                {showDelta && d1 && d2 && (
                  <td className="py-2.5 px-3 text-right font-mono border-l border-border/30">
                    {fmtDelta(d2.run.grandMaxTotal - d1.run.grandMaxTotal)}
                  </td>
                )}
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Per-item delta (only for exactly 2 runs) */}
        {showDelta && d1 && d2 && (() => {
          const key1 = new Map(d1.items.map((i) => [`${i.itemCode}::${i.colour}`, i]));
          const key2 = new Map(d2.items.map((i) => [`${i.itemCode}::${i.colour}`, i]));
          const allKeys = new Set([...key1.keys(), ...key2.keys()]);
          const changed = [...allKeys]
            .map((k) => {
              const a = key1.get(k);
              const b = key2.get(k);
              const delta = (b?.productionPlan ?? 0) - (a?.productionPlan ?? 0);
              return { itemCode: (a ?? b)!.itemCode, colour: (a ?? b)!.colour, category: (a ?? b)!.category, delta };
            })
            .filter((r) => r.delta !== 0)
            .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

          if (changed.length === 0) return (
            <p className="text-sm text-gray-500 text-center py-2">No per-item differences — identical plan outputs.</p>
          );
          return (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                Changed items ({changed.length})
              </p>
              <div className="overflow-x-auto rounded-lg border border-border/50 max-h-72 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item Code</TableHead>
                      <TableHead>Colour</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Plan Δ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {changed.map((i) => (
                      <TableRow key={`${i.itemCode}-${i.colour}`}>
                        <TableCell className="font-medium text-sm">{i.itemCode}</TableCell>
                        <TableCell className="text-sm">{i.colour}</TableCell>
                        <TableCell className="text-xs text-gray-600">{i.category}</TableCell>
                        <TableCell className="text-right">{fmtDelta(i.delta)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          );
        })()}
      </CardContent>
    </Card>
  );
}

function DriftView({ runId, onClose }: { runId: number; onClose: () => void }) {
  const { data, isLoading, error } = useGetPlanRunDrift(runId, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: {} as any,
  });
  const drift = data as unknown as PlanRunDrift | undefined;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Drift — Run #{runId} (as issued) vs live rebuild (if re-run today)
          </CardTitle>
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-gray-500 py-4 text-center">Rebuilding live plan for comparison…</p>}
        {error != null && (
          <p className="text-sm text-red-600 py-2">
            Live rebuild failed — check that all required uploads are still present.
          </p>
        )}
        {drift && (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-md border px-3 py-2.5">
                <p className="text-xs text-gray-500">Frozen total (as issued)</p>
                <p className="text-xl font-bold tabular-nums">{fmt(drift.frozenGrandTotal)}</p>
              </div>
              <div className="rounded-md border px-3 py-2.5">
                <p className="text-xs text-gray-500">Live total (re-run today)</p>
                <p className="text-xl font-bold tabular-nums">{fmt(drift.liveGrandTotal)}</p>
              </div>
              <div className={cn("rounded-md border px-3 py-2.5", drift.grandDelta !== 0 ? "bg-amber-50 border-amber-200" : "bg-green-50 border-green-200")}>
                <p className="text-xs text-gray-500">Drift</p>
                <p className="text-xl font-bold tabular-nums">{fmtDelta(drift.grandDelta)}</p>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-border/50">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Frozen</TableHead>
                    <TableHead className="text-right">Live</TableHead>
                    <TableHead className="text-right">Δ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {drift.categories.map((c) => (
                    <TableRow key={c.category}>
                      <TableCell className="text-sm font-medium">{c.category}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{fmt(c.frozenMax)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{fmt(c.liveMax)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{fmtDelta(c.delta)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {drift.changedItemCount === 0 ? (
              <p className="text-sm text-gray-500 text-center py-2">No drift — live inputs still produce the issued plan.</p>
            ) : (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                  Changed items ({drift.changedItemCount})
                </p>
                <div className="overflow-x-auto rounded-lg border border-border/50 max-h-72 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item Code</TableHead>
                        <TableHead>Colour</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead className="text-right">Frozen</TableHead>
                        <TableHead className="text-right">Live</TableHead>
                        <TableHead className="text-right">Δ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {drift.changedItems.map((i) => (
                        <TableRow key={`${i.itemCode}-${i.colour}`}>
                          <TableCell className="font-medium text-sm">{i.itemCode}</TableCell>
                          <TableCell className="text-sm">{i.colour}</TableCell>
                          <TableCell className="text-xs text-gray-600">{i.category}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{fmt(i.frozenPlan)}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{fmt(i.livePlan)}</TableCell>
                          <TableCell className="text-right">{fmtDelta(i.delta)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
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
  const deleteRun = useDeletePlanRun();
  const [compareIds, setCompareIds] = useState<number[] | null>(null);
  const [driftRunId, setDriftRunId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [effectiveFrom, setEffectiveFrom] = useState(() => {
    const today = new Date().toISOString().slice(0, 10);
    return today.slice(0, 7) === month ? today : `${month}-01`;
  });

  const runs = (data as unknown as PlanRunSummary[] | undefined) ?? [];

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreate = () => {
    createRun.mutate(
      { data: { month, segment, effectiveFrom } },
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
      { id, data: {} },
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
    setCompareIds([...selectedIds].sort((a, b) => a - b));
  };

  const handleDeleteSelected = () => {
    const ids = [...selectedIds];
    let remaining = ids.length;
    let failed = false;

    const onDone = () => {
      remaining--;
      if (remaining === 0) {
        if (!failed) {
          toast({ title: `${ids.length} run${ids.length > 1 ? "s" : ""} deleted` });
          setSelectedIds(new Set());
          setConfirmDelete(false);
          setCompareIds(null);
        }
        refetch();
      }
    };

    for (const id of ids) {
      deleteRun.mutate(
        { id },
        {
          onSuccess: onDone,
          onError: () => {
            failed = true;
            toast({ title: `Failed to delete run #${id}`, variant: "destructive" });
            onDone();
          },
        },
      );
    }
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
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Effective from
              <input
                type="date"
                min={`${month}-01`}
                max={`${month}-${new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()}`}
                value={effectiveFrom}
                onChange={(event) => setEffectiveFrom(event.target.value)}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
              />
            </label>
            {selectedIds.size >= 1 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmDelete(true)}
                className="gap-1.5 text-red-600 border-red-300 hover:bg-red-50 hover:text-red-700"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete {selectedIds.size > 1 ? `${selectedIds.size} runs` : "run"}
              </Button>
            )}
            {selectedIds.size >= 2 && (
              <Button variant="outline" size="sm" onClick={handleCompare} className="gap-1.5">
                <GitCompare className="h-3.5 w-3.5" />
                Compare {selectedIds.size}
              </Button>
            )}
            <Button onClick={handleCreate} disabled={createRun.isPending}>
              {createRun.isPending ? "Running plan…" : "Run Plan now"}
            </Button>
          </div>
        </div>

        {compareIds && (
          <MultiRunCompare
            ids={compareIds}
            onClose={() => { setCompareIds(null); setSelectedIds(new Set()); }}
          />
        )}

        {driftRunId !== null && (
          <DriftView runId={driftRunId} onClose={() => setDriftRunId(null)} />
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span>Run history</span>
              {selectedIds.size > 0 && (
                <span className="text-xs font-normal text-muted-foreground">
                  {selectedIds.size} selected ·{" "}
                  <button className="underline hover:text-foreground" onClick={() => setSelectedIds(new Set())}>
                    Clear
                  </button>
                </span>
              )}
            </CardTitle>
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
                    <TableHead>Effective from</TableHead>
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
                      <TableCell className="text-sm">{run.effectiveFrom ?? "Legacy"}</TableCell>
                      <TableCell>
                        <Badge className={cn("capitalize text-xs", statusColor(run.status))}>
                          {run.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{fmt(run.grandMinTotal)}</TableCell>
                      <TableCell className="text-right">{fmt(run.grandMaxTotal)}</TableCell>
                      <TableCell className="text-sm text-gray-500">{run.note ?? "—"}</TableCell>
                      <TableCell>
                        <div className="flex gap-1.5 justify-end">
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
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1"
                            onClick={() => setDriftRunId(run.id)}
                          >
                            <Activity className="h-3.5 w-3.5" />
                            Drift
                          </Button>
                        </div>
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
          <p>• Select 2+ runs and click "Compare" to see side-by-side category totals (per-item delta shown for exactly 2 runs).</p>
          <p>• Select any runs and click "Delete" to permanently remove them and all their frozen data.</p>
        </div>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedIds.size} run{selectedIds.size > 1 ? "s" : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete run{selectedIds.size > 1 ? "s" : ""}{" "}
              #{[...selectedIds].sort((a, b) => a - b).join(", #")} and all their
              frozen inputs, results, and pending snapshots. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={handleDeleteSelected}
              disabled={deleteRun.isPending}
            >
              {deleteRun.isPending
                ? "Deleting…"
                : `Delete ${selectedIds.size > 1 ? `${selectedIds.size} runs` : "run"}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}

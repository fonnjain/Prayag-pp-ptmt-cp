import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetReconciliation,
  useRunReconciliation,
  getGetReconciliationQueryKey,
} from "@workspace/api-client-react";
import type { ReconciliationResult, MachineCoverageGroup } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, Cpu, RefreshCw, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MachineCell({
  key: _k,
  machine,
  inR5,
  inOther,
  otherLabel,
  unlisted,
}: {
  key?: string;
  machine: string;
  inR5: boolean;
  inOther: boolean;
  otherLabel: string;
  unlisted: boolean;
}) {
  const both = inR5 && inOther;
  const neither = !inR5 && !inOther;
  const mismatch = inR5 !== inOther;

  let bg = "bg-muted/30 border-muted";
  let icon = null;
  if (both) { bg = "bg-green-500/10 border-green-200"; icon = <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />; }
  else if (mismatch) { bg = "bg-amber-500/10 border-amber-200"; icon = <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />; }
  else if (unlisted) { bg = "bg-red-500/10 border-red-200"; icon = <AlertCircle className="h-3 w-3 text-red-500 shrink-0" />; }

  return (
    <div className={`p-2 rounded border text-xs flex flex-col gap-1 ${bg}`}>
      <div className="flex items-center gap-1 font-mono font-semibold">
        {icon}
        <span>{machine}</span>
        {unlisted && <Badge variant="outline" className="text-[9px] text-red-600 border-red-200 ml-1">unlisted</Badge>}
      </div>
      <div className="flex gap-2 text-[10px] text-muted-foreground">
        <span className={inR5 ? "text-green-600 font-medium" : "line-through"}>R5</span>
        <span className={inOther ? "text-green-600 font-medium" : "line-through"}>{otherLabel}</span>
        {neither && <span className="text-muted-foreground italic">not running</span>}
        {mismatch && <span className="text-amber-600 font-medium">mismatch</span>}
      </div>
    </div>
  );
}

function MachineGroup({
  label,
  otherLabel,
  group,
}: {
  label: string;
  otherLabel: string;
  group: MachineCoverageGroup;
}) {
  const r5Set = new Set(group.inR5);
  const otherSet = new Set(group.inR11OrR12);
  const unlistedSet = new Set(group.unlisted);

  // All machines to show: expected + unlisted
  const allMachines = [...new Set([...group.expected, ...group.unlisted])].sort();

  const mismatches = group.r5Only.length + group.r11OrR12Only.length;
  const unlistedCount = group.unlisted.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h4 className="text-sm font-semibold">{label}</h4>
        <Badge variant="outline" className="text-[10px]">
          {group.bothAgreeRan.length}/{group.expected.length} both ran
        </Badge>
        {mismatches > 0 && (
          <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-200">
            {mismatches} mismatch{mismatches !== 1 ? "es" : ""}
          </Badge>
        )}
        {unlistedCount > 0 && (
          <Badge variant="outline" className="text-[10px] text-red-600 border-red-200">
            {unlistedCount} unlisted
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
        {allMachines.map((m) => (
          <MachineCell
            key={m}
            machine={m}
            inR5={r5Set.has(m)}
            inOther={otherSet.has(m)}
            otherLabel={otherLabel}
            unlisted={unlistedSet.has(m)}
          />
        ))}
      </div>

      {group.missingBoth.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Not running in either report: {group.missingBoth.join(", ")}
        </p>
      )}
    </div>
  );
}

function ResultView({ result }: { result: ReconciliationResult }) {
  const totalMismatches =
    result.pipe.r5Only.length +
    result.pipe.r11OrR12Only.length +
    result.mould.r5Only.length +
    result.mould.r11OrR12Only.length;

  const totalUnlisted = result.pipe.unlisted.length + result.mould.unlisted.length;

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30 flex-wrap">
        {result.pipeEmpty ? (
          <AlertTriangle className="h-6 w-6 text-amber-500 shrink-0 mt-0.5" />
        ) : totalMismatches > 0 || totalUnlisted > 0 ? (
          <AlertTriangle className="h-6 w-6 text-amber-500 shrink-0 mt-0.5" />
        ) : (
          <CheckCircle2 className="h-6 w-6 text-green-500 shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          {result.pipeEmpty && (
            <p className="text-sm font-semibold text-amber-600">
              Pipe side is empty — awaiting source data for this month
            </p>
          )}
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mt-1">
            <span>Computed: {new Date(result.computedAt).toLocaleString()}</span>
            {totalMismatches > 0 && (
              <span className="text-amber-600 font-medium">{totalMismatches} report mismatch{totalMismatches !== 1 ? "es" : ""}</span>
            )}
            {totalUnlisted > 0 && (
              <span className="text-red-600 font-medium">{totalUnlisted} unlisted machine{totalUnlisted !== 1 ? "s" : ""}</span>
            )}
          </div>
        </div>
      </div>

      {!result.pipeEmpty && (
        <MachineGroup label="Pipe Machines (Report-5 vs Report-11)" otherLabel="R11" group={result.pipe} />
      )}

      <MachineGroup label="Moulding Machines (Report-5 vs Report-12)" otherLabel="R12" group={result.mould} />

      {totalMismatches > 0 && (
        <div className="p-3 rounded-lg border bg-amber-500/5 space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-amber-700">Coverage Mismatches</h4>
          <div className="space-y-1 text-xs">
            {result.pipe.r5Only.length > 0 && (
              <p><span className="font-medium">Pipe in R5 not R11:</span> {result.pipe.r5Only.join(", ")}</p>
            )}
            {result.pipe.r11OrR12Only.length > 0 && (
              <p><span className="font-medium">Pipe in R11 not R5:</span> {result.pipe.r11OrR12Only.join(", ")}</p>
            )}
            {result.mould.r5Only.length > 0 && (
              <p><span className="font-medium">Mould in R5 not R12:</span> {result.mould.r5Only.join(", ")}</p>
            )}
            {result.mould.r11OrR12Only.length > 0 && (
              <p><span className="font-medium">Mould in R12 not R5:</span> {result.mould.r11OrR12Only.join(", ")}</p>
            )}
          </div>
        </div>
      )}

      {totalUnlisted > 0 && (
        <div className="p-3 rounded-lg border bg-red-500/5 space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-red-700">Unlisted Machines (not in canonical roster)</h4>
          <div className="space-y-1 text-xs">
            {result.pipe.unlisted.length > 0 && (
              <p><span className="font-medium">Pipe:</span> {result.pipe.unlisted.join(", ")}</p>
            )}
            {result.mould.unlisted.length > 0 && (
              <p><span className="font-medium">Moulding:</span> {result.mould.unlisted.join(", ")}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

interface RosterPanelProps {
  planMonth: string; // "YYYY-MM"
  role: string;
}

export function RosterPanel({ planMonth, role }: RosterPanelProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);

  const query = useGetReconciliation(
    { month: planMonth },
    { query: { retry: false } } as Parameters<typeof useGetReconciliation>[1],
  );

  const runMutation = useRunReconciliation();

  const result = (query.data as ReconciliationResult | null | undefined) ?? null;

  const handleRun = async () => {
    setRunning(true);
    try {
      await runMutation.mutateAsync({ data: { month: planMonth } });
      await qc.invalidateQueries({ queryKey: getGetReconciliationQueryKey({ month: planMonth }) });
      toast({ title: "Reconciliation complete", description: `Machine roster reconciled for ${planMonth}.` });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Reconciliation failed",
        description: err instanceof Error ? err.message : "Could not run reconciliation.",
      });
    } finally {
      setRunning(false);
    }
  };

  const canRun = role !== "viewer";

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Cpu className="h-5 w-5 text-primary" />
              Machine Roster Reconciliation
            </CardTitle>
            <CardDescription className="mt-1">
              Cross-checks canonical CP machine roster against Report-5, Report-11 (pipe), and Report-12 (moulding) for {planMonth}.
            </CardDescription>
          </div>
          {canRun && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 shrink-0"
              onClick={handleRun}
              disabled={running || query.isLoading}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${running ? "animate-spin" : ""}`} />
              {running ? "Running…" : result ? "Re-run" : "Run"}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <div className="text-center py-8 text-muted-foreground text-sm">Loading…</div>
        ) : !result ? (
          <div className="text-center py-10 text-muted-foreground text-sm space-y-3">
            <Cpu className="h-8 w-8 mx-auto opacity-30" />
            <p>No reconciliation run yet for {planMonth}.</p>
            {canRun && (
              <Button size="sm" onClick={handleRun} disabled={running} className="gap-1.5">
                <RefreshCw className={`h-3.5 w-3.5 ${running ? "animate-spin" : ""}`} />
                {running ? "Running…" : "Run now"}
              </Button>
            )}
          </div>
        ) : (
          <ResultView result={result} />
        )}
      </CardContent>
    </Card>
  );
}

import { useGetMonitoringQuality, getGetMonitoringQualityQueryKey, type MonitoringQuality } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertCircle, FileSpreadsheet } from "lucide-react";
import { exportXlsx } from "@/lib/excel";

function formatNum(val: number | null | undefined, maxDecimals = 1) {
  if (val == null) return "--";
  return val.toLocaleString(undefined, { maximumFractionDigits: maxDecimals });
}

function formatPct(val: number | null | undefined) {
  if (val == null) return "--";
  return `${val.toFixed(1)}%`;
}

export default function Quality({ month }: { month: string }) {
  const { data: quality, isLoading } = useGetMonitoringQuality(
    { month },
    { query: { queryKey: getGetMonitoringQualityQueryKey({ month }) } }
  );

  if (isLoading) return <div className="p-8 animate-pulse text-muted-foreground">Loading quality data...</div>;
  if (!quality) return null;

  const data = quality as unknown as MonitoringQuality;
  const machines = data.machines || [];
  const activeMachines = machines.filter((m: any) => !m.isGrinder && m.runHours > 0);
  const grinders = machines.filter((m: any) => m.isGrinder);

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto pb-10">
      <header className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">Machine Utilisation & Quality</h1>
          <p className="text-muted-foreground">Performance by machine for {month}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => exportXlsx(`quality-${month}`, [
          { name: "Machines", rows: activeMachines.map((m: any) => ({ Machine: m.machineId, RunHours: m.runHours, IdealHours: m.idealHours, UtilisationPct: m.utilisationPct, OutputKg: m.outputKg, RejectionKg: m.rejectionKg, RejectionPct: m.rejectionPct, GoodOutputKg: m.goodOutputKg })) },
          { name: "Grinders", rows: grinders.map((m: any) => ({ Machine: m.machineId, RunHours: m.runHours, OutputKg: m.outputKg })) },
        ])}>
          <FileSpreadsheet className="h-4 w-4 mr-2" /> Export Excel
        </Button>
      </header>

      {!data.dataAvailable && (
        <div className="bg-amber-500/10 border border-amber-500/20 text-amber-600 p-4 rounded-lg flex items-start gap-3 mb-6">
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-medium">No Report-5 Data Available</h3>
            <p className="text-sm opacity-90 mt-1">
              Production data for this month hasn't been synced yet.
            </p>
          </div>
        </div>
      )}

      {activeMachines.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Production Machines</h2>
          <div className="border border-border/50 rounded-lg bg-card overflow-hidden shadow-sm">
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow>
                  <TableHead className="w-[150px] font-semibold">Machine</TableHead>
                  <TableHead className="text-right">Run Hours</TableHead>
                  <TableHead className="text-right">Ideal Hours</TableHead>
                  <TableHead className="text-right">Utilisation</TableHead>
                  <TableHead className="text-right">Output (kg)</TableHead>
                  <TableHead className="text-right">Rejection (kg)</TableHead>
                  <TableHead className="text-right">Rejection Pct</TableHead>
                  <TableHead className="text-right">Good Output (kg)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeMachines.map((m: any) => (
                  <TableRow key={m.machineId}>
                    <TableCell className="font-medium">{m.machineId}</TableCell>
                    <TableCell className="text-right font-mono">{formatNum(m.runHours)}</TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">{formatNum(m.idealHours)}</TableCell>
                    <TableCell className={`text-right font-mono font-medium ${(m.utilisationPct ?? 0) < 70 ? 'text-orange-500' : ''}`}>
                      {formatPct(m.utilisationPct)}
                    </TableCell>
                    <TableCell className="text-right font-mono">{formatNum(m.outputKg, 0)}</TableCell>
                    <TableCell className="text-right font-mono">{formatNum(m.rejectionKg, 0)}</TableCell>
                    <TableCell className={`text-right font-mono font-medium ${(m.rejectionPct ?? 0) > 5 ? 'text-red-500' : ''}`}>
                      {formatPct(m.rejectionPct)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-emerald-600">{formatNum(m.goodOutputKg, 0)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {grinders.length > 0 && (
        <div className="space-y-4 mt-8">
          <h2 className="text-xl font-semibold">Grinders</h2>
          <div className="border border-border/50 rounded-lg bg-card overflow-hidden shadow-sm">
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow>
                  <TableHead className="w-[150px] font-semibold">Machine</TableHead>
                  <TableHead className="text-right">Run Hours</TableHead>
                  <TableHead className="text-right">Output (kg)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {grinders.map((m: any) => (
                  <TableRow key={m.machineId}>
                    <TableCell className="font-medium">{m.machineId}</TableCell>
                    <TableCell className="text-right font-mono">{formatNum(m.runHours)}</TableCell>
                    <TableCell className="text-right font-mono">{formatNum(m.outputKg, 0)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}

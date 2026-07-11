import { useGetMonitoringVelocity, getGetMonitoringVelocityQueryKey, type MonitoringVelocity } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet } from "lucide-react";
import { exportXlsx } from "@/lib/excel";

function RagBadge({ band }: { band: "green" | "amber" | "red" | null }) {
  if (!band) return <Badge variant="outline" className="text-muted-foreground border-muted">N/A</Badge>;
  const colors = {
    green: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    amber: "bg-amber-500/10 text-amber-500 border-amber-500/20",
    red: "bg-red-500/10 text-red-500 border-red-500/20",
  };
  return <Badge variant="outline" className={colors[band]}>{band.toUpperCase()}</Badge>;
}

function formatKg(val: number | null | undefined) {
  if (val == null) return "--";
  return val.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatPct(val: number | null | undefined) {
  if (val == null) return "--";
  return `${val.toFixed(1)}%`;
}

export default function Velocity({ month, selectedCategory }: { month: string; selectedCategory?: string | null }) {
  const { data: velocity, isLoading } = useGetMonitoringVelocity(
    { month },
    { query: { queryKey: getGetMonitoringVelocityQueryKey({ month }) } }
  );

  if (isLoading) return <div className="p-8 animate-pulse text-muted-foreground">Loading velocity data...</div>;
  if (!velocity) return null;

  const data = velocity as unknown as MonitoringVelocity;

  const allRows = [
    { ...data.plant, name: "PLANT TOTAL", isPlant: true },
    ...(data.categories || []).map((c: any) => ({ ...c, name: c.category, isPlant: false }))
  ];

  const rows = selectedCategory
    ? allRows.filter((r) => r.isPlant || (r as any).category === selectedCategory)
    : allRows;

  const exportRows = selectedCategory
    ? allRows.filter((r) => r.isPlant || (r as any).category === selectedCategory)
    : allRows;

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto pb-10">
      <header className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">Production Velocity</h1>
          <p className="text-muted-foreground">
            Pace and projection metrics for {month}
            {selectedCategory && (
              <span className="ml-2 text-sm font-medium text-primary">— {selectedCategory}</span>
            )}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => exportXlsx(`velocity-${month}`, [
          { name: "Velocity", rows: exportRows.map((r: any) => ({ Category: r.name, TargetKg: r.targetKg, OutputKg: r.outputToDateKg, Attainment: r.attainmentPct, RequiredPerDay: r.requiredPerDay, ActualPerDay: r.actualPerDay, DaysAheadBehind: r.daysAheadBehind, ProjectedEnd: r.projectedMonthEnd, RAG: r.ragBand })) },
        ])}>
          <FileSpreadsheet className="h-4 w-4 mr-2" /> Export Excel
        </Button>
      </header>

      <div className="border border-border/50 rounded-lg bg-card overflow-hidden shadow-sm">
        <Table>
          <TableHeader className="bg-muted/30">
            <TableRow>
              <TableHead className="w-[200px] font-semibold">Category</TableHead>
              <TableHead className="text-right">Target (kg)</TableHead>
              <TableHead className="text-right">Output (kg)</TableHead>
              <TableHead className="text-right">Attainment</TableHead>
              <TableHead className="text-right">Req/Day</TableHead>
              <TableHead className="text-right">Actual/Day</TableHead>
              <TableHead className="text-right">Days Ahead</TableHead>
              <TableHead className="text-right">Proj. End</TableHead>
              <TableHead className="text-center">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row: any, i) => (
              <TableRow
                key={i}
                className={row.isPlant ? "bg-muted/10 font-medium" : selectedCategory && !row.isPlant ? "bg-primary/5" : ""}
              >
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell className="text-right font-mono text-muted-foreground">{formatKg(row.targetKg)}</TableCell>
                <TableCell className="text-right font-mono">{formatKg(row.outputToDateKg)}</TableCell>
                <TableCell className="text-right font-mono">{formatPct(row.attainmentPct)}</TableCell>
                <TableCell className="text-right font-mono text-muted-foreground">{formatKg(row.requiredPerDay)}</TableCell>
                <TableCell className="text-right font-mono">{formatKg(row.actualPerDay)}</TableCell>
                <TableCell className={`text-right font-mono ${row.daysAheadBehind != null && row.daysAheadBehind < 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                  {row.daysAheadBehind != null ? (row.daysAheadBehind > 0 ? "+" : "") + row.daysAheadBehind.toFixed(1) : "--"}
                </TableCell>
                <TableCell className="text-right font-mono">{formatKg(row.projectedMonthEnd)}</TableCell>
                <TableCell className="text-center">
                  <RagBadge band={row.ragBand} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

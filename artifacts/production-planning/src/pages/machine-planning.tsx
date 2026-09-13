import { useState, useMemo } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSegment } from "@/contexts/segment-context";
import { useMonth } from "@workspace/month-filter";
import { MonthEmptyState } from "@/components/month-empty-state";
import { useMachinePlanning } from "@/hooks/use-machine-planning";
import { cn, fmtDateTime } from "@/lib/utils";
import { downloadFile } from "@/lib/download";
import { Factory, AlertTriangle, AlertCircle, FileSpreadsheet, Download, Filter } from "lucide-react";

function fmt(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default function MachinePlanningPage() {
  const { month, isMonthAvailable, isAvailableMonthsLoading } = useMonth();
  const { segment } = useSegment();
  const [downloading, setDownloading] = useState<string | null>(null);
  
  const [allocationFilter, setAllocationFilter] = useState("");

  const { data, isLoading, error } = useMachinePlanning(month, segment);

  const handleDownload = async (type: "machine-wise" | "planning-format") => {
    setDownloading(type);
    const base = import.meta.env.BASE_URL;
    const url = `${base}api/machine-planning/export/${type}?month=${encodeURIComponent(month)}&segment=${encodeURIComponent(segment)}`;
    const prefix = segment === "Plumbing" ? "Plumbing" : "PTMT";
    const filename = type === "machine-wise" 
      ? `${prefix}_Machine_Wise_${month}.xlsx` 
      : `${prefix}_Planning_Format_${month}.xlsx`;

    try {
      await downloadFile(url, filename);
    } catch (err) {
      console.error(err);
      // maybe add a toast here
    } finally {
      setDownloading(null);
    }
  };

  const filteredAllocations = useMemo(() => {
    if (!data?.allocations) return [];
    if (!allocationFilter) return data.allocations;
    const lower = allocationFilter.toLowerCase();
    return data.allocations.filter((a) => a.machine?.toLowerCase().includes(lower) || a.code?.toLowerCase().includes(lower));
  }, [data?.allocations, allocationFilter]);

  if (isAvailableMonthsLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[50vh]">Loading available months...</div>
      </AppLayout>
    );
  }

  if (!isMonthAvailable && segment !== "PTMT") {
    return (
      <AppLayout>
        <MonthEmptyState
          segment={segment}
          onCreateTemporaryPlan={() => {}}
          isCreatingTemporaryPlan={false}
        />
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6 max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <Factory className="h-6 w-6 text-primary" />
              Machine Planning
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {month} · {segment} · Machine allocation and demand coverage
            </p>
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!data?.available || downloading === "machine-wise"}
              onClick={() => handleDownload("machine-wise")}
              className="gap-2"
            >
              <FileSpreadsheet className="h-4 w-4" />
              {downloading === "machine-wise" ? "Generating..." : "Machine-wise Excel"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!data?.available || downloading === "planning-format"}
              onClick={() => handleDownload("planning-format")}
              className="gap-2"
            >
              <Download className="h-4 w-4" />
              {downloading === "planning-format" ? "Generating..." : "Planning-format Excel"}
            </Button>
          </div>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center min-h-[50vh] text-muted-foreground animate-pulse">
            Loading machine planning data...
          </div>
        )}

        {error && (
          <div className="rounded-md border border-destructive bg-destructive/10 p-4 text-sm text-destructive font-medium">
            Could not load machine planning data. Please check the network connection.
          </div>
        )}

        {data && !data.available && (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5" />
                <div>
                  <h3 className="font-semibold text-amber-900">Not Available</h3>
                  <p className="text-sm text-amber-800 mt-1">{data.reason}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {data?.available && (
          <>
            {/* Provenance / Staleness */}
            <div className="rounded-md border bg-muted/30 p-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-muted-foreground uppercase tracking-wider">Run</span>
                <Badge variant="outline" className="font-mono bg-background">#{data.runId}</Badge>
              </div>
              {data.attemptId && (
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-muted-foreground uppercase tracking-wider">Attempt</span>
                  <Badge variant="outline" className="font-mono bg-background">#{data.attemptId}</Badge>
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-muted-foreground uppercase tracking-wider">Status</span>
                <Badge className={cn(
                  data.status === "finalized" ? "bg-green-100 text-green-800 hover:bg-green-100" : "bg-amber-100 text-amber-800 hover:bg-amber-100",
                )}>{data.status}</Badge>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-muted-foreground uppercase tracking-wider">Generated</span>
                <span className="font-mono bg-background px-1.5 py-0.5 border rounded-sm">{data.generatedAt ? fmtDateTime(data.generatedAt) : "N/A"}</span>
              </div>
              {data.weekDays && data.weekDays.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-muted-foreground uppercase tracking-wider">Working Days</span>
                  <span className="font-mono bg-background px-1.5 py-0.5 border rounded-sm">
                    W1: {data.weekDays[0]} · W2: {data.weekDays[1]} · W3: {data.weekDays[2]} · W4: {data.weekDays[3]}
                  </span>
                </div>
              )}
              {data.superseded && (
                <div className="flex items-center gap-1.5 text-amber-700 font-medium ml-auto">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Superseded by Run #{data.supersedingId}
                </div>
              )}
            </div>

            {/* Headline Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Coverage (Pieces)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex justify-between items-baseline mb-1">
                    <span className="text-2xl font-bold">{fmt(data.headline.scheduledPieces)}</span>
                    <span className="text-xs text-muted-foreground">Scheduled</span>
                  </div>
                  <div className="flex justify-between items-baseline">
                    <span className="text-lg font-semibold text-destructive">{fmt(data.headline.notScheduledPieces)}</span>
                    <span className="text-xs text-muted-foreground">Not Scheduled</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Products</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex justify-between items-baseline mb-1">
                    <span className="text-2xl font-bold">{fmt(data.headline.productsCovered)}</span>
                    <span className="text-xs text-muted-foreground">Covered</span>
                  </div>
                  <div className="flex justify-between items-baseline">
                    <span className="text-lg font-semibold">{fmt(data.headline.routingRosterProducts)}</span>
                    <span className="text-xs text-muted-foreground">In Roster</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Machines Used (Moulding)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-baseline gap-2 mt-2">
                    <span className="text-3xl font-bold text-primary">{fmt(data.headline.mouldingMachinesUsed)}</span>
                    <span className="text-sm font-medium text-muted-foreground">of {fmt(data.headline.mouldingMachinesTotal)}</span>
                  </div>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Machines Used (Pipe)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-baseline gap-2 mt-2">
                    <span className="text-3xl font-bold text-primary">{fmt(data.headline.pipeMachinesUsed)}</span>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
              {/* Reason Breakdown */}
              <Card className="lg:col-span-1">
                <CardHeader>
                  <CardTitle className="text-sm">Not Scheduled Reasons</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="py-2 h-auto text-xs">Reason</TableHead>
                        <TableHead className="py-2 h-auto text-right text-xs">Pieces</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.reasons.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={2} className="text-center text-xs text-muted-foreground py-4">No unfulfilled demand.</TableCell>
                        </TableRow>
                      )}
                      {data.reasons.map((r, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-xs">
                            <span className={cn(
                              "block font-medium",
                              r.reason === "material-fallback" ? "text-amber-700" : ""
                            )}>
                              {r.label}
                            </span>
                            {r.reason === "material-fallback" && (
                              <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] bg-amber-100 text-amber-800 font-semibold uppercase tracking-wider">
                                Estimated
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs tabular-nums">{fmt(r.pieces)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {/* Concentration */}
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="text-sm">Machine Concentration</CardTitle>
                  <CardDescription className="text-xs">Product overlap and machine distribution</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  {data.concentration.some((c) => c.overlapWarning) && (
                    <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 flex items-start gap-2 text-xs text-amber-800">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      <span>{data.concentration.find((c) => c.overlapWarning)?.overlapWarning}</span>
                    </div>
                  )}
                  <div className="overflow-auto max-h-64">
                    <Table>
                      <TableHeader className="bg-muted/50 sticky top-0">
                        <TableRow>
                          <TableHead className="py-2 h-auto text-xs">Machine</TableHead>
                          <TableHead className="py-2 h-auto text-xs">Pool</TableHead>
                          <TableHead className="py-2 h-auto text-right text-xs">Products</TableHead>
                          <TableHead className="py-2 h-auto text-right text-xs">Single-Machine</TableHead>
                          <TableHead className="py-2 h-auto text-right text-xs">Pieces</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.concentration.map((c, i) => (
                          <TableRow key={i}>
                            <TableCell className="font-medium text-xs">{c.machine}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{c.pool}</TableCell>
                            <TableCell className="text-right font-mono text-xs">{fmt(c.products)}</TableCell>
                            <TableCell className="text-right font-mono text-xs">{fmt(c.singleMachineCount)}</TableCell>
                            <TableCell className="text-right font-mono text-xs tabular-nums">{fmt(c.pieces)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Per-Machine Table */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Machine Hours & Utilization</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-auto">
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="py-2 h-auto text-xs whitespace-nowrap min-w-[120px]">Machine</TableHead>
                        <TableHead className="py-2 h-auto text-xs">Pool</TableHead>
                        <TableHead className="py-2 h-auto text-xs min-w-[150px]">Materials</TableHead>
                        {[1, 2, 3, 4].map(w => (
                          <TableHead key={w} className="py-2 h-auto text-right text-xs whitespace-nowrap">W{w} Util</TableHead>
                        ))}
                        <TableHead className="py-2 h-auto text-right text-xs border-l bg-muted/30">Total Avail</TableHead>
                        <TableHead className="py-2 h-auto text-right text-xs bg-muted/30">Total Used</TableHead>
                        <TableHead className="py-2 h-auto text-right text-xs bg-muted/30">Total Idle</TableHead>
                        <TableHead className="py-2 h-auto text-right text-xs font-semibold bg-muted/30">Util %</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.machines.map((m) => (
                        <TableRow key={m.machine}>
                          <TableCell className="font-medium text-xs whitespace-nowrap">{m.machine}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{m.pool}</TableCell>
                          <TableCell className="text-[11px] text-muted-foreground truncate max-w-[200px]" title={m.materials}>{m.materials}</TableCell>
                          {m.weeks.map(w => (
                            <TableCell key={w.week} className={cn(
                              "text-right font-mono text-xs tabular-nums",
                              w.utilization >= 100 ? "text-destructive font-bold" :
                              w.utilization >= 90 ? "text-amber-600 font-medium" : ""
                            )}>
                              {w.utilization.toFixed(1)}%
                            </TableCell>
                          ))}
                          <TableCell className="text-right font-mono text-xs tabular-nums border-l bg-muted/10">{fmt(m.month.available)}</TableCell>
                          <TableCell className="text-right font-mono text-xs tabular-nums bg-muted/10">{fmt(m.month.used)}</TableCell>
                          <TableCell className="text-right font-mono text-xs tabular-nums bg-muted/10 text-muted-foreground">{fmt(m.month.idle)}</TableCell>
                          <TableCell className={cn(
                            "text-right font-mono text-xs tabular-nums font-semibold bg-muted/10",
                            m.month.utilization >= 100 ? "text-destructive" :
                            m.month.utilization >= 90 ? "text-amber-600" : ""
                          )}>
                            {m.month.utilization.toFixed(1)}%
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* Per-Item Allocation Table */}
            <Card>
              <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4">
                <CardTitle className="text-sm">Item Allocations</CardTitle>
                <div className="relative w-full sm:w-64">
                  <Filter className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
                  <Input 
                    placeholder="Filter by machine or code..." 
                    className="pl-8 h-8 text-xs"
                    value={allocationFilter}
                    onChange={(e) => setAllocationFilter(e.target.value)}
                  />
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-auto max-h-[600px]">
                  <Table>
                    <TableHeader className="bg-muted/50 sticky top-0 z-10">
                      <TableRow>
                        <TableHead className="py-2 h-auto text-xs whitespace-nowrap">Item Code</TableHead>
                        <TableHead className="py-2 h-auto text-xs">Name</TableHead>
                        <TableHead className="py-2 h-auto text-xs">Category</TableHead>
                        <TableHead className="py-2 h-auto text-xs">Machine</TableHead>
                        <TableHead className="py-2 h-auto text-right text-xs">Week</TableHead>
                        <TableHead className="py-2 h-auto text-right text-xs">Net Pieces</TableHead>
                        <TableHead className="py-2 h-auto text-right text-xs">Hours</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredAllocations.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center py-8 text-muted-foreground text-sm">
                            No allocations found.
                          </TableCell>
                        </TableRow>
                      ) : (
                        filteredAllocations.map((a, i) => (
                          <TableRow key={`${a.code}-${a.machine}-${a.week}-${i}`}>
                            <TableCell className="font-medium text-xs whitespace-nowrap">
                              {a.code}
                              {a.isFallback && (
                                <Badge variant="secondary" className="ml-2 text-[9px] py-0 px-1 bg-amber-100 text-amber-800 border-amber-200">Fallback</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-xs max-w-[200px] truncate" title={a.name}>{a.name}</TableCell>
                            <TableCell className="text-[11px] text-muted-foreground">{a.category}</TableCell>
                            <TableCell className="text-xs font-semibold">{a.machine || "(unassigned)"}</TableCell>
                            <TableCell className="text-right text-xs">{a.week ? `W${a.week}` : "-"}</TableCell>
                            <TableCell className="text-right font-mono text-xs tabular-nums">{fmt(a.netPieces)}</TableCell>
                            <TableCell className="text-right font-mono text-[11px] tabular-nums text-muted-foreground">{a.hours.toFixed(1)}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* Unscheduled / Data-limited Table */}
            {data.unscheduled.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Unscheduled Demand</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-auto max-h-[400px]">
                    <Table>
                      <TableHeader className="bg-muted/50 sticky top-0">
                        <TableRow>
                          <TableHead className="py-2 h-auto text-xs whitespace-nowrap">Item Code</TableHead>
                          <TableHead className="py-2 h-auto text-xs">Name</TableHead>
                          <TableHead className="py-2 h-auto text-xs">Category</TableHead>
                          <TableHead className="py-2 h-auto text-xs">Reason</TableHead>
                          <TableHead className="py-2 h-auto text-right text-xs">Pieces</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.unscheduled.map((u, i) => (
                          <TableRow key={`${u.code}-${i}`}>
                            <TableCell className="font-medium text-xs whitespace-nowrap">{u.code}</TableCell>
                            <TableCell className="text-xs max-w-[200px] truncate" title={u.name}>{u.name}</TableCell>
                            <TableCell className="text-[11px] text-muted-foreground">{u.category}</TableCell>
                            <TableCell className="text-[11px] text-muted-foreground">
                              {u.reason === "material-fallback" || u.reason === "material unknown / withheld" ? (
                                <span className="text-amber-700 font-medium">{u.reason}</span>
                              ) : (
                                u.reason
                              )}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs tabular-nums text-destructive font-medium">{fmt(u.pieces)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}

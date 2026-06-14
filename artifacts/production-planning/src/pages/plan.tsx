import { useState } from "react";
import { useData } from "@/lib/data-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Calculator, Save, AlertTriangle, Layers } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDateTime } from "@/lib/utils";

export default function Plan() {
  const { division, planMonth, planLines, planRuns, buildPlan, role, categorySummaries, isBuilding } = useData();
  const { toast } = useToast();
  
  const [multiplierMode, setMultiplierMode] = useState<"single"|"minmax"|"overrides">("single");
  const [singleVal, setSingleVal] = useState<string>("1.5");
  const [minVal, setMinVal] = useState<string>("1.0");
  const [maxVal, setMaxVal] = useState<string>("2.0");
  const [overrideVals, setOverrideVals] = useState<Record<string, string>>({});
  
  const activeRun = planRuns[0];

  const handleBuild = async () => {
    try {
      if (multiplierMode === "single") {
        await buildPlan("single", parseFloat(singleVal));
      } else if (multiplierMode === "minmax") {
        await buildPlan("minmax", parseFloat(minVal), parseFloat(maxVal));
      } else {
        const overrides: Record<string, number> = {};
        for (const [category, raw] of Object.entries(overrideVals)) {
          const num = parseFloat(raw);
          if (raw.trim() !== "" && !Number.isNaN(num)) {
            overrides[category] = num;
          }
        }
        if (Object.keys(overrides).length === 0) {
          toast({
            title: "No overrides entered",
            description: "Enter a multiplier for at least one category before running the engine.",
            variant: "destructive",
          });
          return;
        }
        await buildPlan("overrides", undefined, undefined, overrides);
      }

      toast({
        title: "Plan Generated",
        description: `New plan run created for ${division} ${planMonth}`,
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Plan build failed",
        description: err instanceof Error ? err.message : "Could not build the plan.",
      });
    }
  };

  return (
    <div className="space-y-6 flex flex-col h-full animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Production Plan</h1>
          <p className="text-muted-foreground">Buffer-based engine for {division} • {planMonth}</p>
        </div>
        {activeRun && (
          <Button asChild variant="outline" className="gap-2 shrink-0">
            <a href={`/api/plan/runs/${activeRun.id}/export`}>
              <Save className="h-4 w-4" />
              Export Excel
            </a>
          </Button>
        )}
      </div>

      {role !== "viewer" && (
        <Card className="shrink-0 border-primary/20 shadow-sm">
          <CardHeader className="pb-3 bg-muted/20">
            <CardTitle className="text-lg flex items-center gap-2">
              <Calculator className="h-5 w-5 text-primary" />
              Engine Configuration
            </CardTitle>
            <CardDescription>Set multipliers to calculate buffer targets.</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="flex flex-col md:flex-row gap-6">
              <div className="w-full md:w-48 space-y-2">
                <Label>Mode</Label>
                <Select value={multiplierMode} onValueChange={(v: any) => setMultiplierMode(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="single">Single Multiplier</SelectItem>
                    <SelectItem value="minmax">Min/Max Band</SelectItem>
                    <SelectItem value="overrides">Category Overrides</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex-1 flex flex-col md:flex-row items-end gap-4">
                {multiplierMode === "single" && (
                  <div className="w-full md:w-32 space-y-2">
                    <Label>Multiplier</Label>
                    <Input type="number" step="0.1" value={singleVal} onChange={e => setSingleVal(e.target.value)} />
                  </div>
                )}
                
                {multiplierMode === "minmax" && (
                  <>
                    <div className="w-full md:w-32 space-y-2">
                      <Label>Min Multiplier</Label>
                      <Input type="number" step="0.1" value={minVal} onChange={e => setMinVal(e.target.value)} />
                    </div>
                    <div className="w-full md:w-32 space-y-2">
                      <Label>Max Multiplier</Label>
                      <Input type="number" step="0.1" value={maxVal} onChange={e => setMaxVal(e.target.value)} />
                    </div>
                  </>
                )}

                {multiplierMode === "overrides" && (
                  <div className="w-full space-y-2">
                    <Label className="flex items-center gap-2">
                      <Layers className="h-4 w-4" /> Per-Category Multipliers
                    </Label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {categorySummaries.map(cat => (
                        <div key={cat.category} className="space-y-1">
                          <span className="text-xs text-muted-foreground">{cat.category}</span>
                          <Input
                            type="number"
                            step="0.1"
                            placeholder="e.g. 1.5"
                            value={overrideVals[cat.category] ?? ""}
                            onChange={e => setOverrideVals(prev => ({ ...prev, [cat.category]: e.target.value }))}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <Button onClick={handleBuild} disabled={isBuilding} className="w-full md:w-auto mt-4 md:mt-0 ml-auto gap-2">
                  <Calculator className="h-4 w-4" />
                  {isBuilding ? "Running..." : "Run Engine"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {activeRun && (
        <div className="flex items-center gap-3 text-sm text-muted-foreground bg-muted/30 p-3 rounded-md border shrink-0">
          <Badge variant="outline" className="bg-background">Active Run: {activeRun.id.slice(-6)}</Badge>
          <span>
            Mode: <strong>{activeRun.multiplierMode}</strong>
            {activeRun.multiplierMode === "single" && ` (${activeRun.multiplier})`}
            {activeRun.multiplierMode === "minmax" && ` (${activeRun.multiplierMin} - ${activeRun.multiplierMax})`}
          </span>
          <span className="ml-auto hidden sm:inline">Generated: {formatDateTime(activeRun.createdAt)}</span>
        </div>
      )}

      <div className="flex-1 min-h-[400px] border rounded-md bg-card flex flex-col overflow-hidden shadow-sm">
        {/* Desktop Table View */}
        <div className="hidden md:flex flex-1 overflow-hidden">
          <ScrollArea className="flex-1">
            <div className="min-w-[1200px]">
              <Table>
                <TableHeader className="bg-muted/50 sticky top-0 z-10 shadow-sm">
                  <TableRow>
                    <TableHead className="w-[120px]">Item Code</TableHead>
                    <TableHead>Details</TableHead>
                    <TableHead className="text-right">Run Rate</TableHead>
                    <TableHead className="text-right">Buffer Target</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                    <TableHead className="text-right">Pending</TableHead>
                    <TableHead className="text-right">Prod. Req</TableHead>
                    <TableHead className="text-right">Coverage</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {planLines.map((line) => (
                    <TableRow key={line.id} className={line.urgent ? "bg-red-500/5 hover:bg-red-500/10" : ""}>
                      <TableCell className="font-medium font-mono text-xs">{line.itemCode}</TableCell>
                      <TableCell>
                        <div className="text-sm font-medium">{line.category}</div>
                        <div className="text-xs text-muted-foreground">{line.colour} {line.model ? `• ${line.model}` : ''}</div>
                      </TableCell>
                      <TableCell className="text-right font-mono">{line.runRate}</TableCell>
                      <TableCell className="text-right font-mono font-medium text-primary">
                        {line.bufferTarget || `${line.bufferTargetMin}-${line.bufferTargetMax}`}
                      </TableCell>
                      <TableCell className="text-right font-mono">{line.openingStock}</TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">
                        {line.pendingCurrent + line.pendingLast}
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                        {line.productionRequired}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline" className={`${line.coverage < 1 ? 'border-red-500 text-red-600' : 'border-green-500 text-green-600'}`}>
                          {line.coverage.toFixed(1)}x
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </div>

        {/* Mobile Card View */}
        <div className="md:hidden flex-1 overflow-auto p-4 space-y-4 bg-muted/10">
          {planLines.map((line) => (
            <Card key={line.id} className={`overflow-hidden ${line.urgent ? 'border-red-200 dark:border-red-900/50' : ''}`}>
              <div className={`h-1 w-full ${line.urgent ? 'bg-destructive' : 'bg-primary'}`} />
              <div className="p-4 space-y-4">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-mono font-bold text-sm">{line.itemCode}</div>
                    <div className="text-sm font-medium mt-1">{line.category}</div>
                    <div className="text-xs text-muted-foreground">{line.colour} {line.model ? `• ${line.model}` : ''}</div>
                  </div>
                  <Badge variant="outline" className={`${line.coverage < 1 ? 'border-red-500 text-red-600 bg-red-50 dark:bg-red-950/20' : 'border-green-500 text-green-600 bg-green-50 dark:bg-green-950/20'}`}>
                    {line.coverage.toFixed(1)}x cov
                  </Badge>
                </div>
                
                <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm bg-muted/30 p-3 rounded-md">
                  <div>
                    <div className="text-xs text-muted-foreground uppercase">Run Rate</div>
                    <div className="font-mono">{line.runRate}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground uppercase">Target</div>
                    <div className="font-mono font-medium text-primary">{line.bufferTarget || `${line.bufferTargetMin}-${line.bufferTargetMax}`}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground uppercase">Stock</div>
                    <div className="font-mono">{line.openingStock}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground uppercase">Pending</div>
                    <div className="font-mono">{line.pendingCurrent + line.pendingLast}</div>
                  </div>
                </div>
                
                <div className="flex justify-between items-center pt-2 border-t">
                  <span className="text-sm font-semibold uppercase tracking-wider">Prod. Req</span>
                  <span className="text-xl font-bold font-mono text-emerald-600 dark:text-emerald-400">{line.productionRequired}</span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

import { useData } from "@/lib/data-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Database, Download, AlertTriangle, CheckCircle2, XCircle, ChevronRight, Activity, FileDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ValidationFinding } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

function FindingRow({ finding }: { finding: ValidationFinding }) {
  const Icon = finding.severity === 'block' ? XCircle : finding.severity === 'warn' ? AlertTriangle : CheckCircle2;
  const colorClass = finding.severity === 'block' ? 'text-destructive' : finding.severity === 'warn' ? 'text-amber-500' : 'text-blue-500';
  const bgClass = finding.severity === 'block' ? 'bg-destructive/10' : finding.severity === 'warn' ? 'bg-amber-500/10' : 'bg-blue-500/10';

  return (
    <div className={`p-4 rounded-lg border ${bgClass} border-transparent flex gap-4 items-start`}>
      <Icon className={`h-5 w-5 mt-0.5 shrink-0 ${colorClass}`} />
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm capitalize">{finding.type.replace('_', ' ')}</span>
          <Badge variant="outline" className={`text-[10px] ${colorClass} border-${finding.severity === 'block' ? 'red' : 'amber'}-200`}>
            {finding.severity}
          </Badge>
        </div>
        <p className="text-sm">{finding.message}</p>
        <div className="text-xs font-mono text-muted-foreground bg-background/50 p-2 rounded mt-2">
          Evidence: {finding.evidence}
        </div>
        <p className="text-xs mt-2 font-medium">Fix: {finding.suggestedFix}</p>
      </div>
    </div>
  );
}

export default function DataPage() {
  const { division, planMonth, importBatches, sanityResult, pullData, acknowledgeWarnings, role, isPulling } = useData();
  const { toast } = useToast();

  const sanityReportHref = `/api/data/sanity/report?division=${encodeURIComponent(division)}&planMonth=${encodeURIComponent(`${planMonth}-01`)}`;
  const canDownloadSanity = Boolean(sanityResult);

  const SanityReportButton = ({ className }: { className?: string }) =>
    canDownloadSanity ? (
      <a href={sanityReportHref} target="_blank" rel="noopener noreferrer" className={className}>
        <Button variant="outline" className="gap-2 w-full">
          <FileDown className="h-4 w-4" />
          Download Sanity Report (PDF)
        </Button>
      </a>
    ) : (
      <Button variant="outline" className={`gap-2 ${className ?? ""}`} disabled title="Pull data to generate a sanity report">
        <FileDown className="h-4 w-4" />
        Download Sanity Report (PDF)
      </Button>
    );

  const handlePull = async () => {
    try {
      await pullData();
      toast({
        title: "Data Pull Complete",
        description: "Successfully fetched and validated source data.",
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Data Pull Failed",
        description: err instanceof Error ? err.message : "Could not pull data from source.",
      });
    }
  };

  const handleAcknowledge = async () => {
    try {
      await acknowledgeWarnings();
      toast({ title: "Warnings acknowledged", description: "You may now build the plan." });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Acknowledge failed",
        description: err instanceof Error ? err.message : "Could not acknowledge warnings.",
      });
    }
  };

  const latestBatch = importBatches[0];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Data Pipeline</h1>
          <p className="text-muted-foreground">Source integration & sanity checks for {division}</p>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-2 shrink-0">
          <SanityReportButton />
          {role !== "viewer" && (
            <Button onClick={handlePull} disabled={isPulling} className="gap-2 shrink-0">
              <Download className="h-4 w-4" />
              {isPulling ? "Pulling..." : "Pull Latest Data"}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <Activity className="h-5 w-5 text-primary" />
                Sanity Gate
              </CardTitle>
              <CardDescription>Layer B: AI Semantic Validation</CardDescription>
            </CardHeader>
            <CardContent>
              {sanityResult ? (
                <div className="space-y-6">
                  <div className="flex items-center gap-4 p-4 rounded-lg border bg-muted/30">
                    <div className="shrink-0">
                      {sanityResult.verdict === 'ok' && <CheckCircle2 className="h-10 w-10 text-green-500" />}
                      {sanityResult.verdict === 'warn' && <AlertTriangle className="h-10 w-10 text-amber-500" />}
                      {sanityResult.verdict === 'block' && <XCircle className="h-10 w-10 text-destructive" />}
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg capitalize">{sanityResult.verdict}</h3>
                      <p className="text-sm text-muted-foreground">{sanityResult.summary}</p>
                    </div>
                    <div className="ml-auto hidden sm:block text-right text-xs text-muted-foreground">
                      <div>Engine: {sanityResult.model}</div>
                      <div>Tier: {sanityResult.tier}</div>
                    </div>
                  </div>

                  {sanityResult.findings.length > 0 && (
                    <div className="space-y-3">
                      <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Identified Issues</h4>
                      {sanityResult.findings.map((f, i) => (
                        <FindingRow key={i} finding={f} />
                      ))}
                    </div>
                  )}

                  {sanityResult.verdict === 'warn' && role !== "viewer" && (
                    <Button variant="outline" className="w-full mt-4 bg-amber-500/5 text-amber-700 hover:bg-amber-500/10 border-amber-200" onClick={handleAcknowledge}>
                      Acknowledge Warnings & Proceed
                    </Button>
                  )}
                  {sanityResult.verdict === 'block' && role !== "viewer" && (
                    <Button variant="destructive" className="w-full mt-4" onClick={handlePull}>
                      Re-fetch Data
                    </Button>
                  )}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  No sanity results available. Pull data to run checks.
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Database className="h-5 w-5 text-primary" />
                Latest Sync Batch
              </CardTitle>
            </CardHeader>
            <CardContent>
              {latestBatch ? (
                <div className="space-y-4">
                  <div className="text-sm">
                    <span className="text-muted-foreground">Source: </span> {latestBatch.source}
                  </div>
                  <div className="text-sm">
                    <span className="text-muted-foreground">Time: </span> {formatDateTime(latestBatch.createdAt)}
                  </div>
                  
                  <div className="pt-4 space-y-3">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Table Summary</h4>
                    {latestBatch.perTable.map((t, i) => (
                      <div key={i} className="bg-muted/40 p-3 rounded text-sm space-y-2">
                        <div className="font-medium flex items-center justify-between">
                          {t.table}
                        </div>
                        <div className="grid grid-cols-4 gap-2 text-center text-xs">
                          <div>
                            <div className="text-green-600 font-mono">{t.added}</div>
                            <div className="text-muted-foreground text-[10px] uppercase">Add</div>
                          </div>
                          <div>
                            <div className="text-blue-600 font-mono">{t.updated}</div>
                            <div className="text-muted-foreground text-[10px] uppercase">Upd</div>
                          </div>
                          <div>
                            <div className="text-amber-600 font-mono">{t.skipped}</div>
                            <div className="text-muted-foreground text-[10px] uppercase">Skip</div>
                          </div>
                          <div>
                            <div className="text-destructive font-mono">{t.rejected}</div>
                            <div className="text-muted-foreground text-[10px] uppercase">Rej</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">No recent sync history.</div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <SanityReportButton className="w-full sm:w-auto" />
      </div>
    </div>
  );
}

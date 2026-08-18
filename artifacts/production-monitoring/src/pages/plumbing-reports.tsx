import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, Download, RefreshCw, ExternalLink } from "lucide-react";

interface Run {
  id: number;
  month: string;
  segment: string;
  weekClosed: number;
  revisedMonthTotal: number;
  producedToDate: number;
  note: string | null;
  createdAt: string;
}

function fmtN(n: number | null | undefined) {
  if (n == null) return "–";
  return Math.round(n).toLocaleString("en-IN");
}
function fmtDate(s: string) {
  return new Date(s).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function PlumbingReports({ month }: { month: string }) {
  const [runs, setRuns]         = useState<Run[]>([]);
  const [loading, setLoading]   = useState(false);
  const [loaded, setLoaded]     = useState(false);
  const [loadError, setLoadError]       = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting]   = useState<number | null>(null);

  async function loadRuns() {
    try {
      setRefreshing(true);
      setLoadError(null);
      const res = await fetch(`/api/corrective/runs?month=${month}&segment=Plumbing`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRuns(await res.json());
    } catch (e: any) {
      setLoadError(e.message ?? String(e));
    } finally { setLoading(false); setLoaded(true); setRefreshing(false); }
  }

  async function downloadExcel(runId: number) {
    setExporting(runId);
    setDownloadError(null);
    try {
      const res = await fetch(`/api/corrective/runs/${runId}/export/excel`);
      if (!res.ok) throw new Error(`Excel export failed: HTTP ${res.status}`);
      const blob = await res.blob();
      const cd   = res.headers.get("content-disposition") ?? "";
      const name = cd.match(/filename="?([^";]+)"?/)?.[1] ?? `Plumbing_Corrective_${month}.xlsx`;
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url; a.download = name; a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setDownloadError(e.message ?? String(e));
    } finally { setExporting(null); }
  }

  async function downloadPdf(runId: number) {
    setExporting(runId * -1);
    setDownloadError(null);
    try {
      const res = await fetch(`/api/corrective/runs/${runId}/export/pdf`);
      if (!res.ok) throw new Error(`PDF export failed: HTTP ${res.status}`);
      const blob = await res.blob();
      const cd   = res.headers.get("content-disposition") ?? "";
      const name = cd.match(/filename="?([^";]+)"?/)?.[1] ?? `Plumbing_Corrective_${month}.pdf`;
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url; a.download = name; a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setDownloadError(e.message ?? String(e));
    } finally { setExporting(null); }
  }

  return (
    <div className="space-y-6 max-w-[1000px] mx-auto pb-10">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2 mb-1">
            <FileText className="h-6 w-6 text-primary" /> Plumbing Reports
          </h1>
          <p className="text-muted-foreground text-sm">
            Corrective re-plan exports and run history · {month}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={loadRuns} disabled={refreshing} className="gap-2">
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Loading…" : loaded ? "Refresh" : "Load runs"}
        </Button>
      </header>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Corrective Re-plan Runs</CardTitle>
          <CardDescription>
            Each run is a point-in-time corrective plan snapshot. Download as Excel or PDF.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {!loaded ? (
            <div className="px-6 py-10 text-center text-muted-foreground text-sm">
              Click "Load runs" to fetch corrective plan history for {month}.
            </div>
          ) : loadError ? (
            <div className="px-6 py-4 text-sm text-red-600 bg-red-500/10 border-t border-red-500/20">
              Failed to load runs: {loadError}
            </div>
          ) : runs.length === 0 ? (
            <div className="px-6 py-10 text-center text-muted-foreground text-sm">
              No corrective re-plan runs found for Plumbing · {month}.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 border-y border-border/50">
                  <tr>
                    <th className="text-left py-2.5 px-4 font-medium text-muted-foreground">Run</th>
                    <th className="text-left py-2.5 px-3 font-medium text-muted-foreground">Week</th>
                    <th className="text-right py-2.5 px-3 font-medium text-muted-foreground">Plan Total</th>
                    <th className="text-right py-2.5 px-3 font-medium text-muted-foreground">Produced</th>
                    <th className="text-left py-2.5 px-3 font-medium text-muted-foreground">Note</th>
                    <th className="text-left py-2.5 px-4 font-medium text-muted-foreground">Created</th>
                    <th className="py-2.5 px-4"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {runs.map((run) => (
                    <tr key={run.id} className="hover:bg-muted/20">
                      <td className="py-2.5 px-4 font-mono text-muted-foreground text-xs">#{run.id}</td>
                      <td className="py-2.5 px-3">
                        <Badge variant="outline" className="text-xs">W{run.weekClosed}</Badge>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono">{fmtN(run.revisedMonthTotal)}</td>
                      <td className="py-2.5 px-3 text-right font-mono">{fmtN(run.producedToDate)}</td>
                      <td className="py-2.5 px-3 text-muted-foreground text-xs max-w-[200px] truncate">{run.note ?? "—"}</td>
                      <td className="py-2.5 px-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(run.createdAt)}</td>
                      <td className="py-2.5 px-4">
                        <div className="flex gap-2 justify-end">
                          <Button
                            size="sm" variant="outline" className="h-7 gap-1.5 text-xs"
                            onClick={() => downloadExcel(run.id)}
                            disabled={exporting === run.id || exporting === run.id * -1}
                          >
                            <Download className="h-3 w-3" /> Excel
                          </Button>
                          <Button
                            size="sm" variant="outline" className="h-7 gap-1.5 text-xs"
                            onClick={() => downloadPdf(run.id)}
                            disabled={exporting === run.id || exporting === run.id * -1}
                          >
                            <FileText className="h-3 w-3" /> PDF
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

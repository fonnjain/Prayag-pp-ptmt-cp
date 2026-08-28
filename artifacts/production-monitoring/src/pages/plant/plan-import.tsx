import { useState, useRef, useCallback } from "react";
import { Upload, FileSpreadsheet, Trash2, CheckCircle2, AlertCircle, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { fmtDateTime } from "@/lib/utils";

// ─── types ────────────────────────────────────────────────────────────────────

interface SummaryRow {
  type: string;
  material: string;
  requestedPcs: number;
  feasiblePcs: number;
  shortfallPcs: number;
  shortfallPct: string;
  requestedKg: number;
  feasibleKg: number;
  shortfallKg: number;
}

interface UploadRecord {
  id: number;
  month: string;
  segment: string;
  filename: string;
  itemCount: number;
  summaryJson: SummaryRow[] | null;
  uploadedAt: string;
}

// ─── formatting helpers ───────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function fmtKg(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)} t`;
  return `${n.toFixed(0)} kg`;
}

function pct(feasible: number, requested: number) {
  if (requested === 0) return "–";
  return `${((feasible / requested) * 100).toFixed(1)}%`;
}

const MATERIAL_COLORS: Record<string, string> = {
  CPVC: "bg-blue-100 text-blue-700",
  SWR:  "bg-green-100 text-green-700",
  UPVC: "bg-purple-100 text-purple-700",
  AGRI: "bg-amber-100 text-amber-700",
};

// ─── SummaryTable ─────────────────────────────────────────────────────────────

function SummaryTable({ rows }: { rows: SummaryRow[] }) {
  if (rows.length === 0) return null;

  const totals = rows.reduce(
    (acc, r) => ({
      requestedPcs: acc.requestedPcs + r.requestedPcs,
      feasiblePcs:  acc.feasiblePcs  + r.feasiblePcs,
      shortfallPcs: acc.shortfallPcs + r.shortfallPcs,
      requestedKg:  acc.requestedKg  + r.requestedKg,
      feasibleKg:   acc.feasibleKg   + r.feasibleKg,
    }),
    { requestedPcs: 0, feasiblePcs: 0, shortfallPcs: 0, requestedKg: 0, feasibleKg: 0 },
  );

  return (
    <div className="overflow-x-auto rounded-md border border-border/50">
      <table className="w-full text-sm">
        <thead className="bg-muted/40">
          <tr className="text-muted-foreground text-xs">
            <th className="text-left px-3 py-2 font-medium">Type</th>
            <th className="text-left px-3 py-2 font-medium">Material</th>
            <th className="text-right px-3 py-2 font-medium">Requested pcs</th>
            <th className="text-right px-3 py-2 font-medium">Feasible pcs</th>
            <th className="text-right px-3 py-2 font-medium">Shortfall pcs</th>
            <th className="text-right px-3 py-2 font-medium">Attainment</th>
            <th className="text-right px-3 py-2 font-medium">Req. kg</th>
            <th className="text-right px-3 py-2 font-medium">Feasible kg</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const hasShortfall = r.shortfallPcs > 0;
            return (
              <tr key={i} className={`border-t border-border/20 ${hasShortfall ? "bg-red-50/40" : ""}`}>
                <td className="px-3 py-1.5 font-medium text-xs">{r.type}</td>
                <td className="px-3 py-1.5">
                  <span className={`text-xs px-1.5 py-0.5 rounded font-mono font-medium ${MATERIAL_COLORS[r.material] ?? "bg-muted text-muted-foreground"}`}>
                    {r.material}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-xs">{fmt(r.requestedPcs)}</td>
                <td className="px-3 py-1.5 text-right font-mono text-xs text-green-700">{fmt(r.feasiblePcs)}</td>
                <td className={`px-3 py-1.5 text-right font-mono text-xs ${hasShortfall ? "text-red-600 font-medium" : "text-muted-foreground"}`}>
                  {fmt(r.shortfallPcs)}
                </td>
                <td className={`px-3 py-1.5 text-right text-xs font-medium ${hasShortfall ? "text-amber-600" : "text-green-600"}`}>
                  {pct(r.feasiblePcs, r.requestedPcs)}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-xs text-muted-foreground">{fmtKg(r.requestedKg)}</td>
                <td className="px-3 py-1.5 text-right font-mono text-xs">{fmtKg(r.feasibleKg)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="border-t-2 border-border bg-muted/20">
          <tr className="font-semibold text-xs">
            <td colSpan={2} className="px-3 py-2 text-muted-foreground">Total</td>
            <td className="px-3 py-2 text-right font-mono">{fmt(totals.requestedPcs)}</td>
            <td className="px-3 py-2 text-right font-mono text-green-700">{fmt(totals.feasiblePcs)}</td>
            <td className={`px-3 py-2 text-right font-mono ${totals.shortfallPcs > 0 ? "text-red-600" : "text-muted-foreground"}`}>
              {fmt(totals.shortfallPcs)}
            </td>
            <td className={`px-3 py-2 text-right ${totals.shortfallPcs > 0 ? "text-amber-600" : "text-green-600"}`}>
              {pct(totals.feasiblePcs, totals.requestedPcs)}
            </td>
            <td className="px-3 py-2 text-right font-mono text-muted-foreground">{fmtKg(totals.requestedKg)}</td>
            <td className="px-3 py-2 text-right font-mono">{fmtKg(totals.feasibleKg)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ─── UploadCard ───────────────────────────────────────────────────────────────

function UploadCard({ record, onDelete, isLatest }: { record: UploadRecord; onDelete: () => void; isLatest?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const summary = record.summaryJson ?? [];
  const totalShortfall = summary.reduce((s, r) => s + r.shortfallPcs, 0);

  async function handleDelete() {
    if (!confirm(`Delete upload "${record.filename}" for ${record.month}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/monitoring/plant-plan/${record.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      onDelete();
      toast({ title: "Upload deleted" });
    } catch {
      toast({ title: "Failed to delete", variant: "destructive" });
      setDeleting(false);
    }
  }

  const date = fmtDateTime(record.uploadedAt);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-card">
        <div className="flex items-center gap-3 min-w-0">
          <FileSpreadsheet className="h-5 w-5 text-green-600 shrink-0" />
          <div className="min-w-0">
            <div className="font-medium text-sm truncate">{record.filename}</div>
            <div className="text-xs text-muted-foreground">{date} · {record.itemCount.toLocaleString()} items</div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-3">
          <Badge variant="outline" className="text-xs font-mono">{record.month}</Badge>
          <Badge variant="secondary" className="text-xs">{record.segment}</Badge>
          {isLatest && (
            <Badge className="text-xs gap-1 bg-indigo-100 text-indigo-700 hover:bg-indigo-100 border-0">
              Latest
            </Badge>
          )}
          {totalShortfall > 0 ? (
            <Badge variant="destructive" className="text-xs gap-1">
              <AlertCircle className="h-3 w-3" /> {fmt(totalShortfall)} shortfall
            </Badge>
          ) : (
            <Badge className="text-xs gap-1 bg-green-100 text-green-700 hover:bg-green-100 border-0">
              <CheckCircle2 className="h-3 w-3" /> Fully feasible
            </Badge>
          )}
          {summary.length > 0 && (
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setExpanded((e) => !e)}>
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          )}
          <Button
            variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive"
            onClick={handleDelete} disabled={deleting}
          >
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {expanded && summary.length > 0 && (
        <div className="px-4 pb-4 pt-2 border-t border-border/50 bg-muted/10">
          <SummaryTable rows={summary} />
        </div>
      )}
    </div>
  );
}

// ─── Dropzone ─────────────────────────────────────────────────────────────────

function Dropzone({ onFile }: { onFile: (f: File) => void }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  }, [onFile]);

  return (
    <div
      className={`relative border-2 border-dashed rounded-xl p-10 flex flex-col items-center gap-3 transition-colors cursor-pointer
        ${dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/20"}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <Upload className={`h-10 w-10 ${dragging ? "text-primary" : "text-muted-foreground"}`} />
      <div className="text-center">
        <div className="font-medium text-sm">Drop your plant plan here, or click to browse</div>
        <div className="text-xs text-muted-foreground mt-1">
          Excel (.xlsx) — Consolidated Plan format (sheet "5. Item Assignment") or legacy "Pipe Plan" / "Fitting Plan"
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        className="sr-only"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
      />
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PlanImport({ month }: { month: string }) {
  const [selectedMonth, setSelectedMonth] = useState(month);
  const [selectedSegment, setSelectedSegment] = useState<"Plumbing" | "PTMT">("Plumbing");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploads, setUploads] = useState<UploadRecord[] | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [lastResult, setLastResult] = useState<{ summary: SummaryRow[]; itemCount: number; filename: string } | null>(null);

  async function loadHistory() {
    setLoadingHistory(true);
    try {
      const params = new URLSearchParams({ month: selectedMonth, segment: selectedSegment });
      const res = await fetch(`/api/monitoring/plant-plan?${params}`);
      if (!res.ok) throw new Error("Failed to load history");
      setUploads(await res.json());
    } catch {
      toast({ title: "Failed to load history", variant: "destructive" });
    } finally {
      setLoadingHistory(false);
    }
  }

  async function handleUpload() {
    if (!selectedFile) return;
    setUploading(true);
    setLastResult(null);
    try {
      const fd = new FormData();
      fd.append("file", selectedFile);
      fd.append("month", selectedMonth);
      fd.append("segment", selectedSegment);
      const res = await fetch("/api/monitoring/plant-plan", { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(err.error ?? "Upload failed");
      }
      const result = await res.json();
      setLastResult({ summary: result.summary ?? [], itemCount: result.itemCount, filename: selectedFile.name });
      setSelectedFile(null);
      toast({ title: "Plan imported", description: `${result.itemCount} items stored as master for ${selectedMonth}` });
      // Refresh history
      await loadHistory();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      toast({ title: "Import failed", description: msg, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  // Load history when segment/month change
  function handleMonthChange(m: string) {
    setSelectedMonth(m);
    setUploads(null);
    setLastResult(null);
  }
  function handleSegmentChange(s: "Plumbing" | "PTMT") {
    setSelectedSegment(s);
    setUploads(null);
    setLastResult(null);
  }

  return (
    <div className="space-y-6 max-w-[960px] mx-auto pb-10">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight mb-1 flex items-center gap-2">
          <Upload className="h-7 w-7 text-primary" /> Plant Production Plan Import
        </h1>
        <p className="text-muted-foreground text-sm">
          Upload the capacity-&amp;-labour-feasible plan received from the plant. The uploaded plan becomes the
          master reference for that month — it is stored with the full item-level feasible vs. requested breakdown.
        </p>
      </header>

      {/* Upload card */}
      <Card className="border-primary/30">
        <CardHeader>
          <CardTitle>Import Plant Plan</CardTitle>
          <CardDescription>
            Select the month and segment this plan covers, then upload the Excel file from the plant.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Month + Segment selectors */}
          <div className="flex flex-wrap gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Month</label>
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => handleMonthChange(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Segment</label>
              <div className="flex rounded-md border border-input overflow-hidden h-9">
                {(["Plumbing", "PTMT"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => handleSegmentChange(s)}
                    className={`px-4 text-sm font-medium transition-colors ${
                      selectedSegment === s
                        ? "bg-primary text-primary-foreground"
                        : "bg-background text-muted-foreground hover:bg-muted"
                    }`}
                  >{s}</button>
                ))}
              </div>
            </div>
          </div>

          {/* Dropzone */}
          <Dropzone onFile={setSelectedFile} />

          {/* Selected file preview */}
          {selectedFile && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 border border-border/50">
              <FileSpreadsheet className="h-5 w-5 text-green-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{selectedFile.name}</div>
                <div className="text-xs text-muted-foreground">
                  {(selectedFile.size / 1024).toFixed(0)} KB · will be imported as {selectedSegment} plan for {selectedMonth}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelectedFile(null)} className="text-muted-foreground">
                ✕
              </Button>
            </div>
          )}

          <Button
            onClick={handleUpload}
            disabled={!selectedFile || uploading}
            className="gap-2"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {uploading ? "Importing…" : "Import as Master Plan"}
          </Button>
        </CardContent>
      </Card>

      {/* Inline result after upload */}
      {lastResult && (
        <Card className="border-green-200 bg-green-50/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-green-800">
              <CheckCircle2 className="h-5 w-5" />
              Imported — {lastResult.filename}
            </CardTitle>
            <CardDescription>{lastResult.itemCount.toLocaleString()} items stored as master plan for {selectedMonth}</CardDescription>
          </CardHeader>
          {lastResult.summary.length > 0 && (
            <CardContent className="pt-0">
              <SummaryTable rows={lastResult.summary} />
            </CardContent>
          )}
        </Card>
      )}

      {/* History */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Upload History</CardTitle>
              <CardDescription>Previously imported plant plans for {selectedMonth} · {selectedSegment}</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={loadHistory} disabled={loadingHistory} className="gap-1.5">
              {loadingHistory ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {uploads === null ? "Load History" : "Refresh"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {uploads === null && !loadingHistory && (
            <p className="text-sm text-muted-foreground text-center py-6">
              Click "Load History" to see previously imported plans for this month.
            </p>
          )}
          {loadingHistory && (
            <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}
          {uploads !== null && !loadingHistory && uploads.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">
              No plans imported yet for {selectedMonth} · {selectedSegment}.
            </p>
          )}
          {uploads !== null && uploads.length > 0 && (
            <div className="space-y-2">
              {uploads.map((u, idx) => (
                <UploadCard
                  key={u.id}
                  record={u}
                  isLatest={idx === 0}
                  onDelete={() => setUploads((prev) => prev?.filter((r) => r.id !== u.id) ?? [])}
                />
              ))}
              <p className="text-xs text-muted-foreground pt-2">
                The most recently uploaded plan is the active master for that month.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

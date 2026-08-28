import { useState, useEffect, useCallback } from "react";
import { FileText, FileSpreadsheet, Download, Loader2, AlertCircle, ClipboardList, Sparkles, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fmtDateTime, fmtDate } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface ReportHistoryItem {
  id: number;
  type: string;
  month: string;
  snapshotDate: string | null;
  filename: string;
  contentType: string;
  createdAt: string;
}

const TYPE_LABELS: Record<string, string> = {
  plant_pdf: "Plant Manager PDF",
  ceo_pdf: "CEO PDF",
  plant_xlsx: "Plant Excel",
};

const TYPE_BADGE_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  plant_pdf: "default",
  ceo_pdf: "secondary",
  plant_xlsx: "outline",
};

export default function PlantReports({ month }: { month: string }) {
  const [selectedMonth, setSelectedMonth] = useState(month);
  const [generating, setGenerating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [includeAi, setIncludeAi] = useState(false);
  const [history, setHistory] = useState<ReportHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Keep in sync if the global month changes
  useEffect(() => {
    setSelectedMonth(month);
  }, [month]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/reports/history?month=${selectedMonth}`);
      if (!res.ok) throw new Error(`${res.status}`);
      const json = (await res.json()) as { data: ReportHistoryItem[] };
      setHistory(json.data ?? []);
    } catch {
      // silent — history is best-effort
    } finally {
      setHistoryLoading(false);
    }
  }, [selectedMonth]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  async function generate(type: "plant-pdf" | "ceo-pdf" | "plant-xlsx") {
    setError(null);
    setGenerating(type);
    try {
      const body: Record<string, unknown> = { month: selectedMonth };
      if (type !== "plant-xlsx") body.includeAiNarrative = includeAi;
      const res = await fetch(`/api/reports/${type}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({ error: "Unknown error" }))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match ? match[1] : `PTMT_${type}_${month}.${type.endsWith("xlsx") ? "xlsx" : "pdf"}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(null);
    }
  }

  async function downloadHistoryItem(id: number, filename: string) {
    try {
      const res = await fetch(`/api/reports/${id}/download`);
      if (!res.ok) throw new Error(`${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }

  function formatDate(iso: string) {
    return fmtDateTime(iso);
  }

  const cards = [
    {
      key: "plant-pdf" as const,
      title: "Plant Manager Report",
      description: "Comprehensive landscape PDF — cover, executive snapshot, S-curve, category attainment, pareto, mix flags, warnings, recommendations, daily log, full item appendix.",
      icon: FileText,
      pages: "Typically 8–12 pages",
      format: "PDF · Landscape A4",
      supportsAi: true,
    },
    {
      key: "ceo-pdf" as const,
      title: "CEO Briefing",
      description: "Concise portrait PDF — verdict banner, KPI tiles, category status strip, top risks, and priority decisions.",
      icon: ClipboardList,
      pages: "1–2 pages",
      format: "PDF · Portrait A4",
      supportsAi: true,
    },
    {
      key: "plant-xlsx" as const,
      title: "Plant Manager Excel",
      description: "Full workbook — Plant KPIs, Category KPIs (RAG-coloured), Item Plan vs Actual, Daily Series, Warnings & Recommendations sheets.",
      icon: FileSpreadsheet,
      pages: "5 sheets",
      format: "Excel · .xlsx",
      supportsAi: false,
    },
  ];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
          <p className="text-sm text-muted-foreground">
            Generate plant-level reports. Reports are persisted and available for re-download.
          </p>
        </div>
        <div className="flex items-center gap-4 pt-1 shrink-0">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            <Label htmlFor="report-month" className="text-sm text-muted-foreground whitespace-nowrap">
              Report month
            </Label>
            <input
              id="report-month"
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-500" />
            <Label htmlFor="include-ai" className="text-sm text-muted-foreground whitespace-nowrap">AI narrative</Label>
            <Switch id="include-ai" checked={includeAi} onCheckedChange={setIncludeAi} />
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {cards.map((card) => {
          const Icon = card.icon;
          const isLoading = generating === card.key;
          return (
            <Card key={card.key} className="flex flex-col">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Icon className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-base">{card.title}</CardTitle>
                </div>
                <div className="flex gap-2 pt-1">
                  <Badge variant="outline" className="text-xs">{card.format}</Badge>
                  <Badge variant="secondary" className="text-xs">{card.pages}</Badge>
                </div>
                <CardDescription className="text-xs leading-relaxed mt-2">
                  {card.description}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0 mt-auto">
                {card.supportsAi && includeAi && (
                  <p className="text-xs text-purple-600 mb-3 flex items-center gap-1">
                    <Sparkles className="h-3 w-3" />
                    AI narrative will be included if a saved analysis exists for this month.
                  </p>
                )}
                <Button
                  className="w-full"
                  onClick={() => generate(card.key)}
                  disabled={generating !== null}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Generating…
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4 mr-2" />
                      Generate &amp; Download
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div>
        <h2 className="text-base font-semibold mb-3">Download History — {selectedMonth}</h2>
        {historyLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading history…
          </div>
        ) : history.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No reports generated yet for {selectedMonth}.</p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Filename</TableHead>
                  <TableHead>Snapshot</TableHead>
                  <TableHead>Generated</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Badge variant={TYPE_BADGE_VARIANT[item.type] ?? "outline"} className="text-xs">
                        {TYPE_LABELS[item.type] ?? item.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm font-mono text-xs">{item.filename}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDate(item.snapshotDate) || "–"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(item.createdAt)}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => downloadHistoryItem(item.id, item.filename)}
                        className="h-7 px-2"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}

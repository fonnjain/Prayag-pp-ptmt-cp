import { useState } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { formatMonthLabel } from "@/lib/month";
import { useCreatePlanRun } from "@workspace/api-client-react";
import { RefreshCw, FileSpreadsheet, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSegment } from "@/contexts/segment-context";
import { useMonth } from "@workspace/month-filter";
import { MonthEmptyState } from "@/components/month-empty-state";

async function downloadFile(url: string, filename: string) {
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let detail = text;
    try {
      const payload = JSON.parse(text) as { message?: unknown; error?: unknown };
      detail = typeof payload.message === "string"
        ? payload.message
        : typeof payload.error === "string"
          ? payload.error
          : text;
    } catch {
      // Keep the raw response when the server did not return JSON.
    }
    throw new Error(detail || `Export failed with status ${response.status}`);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

type ExportKind = "temporary-excel" | "excel" | "pdf" | "weekly-excel" | "corrective-excel-standard" | "corrective-excel-detail" | "corrective-pdf";

function DownloadPair({
  title,
  description,
  extraNote,
  excelKind,
  pdfKind,
  downloading,
  onDownload,
  borderColor,
}: {
  title: string;
  description: string;
  extraNote?: string;
  excelKind: ExportKind;
  pdfKind: ExportKind;
  downloading: ExportKind | null;
  onDownload: (kind: ExportKind) => void;
  borderColor?: string;
}) {
  return (
    <Card className={cn("flex flex-col", borderColor && `border-${borderColor}`)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        <p className="text-xs text-gray-600 mt-1">{description}</p>
        {extraNote && <p className="text-xs text-gray-400 mt-0.5">{extraNote}</p>}
      </CardHeader>
      <CardContent className="flex gap-3 mt-auto pt-2">
        <Button
          size="sm"
          className="flex-1 gap-1.5"
            data-testid={`${excelKind}-export-button`}
          onClick={() => onDownload(excelKind)}
          disabled={downloading === excelKind}
        >
          <FileSpreadsheet size={14} />
          {downloading === excelKind ? "Generating…" : "Excel"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="flex-1 gap-1.5"
          onClick={() => onDownload(pdfKind)}
          disabled={downloading === pdfKind}
        >
          <FileText size={14} />
          {downloading === pdfKind ? "Generating…" : "PDF"}
        </Button>
      </CardContent>
    </Card>
  );
}

export default function ExportPage() {
  const { month, isMonthAvailable, isAvailableMonthsLoading } = useMonth();
  const { segment } = useSegment();
  const { toast } = useToast();
  const [downloading, setDownloading] = useState<ExportKind | null>(null);
  const createRun = useCreatePlanRun();

  function handleRunPlan() {
    createRun.mutate(
      { data: { month, segment } },
      {
        onSuccess: () =>
          toast({ title: "Plan run created", description: `Snapshot for ${formatMonthLabel(month)} saved to Plan Runs.` }),
        onError: () =>
          toast({ title: "Failed to create run", description: "Check that all data sources are available.", variant: "destructive" }),
      },
    );
  }

  const base = import.meta.env.BASE_URL;
  const prefix = segment === "Plumbing" ? "Plumbing" : "PTMT";

  const handleExport = async (kind: ExportKind) => {
    if (!isMonthAvailable) {
      toast({ title: "No plan data", description: `There is no recorded plan for ${formatMonthLabel(month)} yet.`, variant: "destructive" });
      return;
    }
    setDownloading(kind);
    try {
      let path: string;
      let filename: string;
        if (kind === "temporary-excel") {
          path = `plan/export/temporary-excel?month=${month}&segment=${encodeURIComponent(segment)}`;
          filename = `${prefix}_Temporary_Plan_${month}.xlsx`;
        } else if (kind === "excel") {
        path = `plan/export/excel?month=${month}&segment=${encodeURIComponent(segment)}`;
        filename = `${prefix}_Production_Plan_${month}.xlsx`;
      } else if (kind === "pdf") {
        path = `plan/export/pdf?month=${month}&segment=${encodeURIComponent(segment)}`;
        filename = `${prefix}_Production_Plan_${month}.pdf`;
      } else if (kind === "weekly-excel") {
        path = `plan/export/weekly-excel?month=${month}&segment=${encodeURIComponent(segment)}`;
        filename = `${prefix}_Weekly_Release_Plan_${month}.xlsx`;
      } else if (kind === "corrective-excel-standard") {
        path = `corrective/export/excel?month=${month}&segment=${encodeURIComponent(segment)}&format=standard`;
        filename = `${prefix}_Corrective_Plan_${month}_Standard.xlsx`;
      } else if (kind === "corrective-excel-detail") {
        path = `corrective/export/excel?month=${month}&segment=${encodeURIComponent(segment)}&format=detail`;
        filename = `${prefix}_Corrective_Plan_${month}_Detail.xlsx`;
      } else {
        path = `corrective/export/pdf?month=${month}&segment=${encodeURIComponent(segment)}`;
        filename = `${prefix}_Corrective_Plan_${month}.pdf`;
      }
      await downloadFile(`${base}api/${path}`, filename);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not generate the file.";
      const isMissingRun = msg.includes("No corrective run");
      const isMissingFinalizedPlan = msg.includes("NO_FINALIZED_") || msg.includes("No finalized");
      toast({
        title: "Export failed",
        description: isMissingRun
          ? "No corrective re-plan found for this month. Run the Corrective Plan first."
          : isMissingFinalizedPlan
            ? "No finalized plan run is available for this month. Finalize the Temporary and Production Plans in Plan Runs first."
          : "Could not generate the file. Make sure the plan data is loaded.",
        variant: "destructive",
      });
    } finally {
      setDownloading(null);
    }
  };

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">Export</h2>
            <p className="text-sm text-gray-500">{formatMonthLabel(month)} · {segment}</p>
          </div>
          <Button
            onClick={handleRunPlan}
            disabled={createRun.isPending}
          >
            <RefreshCw className={cn("h-4 w-4 mr-2", createRun.isPending && "animate-spin")} />
            {createRun.isPending ? "Running plan…" : "Run Plan now"}
          </Button>
        </div>

        {!isAvailableMonthsLoading && !isMonthAvailable && <MonthEmptyState segment={segment} />}

        {/* Production Plan row */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Production Plan</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Card className="flex flex-col border-amber-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-amber-900">1 · Temporary Plan</CardTitle>
                <p className="text-xs text-gray-600 mt-1">
                  The demand-true plan, before machine capacity is applied. Shows what is needed; the Production Plan shows what can be made. Per item: demand quantity, of which dummy stock, of which orders, of which buffer.
                </p>
                <p className="text-xs text-gray-400 mt-0.5">Export-only source snapshot; not issued to the floor.</p>
              </CardHeader>
              <CardContent className="mt-auto pt-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 border-amber-300 text-amber-800 hover:bg-amber-50 w-full"
                  onClick={() => handleExport("temporary-excel")}
                  disabled={downloading === "temporary-excel"}
                >
                  <FileSpreadsheet size={14} />
                  {downloading === "temporary-excel" ? "Generating…" : "Download Temporary Plan Excel"}
                </Button>
              </CardContent>
            </Card>
            <DownloadPair
              title="2 · Full Production Plan"
              description={segment === "Plumbing"
                ? "Capacity-fitted result from the finalized Plumbing machine-app schedule, with scheduled and Cannot Be Made quantities per item."
                : "Capacity-fitted result from the finalized PTMT Pass 2 run, with Production Plan and Cannot Be Made quantities per item."}
              extraNote={segment === "Plumbing"
                ? "Source: finalized pipe + fitting machine schedule; solvent demand is shown as an unconstrained pass-through."
                : "Source: finalized PTMT Pass 2 output; the Temporary Plan is retained as lineage."}
              excelKind="excel"
              pdfKind="pdf"
              downloading={downloading}
              onDownload={handleExport}
            />
            <Card className="flex flex-col border-blue-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-blue-900">3 · Weekly Release Plan</CardTitle>
                <p className="text-xs text-gray-600 mt-1">
                  One sheet per category: the capacity-fitted W1–W4 allocation from the same finalized Production Plan.
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  The workbook asserts Σ W1..W4 = Production Plan total. No cover-ratio banding is used.
                </p>
              </CardHeader>
              <CardContent className="mt-auto pt-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 border-blue-300 text-blue-700 hover:bg-blue-50 w-full"
                  onClick={() => handleExport("weekly-excel")}
                  disabled={downloading === "weekly-excel"}
                >
                  <FileSpreadsheet size={14} />
                  {downloading === "weekly-excel" ? "Generating…" : "Download Weekly Release Excel"}
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Corrective Re-Plan row */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Corrective Re-Plan</h3>
          <p className="text-xs text-gray-400 mb-3">
            Downloads the most recent corrective run for {formatMonthLabel(month)}.
            Run the <strong>Corrective Plan</strong> page first if no run exists yet.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Card className="flex flex-col border-orange-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Corrective Re-Plan Report</CardTitle>
                <p className="text-xs text-gray-600 mt-1">
                  {segment === "Plumbing"
                    ? "14 sheets: Summary, each Plumbing category, and a Legend."
                    : "9 sheets: Summary, the 7 category sheets, and a Legend."}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Standard format matches the Production Plan schema. Full Detail appends corrective columns
                  (produced, remaining, capacity, feasibility, status flags).
                </p>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 mt-auto pt-2">
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1 gap-1.5"
                    onClick={() => handleExport("corrective-excel-standard")}
                    disabled={downloading === "corrective-excel-standard"}
                  >
                    <FileSpreadsheet size={14} />
                    {downloading === "corrective-excel-standard" ? "Generating…" : "Excel (standard)"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 gap-1.5 border-orange-300 text-orange-700 hover:bg-orange-50"
                    onClick={() => handleExport("corrective-excel-detail")}
                    disabled={downloading === "corrective-excel-detail"}
                  >
                    <FileSpreadsheet size={14} />
                    {downloading === "corrective-excel-detail" ? "Generating…" : "Excel (full detail)"}
                  </Button>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 w-full"
                  onClick={() => handleExport("corrective-pdf")}
                  disabled={downloading === "corrective-pdf"}
                >
                  <FileText size={14} />
                  {downloading === "corrective-pdf" ? "Generating…" : "PDF"}
                </Button>
              </CardContent>
            </Card>
            <div className="rounded-md border border-dashed border-gray-200 bg-gray-50 flex items-center justify-center p-6">
              <div className="text-center text-xs text-gray-400 space-y-1">
                <p className="font-medium text-gray-500">How to use</p>
                <p>1. Go to <strong>Corrective Plan</strong> in the sidebar</p>
                <p>2. Select month + week closed → Re-plan now</p>
                <p>3. Return here to download Excel or PDF</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

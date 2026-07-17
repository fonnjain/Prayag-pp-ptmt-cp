import { useState } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { currentMonth, formatMonthLabel } from "@/lib/month";
import { useCreatePlanRun } from "@workspace/api-client-react";
import { RefreshCw, FileSpreadsheet, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSegment } from "@/contexts/segment-context";

async function downloadFile(url: string, filename: string) {
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Export failed with status ${response.status}`);
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

type ExportKind = "excel" | "pdf" | "weekly-excel" | "corrective-excel" | "corrective-pdf";

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
  const month = currentMonth();
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
    setDownloading(kind);
    try {
      let path: string;
      let filename: string;
      if (kind === "excel") {
        path = `plan/export/excel?month=${month}&segment=${encodeURIComponent(segment)}`;
        filename = `${prefix}_Production_Plan_${month}.xlsx`;
      } else if (kind === "pdf") {
        path = `plan/export/pdf?month=${month}&segment=${encodeURIComponent(segment)}`;
        filename = `${prefix}_Production_Plan_${month}.pdf`;
      } else if (kind === "weekly-excel") {
        path = `plan/export/weekly-excel?month=${month}&segment=${encodeURIComponent(segment)}`;
        filename = `${prefix}_Weekly_Release_Plan_${month}.xlsx`;
      } else if (kind === "corrective-excel") {
        path = `corrective/export/excel?month=${month}&segment=${encodeURIComponent(segment)}`;
        filename = `${prefix}_Corrective_Plan_${month}.xlsx`;
      } else {
        path = `corrective/export/pdf?month=${month}&segment=${encodeURIComponent(segment)}`;
        filename = `${prefix}_Corrective_Plan_${month}.pdf`;
      }
      await downloadFile(`${base}api/${path}`, filename);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not generate the file.";
      const isMissingRun = msg.includes("No corrective run");
      toast({
        title: "Export failed",
        description: isMissingRun
          ? "No corrective re-plan found for this month. Run the Corrective Plan first."
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

        {/* Production Plan row */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Production Plan</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <DownloadPair
              title="Full Production Plan"
              description={segment === "Plumbing"
                ? "12 sheets: Summary, each Plumbing category, and a Legend."
                : "9 sheets: Summary, the 7 category sheets, and a colour-rule Legend."}
              excelKind="excel"
              pdfKind="pdf"
              downloading={downloading}
              onDownload={handleExport}
            />
            <Card className="flex flex-col border-blue-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-blue-900">Weekly Release Plan</CardTitle>
                <p className="text-xs text-gray-600 mt-1">
                  One sheet per category: items colour-coded by release week (W1–W4) based on cover ratio.
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Cover = Stock ÷ Avg 3-Mo Sale. Band thresholds are editable per category.
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
            <DownloadPair
              title="Corrective Re-Plan Report"
              description="Revised weekly release with status flags, warnings, and variance attribution. Shows which items are on-plan, carried over, or unfulfillable."
              excelKind="corrective-excel"
              pdfKind="corrective-pdf"
              downloading={downloading}
              onDownload={handleExport}
              borderColor="orange-200"
            />
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

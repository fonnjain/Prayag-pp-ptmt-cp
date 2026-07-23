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

type ExportKind = "excel" | "pdf" | "weekly-excel" | "corrective-excel-standard" | "corrective-excel-detail" | "corrective-pdf";

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

import { useState } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { currentMonth, formatMonthLabel } from "@/lib/month";
import { useCreatePlanRun } from "@workspace/api-client-react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

async function downloadFile(url: string, filename: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Export failed with status ${response.status}`);
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

type ExportKind = "excel" | "pdf" | "weekly-excel";

export default function ExportPage() {
  const month = currentMonth();
  const { toast } = useToast();
  const [downloading, setDownloading] = useState<ExportKind | null>(null);
  const createRun = useCreatePlanRun();

  function handleRunPlan() {
    createRun.mutate(
      { data: { month } },
      {
        onSuccess: () =>
          toast({ title: "Plan run created", description: `Snapshot for ${formatMonthLabel(month)} saved to Plan Runs.` }),
        onError: () =>
          toast({ title: "Failed to create run", description: "Check that all data sources are available.", variant: "destructive" }),
      },
    );
  }

  const base = import.meta.env.BASE_URL;

  const handleExport = async (kind: ExportKind) => {
    setDownloading(kind);
    try {
      let path: string;
      let filename: string;
      if (kind === "excel") {
        path = "plan/export/excel";
        filename = `PTMT_Production_Plan_${month}.xlsx`;
      } else if (kind === "pdf") {
        path = "plan/export/pdf";
        filename = `PTMT_Production_Plan_${month}.pdf`;
      } else {
        path = "plan/export/weekly-excel";
        filename = `PTMT_Weekly_Release_Plan_${month}.xlsx`;
      }
      await downloadFile(`${base}api/${path}?month=${month}`, filename);
    } catch {
      toast({
        title: "Export failed",
        description: "Could not generate the file. Make sure the plan data is loaded.",
        variant: "destructive",
      });
    } finally {
      setDownloading(null);
    }
  };

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">Export</h2>
            <p className="text-sm text-gray-500">{formatMonthLabel(month)}</p>
          </div>
          <Button
            onClick={handleRunPlan}
            disabled={createRun.isPending}
          >
            <RefreshCw className={cn("h-4 w-4 mr-2", createRun.isPending && "animate-spin")} />
            {createRun.isPending ? "Running plan…" : "Run Plan now"}
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Production Plan — Excel workbook</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-gray-600">
              9 sheets: Summary, the 7 category sheets, and a colour-rule Legend.
            </p>
            <Button onClick={() => handleExport("excel")} disabled={downloading === "excel"}>
              {downloading === "excel" ? "Generating..." : "Download Excel"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Production Plan — PDF report</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-gray-600">
              Print-optimised: Summary + each category (items needing production only), landscape.
            </p>
            <Button onClick={() => handleExport("pdf")} disabled={downloading === "pdf"}>
              {downloading === "pdf" ? "Generating..." : "Download PDF"}
            </Button>
          </CardContent>
        </Card>

        <Card className="border-blue-200">
          <CardHeader>
            <CardTitle className="text-base">Weekly Release Plan — Excel workbook</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-gray-600">
              One sheet per category: items colour-coded by release week (W1–W4) based on cover ratio.
              Includes a Summary sheet with weekly totals and legend.
            </p>
            <p className="text-xs text-gray-400">
              Cover = Stock ÷ Avg 3-Mo Sale. Band thresholds are editable per category on each category page.
            </p>
            <Button
              variant="outline"
              className="border-blue-300 text-blue-700 hover:bg-blue-50"
              onClick={() => handleExport("weekly-excel")}
              disabled={downloading === "weekly-excel"}
            >
              {downloading === "weekly-excel" ? "Generating..." : "Download Weekly Release Excel"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}

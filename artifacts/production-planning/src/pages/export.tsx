import { useState } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { currentMonth, formatMonthLabel } from "@/lib/month";

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

export default function ExportPage() {
  const month = currentMonth();
  const { toast } = useToast();
  const [downloading, setDownloading] = useState<"excel" | "pdf" | null>(null);

  const base = import.meta.env.BASE_URL;

  const handleExport = async (kind: "excel" | "pdf") => {
    setDownloading(kind);
    try {
      const path = kind === "excel" ? "plan/export/excel" : "plan/export/pdf";
      const ext = kind === "excel" ? "xlsx" : "pdf";
      await downloadFile(`${base}api/${path}?month=${month}`, `PTMT_Production_Plan_${month}.${ext}`);
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
        <div>
          <h2 className="text-xl font-semibold">Export</h2>
          <p className="text-sm text-gray-500">{formatMonthLabel(month)}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Excel workbook</CardTitle>
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
            <CardTitle className="text-base">PDF report</CardTitle>
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
      </div>
    </AppLayout>
  );
}

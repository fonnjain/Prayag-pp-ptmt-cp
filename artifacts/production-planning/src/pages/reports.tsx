import { useData } from "@/lib/data-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, Download, Calendar, Activity, Zap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Reports() {
  const { reports, generateReport, role, division, planMonth, isGeneratingReport } = useData();
  const { toast } = useToast();

  const handleGenerate = async () => {
    try {
      await generateReport();
      toast({ title: "Report generated", description: "AI analysis is ready below." });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Report generation failed",
        description: err instanceof Error ? err.message : "Build a plan first, then generate a report.",
      });
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Reports</h1>
          <p className="text-muted-foreground">Analysis and summaries for {division} • {planMonth}</p>
        </div>
        
        {role !== "viewer" && (
          <Button onClick={handleGenerate} disabled={isGeneratingReport} className="gap-2">
            <FileText className="h-4 w-4" />
            {isGeneratingReport ? "Generating..." : "Generate New Report"}
          </Button>
        )}
      </div>

      {reports.length === 0 ? (
        <Card className="flex flex-col items-center justify-center p-12 text-center">
          <FileText className="h-12 w-12 text-muted-foreground mb-4 opacity-20" />
          <h3 className="text-lg font-medium">No reports generated yet</h3>
          <p className="text-sm text-muted-foreground max-w-sm mt-1">
            Generate a report to get an AI-powered summary of the current production plan and data health.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {reports.map((report) => (
            <Card key={report.id} className="flex flex-col">
              <CardHeader className="pb-3">
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <FileText className="h-5 w-5 text-primary" />
                      Plan Analysis
                    </CardTitle>
                    <CardDescription className="flex items-center gap-2 mt-1">
                      <Calendar className="h-3 w-3" />
                      {new Date(report.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className="capitalize">{report.cadence}</Badge>
                </div>
              </CardHeader>
              <CardContent className="flex-1">
                <p className="text-sm leading-relaxed">{report.summary}</p>
              </CardContent>
              <CardFooter className="flex justify-between items-center border-t bg-muted/20 pt-4 pb-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {report.tier === "fast" ? <Zap className="h-3 w-3" /> : <Activity className="h-3 w-3" />}
                  <span>Analysis: {report.model} • {report.tier} tier</span>
                </div>
                <Button asChild variant="secondary" size="sm" className="gap-2">
                  <a href={`/api/reports/${report.id}/download`}>
                    <Download className="h-4 w-4" />
                    <span className="hidden sm:inline">Download PDF</span>
                    <span className="sm:hidden">PDF</span>
                  </a>
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

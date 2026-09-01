import { CalendarRange, Database, Upload } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatMonthLabel, useMonth } from "@workspace/month-filter";

export function UnavailableMonthState() {
  const { month, currentMonth } = useMonth();
  const label = formatMonthLabel(month);
  const isCurrent = month === currentMonth;

  return (
    <div className="mx-auto max-w-3xl py-8">
      <Card className="border-dashed border-amber-300 bg-amber-50/40">
        <CardHeader className="text-center">
          <CalendarRange className="mx-auto mb-2 h-8 w-8 text-amber-600" />
          <CardTitle className="text-lg">No monitoring run for {label}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-center text-sm text-muted-foreground">
          <p>
            {isCurrent
              ? `${label} has not run yet. Its input files have not been uploaded or a plan has not been finalized.`
              : `No finalized monitoring run or snapshot is recorded for ${label}.`}
          </p>
          <p className="text-xs">
            This is an expected empty month, not a system failure. Select an available month to view production figures.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <a href={`/?month=${encodeURIComponent(month)}`}>
              <Button size="sm">
                <Database className="mr-1.5 h-4 w-4" /> Go to Data
              </Button>
            </a>
            <a href="/monitoring/plant/plan-import">
              <Button size="sm" variant="outline">
                <Upload className="mr-1.5 h-4 w-4" /> Plan Import
              </Button>
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
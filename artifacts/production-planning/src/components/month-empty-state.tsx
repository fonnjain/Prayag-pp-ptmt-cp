import { Link } from "wouter";
import { useMonth, formatMonthLabel } from "@workspace/month-filter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function MonthEmptyState({ segment }: { segment: string }) {
  const { month, currentMonth, setMonth } = useMonth();

  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle className="text-base">No plan data for {formatMonthLabel(month)}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <p>
          No plan run or frozen {segment} snapshot is recorded for this month. Select another available month,
          or load source data and create a plan for {formatMonthLabel(month)}.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href="/">
            <Button size="sm">Go to Data</Button>
          </Link>
          <Link href="/runs">
            <Button size="sm" variant="outline">View Plan Runs</Button>
          </Link>
          {month !== currentMonth && (
            <Button size="sm" variant="ghost" onClick={() => setMonth(currentMonth)}>
              View {formatMonthLabel(currentMonth)}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
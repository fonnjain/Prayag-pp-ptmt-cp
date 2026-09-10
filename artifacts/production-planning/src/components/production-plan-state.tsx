import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatMonthLabel } from "@/lib/month";

type Availability = {
  status?: "production" | "temporary-unfitted" | "no-plan";
  message?: string;
  runId?: number | null;
  planType?: string | null;
  runStatus?: string | null;
  asOfAt?: string | null;
};

export function ProductionPlanState({
  month,
  segment,
  availability,
}: {
  month: string;
  segment: string;
  availability?: Availability | null;
}) {
  const temporary = availability?.status === "temporary-unfitted";
  return (
    <Card className="border-dashed border-amber-300 bg-amber-50/40">
      <CardHeader>
        <CardTitle className="text-base">
          {temporary ? "Temporary Plan exists — Production Plan not issued" : `No finalized Production Plan for ${formatMonthLabel(month)}`}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <p>{availability?.message ?? `No finalized Production Plan exists for ${segment} ${month}.`}</p>
        {availability?.runId && (
          <p className="text-xs">
            Source: {availability.planType} #{availability.runId} · {availability.runStatus}
            {availability.asOfAt ? ` · as of ${new Date(availability.asOfAt).toLocaleString()}` : ""}
          </p>
        )}
        <p>Summary, category, and attainment views remain neutral until a capacity-fitted Production Plan is finalized.</p>
        <div className="flex flex-wrap gap-2">
          <Link href="/runs"><Button size="sm" variant="outline">View Plan Runs</Button></Link>
          <Link href="/"><Button size="sm">Go to Data</Button></Link>
        </div>
      </CardContent>
    </Card>
  );
}
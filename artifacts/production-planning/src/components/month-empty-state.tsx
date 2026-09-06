import { Link } from "wouter";
import { useMonth, formatMonthLabel } from "@workspace/month-filter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Play, Upload } from "lucide-react";
import { useListUploads, type UploadedFile } from "@workspace/api-client-react";
import { segmentInputStatus, type PlanningSegment } from "@/lib/planning-readiness";

export function MonthEmptyState({
  segment,
  onCreateTemporaryPlan,
  isCreatingTemporaryPlan = false,
}: {
  segment: PlanningSegment;
  onCreateTemporaryPlan?: () => void;
  isCreatingTemporaryPlan?: boolean;
}) {
  const { month, currentMonth, setMonth } = useMonth();
  const { data: rawUploads, isLoading: uploadsLoading } = useListUploads();
  const uploads = rawUploads as unknown as UploadedFile[] | undefined;
  const inputStatus = segmentInputStatus(uploads, segment, month);
  const canCreateTemporaryPlan = inputStatus.complete && !uploadsLoading && Boolean(onCreateTemporaryPlan);

  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle className="text-base">No plan data for {formatMonthLabel(month)}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <p>
          No plan run or frozen {segment} snapshot is recorded for this month. Select another available month,
          or load source data and create a Temporary Plan for {formatMonthLabel(month)}.
        </p>
        {onCreateTemporaryPlan && (
          <div className={canCreateTemporaryPlan
            ? "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5"
            : "rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5"}>
            <div className="flex items-start gap-2">
              {canCreateTemporaryPlan
                ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
                : <Upload className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-slate-900">
                  {uploadsLoading
                    ? "Checking uploaded inputs…"
                    : `${inputStatus.uploaded} of ${inputStatus.required} ${segment} inputs ready`}
                </p>
                <p className="mt-0.5 text-xs text-slate-600">
                  {canCreateTemporaryPlan
                    ? "Create the demand-true Temporary Plan first. Capacity fitting comes afterward."
                    : `Upload the missing ${segment} inputs from Data before creating the plan.`}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              className="mt-2 gap-1.5"
              onClick={onCreateTemporaryPlan}
              disabled={!canCreateTemporaryPlan || isCreatingTemporaryPlan}
            >
              <Play className="h-3.5 w-3.5" />
              {isCreatingTemporaryPlan ? "Creating Temporary Plan…" : "Create Temporary Plan"}
            </Button>
          </div>
        )}
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
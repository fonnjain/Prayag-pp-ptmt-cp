import { Card, CardContent } from "@/components/ui/card";

export function MonitoringUnavailable({
  month,
  reason,
}: {
  month: string;
  reason?: string | null;
}) {
  return (
    <div className="max-w-[900px] mx-auto py-8">
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="py-10 text-center">
          <h2 className="text-lg font-semibold mb-2">Production targets unavailable</h2>
          <p className="text-sm text-muted-foreground max-w-xl mx-auto">
            {reason ?? `No finalized Production Plan exists for ${month}.`}
          </p>
          <p className="text-xs text-muted-foreground mt-3">
            Monitoring and attainment stay neutral until a capacity-fitted Production Plan is finalized.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
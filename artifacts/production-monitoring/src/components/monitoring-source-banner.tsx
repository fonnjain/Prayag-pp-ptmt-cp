import { AlertTriangle } from "lucide-react";

export function MonitoringSourceBanner({
  warning,
  sourceMonth,
  requestedMonth,
}: {
  warning?: string | null;
  sourceMonth?: string | null;
  requestedMonth: string;
}) {
  if (!warning && (!sourceMonth || sourceMonth === requestedMonth)) return null;
  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <div>
        <p className="font-semibold">Showing the latest available monitoring source</p>
        <p className="leading-snug">
          {warning ?? `No workbook was available for ${requestedMonth}; showing source data from ${sourceMonth}.`}
          {" "}Planning inputs and corrective replans are not affected.
        </p>
      </div>
    </div>
  );
}
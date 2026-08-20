import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

export function PlantLiveGatedBanner({ className }: { className?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm",
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
      <div className="space-y-0.5">
        <p className="font-semibold text-amber-700">Machine figures need review</p>
        <p className="text-amber-700/90">
          The plant source has not released these figures for headline use. KPI values are
          muted until the source confirmation is complete.
        </p>
      </div>
    </div>
  );
}
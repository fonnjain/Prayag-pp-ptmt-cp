import React from "react";

export function WeeklyPlanVersionProvenance({ versions }: { versions: string[] }) {
  if (versions.length === 0) return null;

  return (
    <div className="mt-2 border-t border-border/30 pt-2" data-testid="weekly-plan-provenance">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Issued plan
      </div>
      <div className="space-y-1">
        {versions.map((version) => (
          <div
            key={version}
            className="rounded border border-violet-500/20 bg-violet-500/5 px-1.5 py-1 text-[10px] leading-tight text-violet-700"
          >
            {version}
          </div>
        ))}
      </div>
    </div>
  );
}
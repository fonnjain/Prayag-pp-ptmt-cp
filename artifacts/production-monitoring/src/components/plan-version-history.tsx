import React from "react";

type PlanKind = "run" | "import" | "corrective";
type IssuedAtSource =
  | "plan_created_at"
  | "upload_timestamp"
  | "corrective_created_at"
  | "snapshot_created_at";
type SelectionReason =
  | "only_issued_version_for_date"
  | "latest_source_issuance"
  | "source_id_tiebreaker";

export interface MonitoringPlanVersion {
  kind: PlanKind;
  sourceId: number;
  sourceLabel: string | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
  targetCount: number;
  selection?: {
    candidateCount: number;
    reason: SelectionReason;
    canonicalIssuedAt: string | null;
    canonicalIssuedAtSource: IssuedAtSource;
    superseded: Array<{
      kind: PlanKind;
      sourceId: number;
      sourceLabel: string | null;
      issuedAt: string | null;
      issuedAtSource: IssuedAtSource;
    }>;
  };
  supersededSameDaySources?: Array<{
    kind: PlanKind;
    sourceId: number;
    sourceLabel: string | null;
  }>;
}

interface PlanVersionHistoryProps {
  month: string;
  versions: MonitoringPlanVersion[];
  weeklyTargetSource?: "plan_run_snapshot" | "legacy_frozen_inputs";
  weeklyBandCount?: number;
}

const KIND_LABEL: Record<PlanKind, string> = {
  run: "Original plan",
  import: "Imported plan",
  corrective: "Corrective plan",
};

const ISSUED_AT_SOURCE_LABEL: Record<IssuedAtSource, string> = {
  plan_created_at: "plan issued",
  upload_timestamp: "upload recorded",
  corrective_created_at: "correction issued",
  snapshot_created_at: "snapshot recorded",
};

function sourceName(kind: PlanKind, sourceId: number, sourceLabel: string | null): string {
  return sourceLabel ?? `${KIND_LABEL[kind]} #${sourceId}`;
}

function formatIssuedAt(issuedAt: string | null | undefined): string {
  if (!issuedAt) return "Not recorded";
  const parsed = new Date(issuedAt);
  if (Number.isNaN(parsed.getTime())) return issuedAt;
  const formatted = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  }).formatToParts(parsed);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    formatted.find((item) => item.type === type)?.value ?? "";
  return `${part("day")}-${part("month")}-${part("year")} ${part("hour")}:${part("minute")} IST`;
}

function selectionRule(reason: SelectionReason): string {
  switch (reason) {
    case "latest_source_issuance":
      return "Latest source issuance selected";
    case "source_id_tiebreaker":
      return "Same issuance time; highest source ID selected";
    default:
      return "Only issued version for this effective date";
  }
}

function fallbackSuperseded(version: MonitoringPlanVersion) {
  return version.supersededSameDaySources?.map((source) => ({
    ...source,
    issuedAt: null,
    issuedAtSource: "snapshot_created_at" as const,
  })) ?? [];
}

export function PlanVersionHistory({
  month,
  versions,
  weeklyTargetSource,
  weeklyBandCount = 0,
}: PlanVersionHistoryProps) {
  if (versions.length === 0 && weeklyTargetSource !== "legacy_frozen_inputs") return null;

  return (
    <section
      className="rounded-lg border border-violet-500/25 bg-violet-500/[0.03] p-4"
      aria-label="Issued plan history"
      data-testid="plan-version-history"
    >
      <div className="mb-4">
        <h2 className="text-base font-semibold text-foreground">Issued plan history</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The plan revision used for monitoring in {month}. When more than one version has the same
          effective date, the selected version and every superseded source remain visible here.
        </p>
      </div>

      {weeklyTargetSource === "legacy_frozen_inputs" && (
        <div
          className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm"
          data-testid="legacy-frozen-weekly-allocation"
        >
          <p className="font-medium text-amber-800">Original weekly allocation is frozen</p>
          <p className="mt-1 text-amber-900/80">
            This legacy plan did not save W1–W4 targets. The historic weekly allocation shown in
            monitoring was reconstructed from that plan’s captured inputs and its {weeklyBandCount} retained
            release-band rule{weeklyBandCount === 1 ? "" : "s"}—not from today’s live plan or current rules.
          </p>
        </div>
      )}

      {versions.length > 0 && (
        <div className="space-y-3">
          {versions.map((version) => {
            const selection = version.selection;
            const superseded = selection?.superseded ?? fallbackSuperseded(version);
            return (
              <article
                key={`${version.kind}-${version.sourceId}-${version.effectiveFrom}`}
                className="rounded-md border border-border/70 bg-background/80 p-3"
                data-testid={`plan-version-${version.kind}-${version.sourceId}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-foreground">
                      Effective {version.effectiveFrom}
                      {version.effectiveTo ? ` to ${version.effectiveTo}` : " onward"}
                    </p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {sourceName(version.kind, version.sourceId, version.sourceLabel)} · {version.targetCount.toLocaleString()} target item{version.targetCount === 1 ? "" : "s"}
                    </p>
                  </div>
                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700">
                    Used for monitoring
                  </span>
                </div>

                <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Issuance time</dt>
                    <dd className="mt-0.5 text-foreground">
                      {formatIssuedAt(selection?.canonicalIssuedAt)}
                      {selection?.canonicalIssuedAtSource ? ` · ${ISSUED_AT_SOURCE_LABEL[selection.canonicalIssuedAtSource]}` : ""}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Selection rule</dt>
                    <dd className="mt-0.5 text-foreground">
                      {selection ? selectionRule(selection.reason) : "Recorded plan version"}
                    </dd>
                  </div>
                </dl>

                {superseded.length > 0 && (
                  <div className="mt-3 border-t border-border/60 pt-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Superseded on {version.effectiveFrom} ({superseded.length})
                    </p>
                    <ul className="mt-2 space-y-1.5">
                      {superseded.map((source) => (
                        <li
                          key={`${source.kind}-${source.sourceId}`}
                          className="rounded border border-muted bg-muted/30 px-2 py-1.5 text-sm text-muted-foreground"
                        >
                          <span className="font-medium text-foreground">
                            {sourceName(source.kind, source.sourceId, source.sourceLabel)}
                          </span>
                          <span className="ml-1.5">
                            · issued {formatIssuedAt(source.issuedAt)}
                            {source.issuedAtSource ? ` · ${ISSUED_AT_SOURCE_LABEL[source.issuedAtSource]}` : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
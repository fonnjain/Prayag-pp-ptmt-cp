import {
  useListUploads,
  useGetMasterProductMrpReport,
  type UploadedFile,
} from "@workspace/api-client-react";
import { useMonth, formatMonthLabel } from "@workspace/month-filter";
import { Card, CardContent } from "@/components/ui/card";
import { useSegment } from "@/contexts/segment-context";
import { AlertTriangle, CheckCircle2, Upload } from "lucide-react";
import {
  PLUMBING_INPUT_KINDS,
  PTMT_INPUT_KINDS,
  countUploadedKinds,
  segmentInputStatus,
  uploadMatchesMonth,
} from "@/lib/planning-readiness";

export { uploadMatchesMonth };

type MrpReportLike = {
  source?: {
    filename?: string;
    sha256?: string;
    productRowCount?: number;
    discontinuedRowCount?: number;
    planningApproved?: boolean;
  } | null;
  summary?: {
    seriesCrosswalk?: {
      pendingReview?: unknown[];
      held?: unknown[];
    };
  } | null;
};

function shortHash(hash: string | undefined) {
  if (!hash) return "hash unavailable";
  return hash.length > 16 ? `${hash.slice(0, 8)}…${hash.slice(-8)}` : hash;
}

function latestCompleteMonth(uploads: UploadedFile[] | undefined, selectedMonth: string) {
  const candidates = [...new Set((uploads ?? [])
    .map((upload) => upload.period)
    .filter((period): period is string => typeof period === "string" && period <= selectedMonth))]
    .sort((a, b) => b.localeCompare(a));
  return candidates.find((period) =>
    countUploadedKinds(uploads, PTMT_INPUT_KINDS, period) === PTMT_INPUT_KINDS.length &&
    countUploadedKinds(uploads, PLUMBING_INPUT_KINDS, period) === PLUMBING_INPUT_KINDS.length,
  ) ?? null;
}

export function PlanningReadiness() {
  const { segment } = useSegment();
  const { month } = useMonth();
  const { data: rawMrpReport, isLoading: mrpLoading } = useGetMasterProductMrpReport();
  const { data: rawUploads, isLoading: uploadsLoading } = useListUploads();
  const mrpReport = rawMrpReport as unknown as MrpReportLike | undefined;
  const uploads = rawUploads as unknown as UploadedFile[] | undefined;
  const source = mrpReport?.source;
  const ptmtStatus = segmentInputStatus(uploads, "PTMT", month);
  const plumbingStatus = segmentInputStatus(uploads, "Plumbing", month);
  const activeStatus = segment === "PTMT" ? ptmtStatus : plumbingStatus;
  const inputsLoading = uploadsLoading || !rawUploads;
  const latestMonth = latestCompleteMonth(uploads, month);
  const monthLabel = formatMonthLabel(month);

  return (
    <Card className="border-slate-200 bg-slate-50/60">
      <CardContent className="p-4">
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            {source ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
            ) : (
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-slate-900">
                {source ? "MRP source loaded" : "MRP source missing"}
              </div>
              {mrpLoading ? (
                <p className="mt-1 text-xs text-muted-foreground">Checking the authoritative MRP source…</p>
              ) : source ? (
                <p className="mt-1 text-xs text-slate-600">
                  <span className="font-medium">{source.filename}</span>
                  {" · "}
                  <span className="font-mono" title={source.sha256}>{shortHash(source.sha256)}</span>
                  {" · "}
                  {Number(source.productRowCount ?? 0).toLocaleString()} products
                  {" · "}
                  {Number(source.discontinuedRowCount ?? 0).toLocaleString()} discontinued
                </p>
              ) : (
                <p className="mt-1 text-xs text-red-700">
                  Upload the authoritative workbook from Products to establish the MRP source.
                </p>
              )}
            </div>
          </div>

          <div className="border-t border-slate-200 pt-3">
            <div className="flex items-start gap-3">
              {inputsLoading || !activeStatus.complete ? (
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-slate-900">{monthLabel} inputs</div>
                {inputsLoading ? (
                  <p className="mt-1 text-xs text-muted-foreground">Checking uploaded files…</p>
                ) : (
                  <>
                    <p className="mt-1 text-xs text-slate-600">
                      {activeStatus.complete
                        ? `✓ ${activeStatus.uploaded} of ${activeStatus.required} ${segment} files ready`
                        : `${activeStatus.uploaded} of ${activeStatus.required} ${segment} files`}
                    </p>
                    {activeStatus.complete ? (
                      <p className="mt-1 text-xs font-medium text-emerald-800">
                        All required {segment} inputs are present.
                      </p>
                    ) : (
                      <p className="mt-1 text-xs font-medium text-amber-800">
                        → Upload the missing {segment} files from <a href="/data" className="underline hover:text-amber-950">Data</a> to build the {monthLabel} plan.
                        {latestMonth && (
                          <> Latest available: {formatMonthLabel(latestMonth)} ({countUploadedKinds(uploads, segment === "PTMT" ? PTMT_INPUT_KINDS : PLUMBING_INPUT_KINDS, latestMonth)} of {segment === "PTMT" ? 3 : 2}).</>
                        )}
                      </p>
                    )}
                  </>
                )}
              </div>
              <Upload className="mt-0.5 hidden h-4 w-4 shrink-0 text-slate-400 sm:block" aria-hidden="true" />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
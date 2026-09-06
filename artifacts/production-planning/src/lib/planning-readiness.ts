import { UploadKind, type UploadedFile } from "@workspace/api-client-react";

export const PTMT_INPUT_KINDS = [
  UploadKind.pending_orders,
  UploadKind.current_stock,
  UploadKind.last_month_pending,
] as const;

export const PLUMBING_INPUT_KINDS = [
  UploadKind.pending_orders,
  UploadKind.plumbing_fg_stock,
] as const;

export type PlanningSegment = "PTMT" | "Plumbing";

export function inputKindsForSegment(segment: PlanningSegment) {
  return segment === "Plumbing" ? PLUMBING_INPUT_KINDS : PTMT_INPUT_KINDS;
}

export function uploadMatchesMonth(upload: UploadedFile, month: string) {
  return upload.period === month;
}

export function countUploadedKinds(
  uploads: UploadedFile[] | undefined,
  kinds: readonly string[],
  month: string,
) {
  return kinds.filter((kind) =>
    (uploads ?? []).some((upload) => upload.kind === kind && uploadMatchesMonth(upload, month)),
  ).length;
}

export function segmentInputStatus(
  uploads: UploadedFile[] | undefined,
  segment: PlanningSegment,
  month: string,
) {
  const kinds = inputKindsForSegment(segment);
  const uploaded = countUploadedKinds(uploads, kinds, month);
  return {
    required: kinds.length,
    uploaded,
    complete: uploaded === kinds.length,
  };
}
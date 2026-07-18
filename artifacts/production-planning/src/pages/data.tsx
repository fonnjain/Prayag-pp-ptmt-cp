import { useRef, useState } from "react";
import {
  useListBufferCategories,
  useUpdateBufferCategory,
  useRecomputeSeasonality,
  useListUploads,
  useCreateUpload,
  useGetSyncStatus,
  useSyncSheets,
  useListCategoryCapacities,
  useUpdateCategoryCapacity,
  useRecomputeCategoryCapacity,
  UploadKind,
  type SyncSource,
  type UploadedFile,
  type BufferCategory,
  type CategoryCapacity,
} from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/app-layout";
import { useSegment } from "@/contexts/segment-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn, fmtDateTime } from "@/lib/utils";

type UploadKindDef = { kind: (typeof UploadKind)[keyof typeof UploadKind]; label: string; hint: string; required: boolean };

// ── Global uploads — shared by ALL segments ──────────────────────────────────
// Upload once; the plan engine routes rows to PTMT or Plumbing via the Segment column.
const GLOBAL_UPLOAD_KINDS: UploadKindDef[] = [
  {
    kind: UploadKind.pending_orders,
    label: "DATA.xlsx — current pending orders (shared)",
    hint: "DATA.xlsx PendingOrder sheet. Rows tagged Segment ∈ {PTMT, PT} → PTMT pending. Rows tagged Segment = Plumbing → Plumbing pending. Upload once; both segments read from it automatically.",
    required: true,
  },
];

// ── Segment-local uploads — consumed only by the active segment ───────────────
const PTMT_LOCAL_UPLOAD_KINDS: UploadKindDef[] = [
  {
    kind: UploadKind.current_stock,
    label: "1 · F.G. STOCK Factory Excel",
    hint: "F.G. STOCK <month>.xlsx — reads F.G Sheet only: col A = Item Code, col B = Colour, col C = C/Stock. Provides current stock figures.",
    required: true,
  },
  {
    kind: UploadKind.last_month_pending,
    label: "2 · LAST_MONTH_PENDING_ORDERS file",
    hint: "LAST_MONTH_PENDING_ORDERS_<month>.xlsx — reads PTMT tab: Item Code + Colour + Qty. Provides last-month Pending Order. Total should be ~137,939.",
    required: true,
  },
];

// Plumbing plan reads ALL inputs (stock, pending, avg3mo, pending-LM) directly from
// the daily-production workbook via Google Sheets — no local file upload is required.
const PLUMBING_LOCAL_UPLOAD_KINDS: UploadKindDef[] = [];

function statusColor(status: SyncSource["status"]): string {
  switch (status) {
    case "success":
      return "bg-green-100 text-green-800";
    case "syncing":
      return "bg-blue-100 text-blue-800";
    case "error":
      return "bg-red-100 text-red-800";
    default:
      return "bg-gray-100 text-gray-700";
  }
}

function UploadRow({ kind, label, hint, required }: UploadKindDef) {
  const { toast } = useToast();
  const { data: uploads, refetch } = useListUploads();
  const createUpload = useCreateUpload();
  const inputRef = useRef<HTMLInputElement>(null);

  const latest = ((uploads as unknown as UploadedFile[] | undefined) ?? [])
    .filter((u) => u.kind === kind)
    .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())[0];

  const handleFile = (file: File) => {
    createUpload.mutate(
      { kind, data: { file } },
      {
        onSuccess: () => {
          toast({ title: "Upload complete", description: `${file.name} processed successfully.` });
          refetch();
        },
        onError: () => {
          toast({
            title: "Upload failed",
            description: "Could not parse the file. Check the format and try again.",
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b last:border-b-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-medium text-sm">{label}</p>
          {required && (
            <Badge className="text-xs bg-red-50 text-red-700 border border-red-200">required</Badge>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-0.5">{hint}</p>
        {latest ? (
          <p className="text-xs text-green-700 mt-1">
            ✓ {latest.filename} — {latest.rowCount} rows — {fmtDateTime(latest.uploadedAt)}
          </p>
        ) : (
          <p className="text-xs text-amber-600 mt-1">⚠ No file uploaded yet — plan cannot run without this file</p>
        )}
      </div>
      <div>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={createUpload.isPending}
        >
          {createUpload.isPending ? "Uploading..." : latest ? "Replace" : "Upload file"}
        </Button>
      </div>
    </div>
  );
}

// ─── Seasonality sparkline ────────────────────────────────────────────────────

const MONTHS_ABBR = ["Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar"];

function SeasonalitySparkline({ indices }: { indices: number[] }) {
  if (!indices || indices.length !== 12) {
    return <span className="text-xs text-gray-400">—</span>;
  }
  const W = 72;
  const H = 28;
  const pad = 2;
  const barW = (W - pad * 2) / 12 - 1;
  const max = Math.max(...indices, 1.5);
  const min = 0;

  return (
    <svg width={W} height={H} className="block" aria-label="Seasonal index Apr→Mar">
      {indices.map((v, i) => {
        const barH = Math.max(1, ((v - min) / (max - min)) * (H - pad * 2));
        const x = pad + i * ((W - pad * 2) / 12);
        const y = H - pad - barH;
        const isHigh = v >= 1.3;
        const isLow = v <= 0.7;
        const fill = isHigh ? "#f97316" : isLow ? "#93c5fd" : "#6366f1";
        return (
          <rect
            key={MONTHS_ABBR[i]}
            x={x}
            y={y}
            width={barW}
            height={barH}
            fill={fill}
            rx={1}
            aria-label={`${MONTHS_ABBR[i]}: ${v.toFixed(2)}`}
          />
        );
      })}
      {/* 1.00 baseline */}
      <line
        x1={pad}
        x2={W - pad}
        y1={H - pad - ((1.0 - min) / (max - min)) * (H - pad * 2)}
        y2={H - pad - ((1.0 - min) / (max - min)) * (H - pad * 2)}
        stroke="#d1d5db"
        strokeWidth={0.5}
        strokeDasharray="2,2"
      />
    </svg>
  );
}

// ─── Volatility class badge ───────────────────────────────────────────────────

function ClassBadge({ cls }: { cls: string | null | undefined }) {
  if (!cls) return <span className="text-gray-400">—</span>;
  const colors: Record<string, string> = {
    Low: "bg-green-100 text-green-800",
    Medium: "bg-amber-100 text-amber-800",
    High: "bg-red-100 text-red-800",
  };
  return (
    <Badge className={cn("text-xs font-semibold", colors[cls] ?? "bg-gray-100 text-gray-700")}>
      {cls}
    </Badge>
  );
}

function SignalBadge({ signal }: { signal: string | null | undefined }) {
  if (!signal) return <span className="text-gray-400">—</span>;
  const colors: Record<string, string> = {
    Growing: "bg-green-100 text-green-800",
    Stable: "bg-gray-100 text-gray-700",
    Declining: "bg-red-100 text-red-800",
  };
  return (
    <Badge className={cn("text-xs", colors[signal] ?? "bg-gray-100 text-gray-700")}>
      {signal}
    </Badge>
  );
}

// ─── Z-score labels ───────────────────────────────────────────────────────────

const Z_OPTIONS = [
  { value: 1.28, label: "90% (z=1.28)", short: "90%" },
  { value: 1.65, label: "95% (z=1.65)", short: "95%" },
  { value: 2.05, label: "98% (z=2.05)", short: "98%" },
];

// ─── Production Capacity Table ────────────────────────────────────────────────

function headroomColor(headroom: number, planNeedsPerDay: number): string {
  if (planNeedsPerDay <= 0) return "text-gray-400";
  if (headroom < 0) return "text-red-700 font-semibold";
  if (headroom < planNeedsPerDay * 0.1) return "text-amber-700 font-semibold";
  return "text-green-700";
}

function CapacityTable() {
  const { segment } = useSegment();
  const { data, isLoading, refetch } = useListCategoryCapacities({ segment } as any);
  const updateCapacity = useUpdateCategoryCapacity();
  const recompute = useRecomputeCategoryCapacity();
  const { toast } = useToast();
  const [overrideDrafts, setOverrideDrafts] = useState<Record<string, string>>({});

  const rows = (data as unknown as CategoryCapacity[] | undefined) ?? [];
  const lastComputedAt = rows.map(r => r.lastComputedAt).filter(Boolean).sort().at(-1);

  function appliedCapacity(row: CategoryCapacity): number {
    return row.overrideCapacity != null ? row.overrideCapacity : row.suggestedCapacity;
  }

  function handleOverrideSave(row: CategoryCapacity, draftStr: string) {
    const trimmed = draftStr.trim();
    const isBlank = trimmed === "" || trimmed === "—";
    const val = isBlank ? null : Number(trimmed.replace(/,/g, ""));
    if (!isBlank && (Number.isNaN(val) || (val ?? 0) < 0)) {
      toast({ title: "Invalid value", description: "Enter a positive number or leave blank to use suggestion.", variant: "destructive" });
      return;
    }
    (updateCapacity as unknown as { mutate: (args: object, cbs: object) => void }).mutate(
      { category: encodeURIComponent(row.category), data: { overrideCapacity: val } },
      {
        onSuccess: () => {
          setOverrideDrafts(d => { const n = { ...d }; delete n[row.category]; return n; });
          refetch();
          toast({ title: isBlank ? "Override cleared" : "Override saved", description: `${row.category} → ${isBlank ? "Suggested" : val?.toLocaleString() + " pcs/day"}` });
        },
        onError: () => toast({ title: "Update failed", variant: "destructive" }),
      },
    );
  }

  function handleRecompute() {
    (recompute as unknown as { mutate: (args: object, cbs: object) => void }).mutate(
      { params: { segment } },
      {
        onSuccess: () => {
          refetch();
          toast({ title: "Capacity recomputed", description: "p90, mean, and best-day updated from trailing 90-day production actuals." });
        },
        onError: () => toast({ title: "Recompute failed", variant: "destructive" }),
      },
    );
  }

  const actualsSource = segment === "Plumbing" ? "Plumbing production actuals (wiring in progress)" : "PTMT ANUJ daily actuals";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-gray-500">
          <strong>Suggested</strong> = p90 of trailing 90-day daily output (from {actualsSource}). <strong>Applied</strong> = Override if set, else Suggested — consumed by all levelling modules.
          {lastComputedAt && <span className="ml-2">Last recomputed: {fmtDateTime(lastComputedAt)}.</span>}
          {segment === "Plumbing" && <span className="ml-2 text-amber-600">Plumbing actuals feed not yet wired — all values show thin-data until connected.</span>}
        </div>
        <Button size="sm" onClick={handleRecompute} disabled={(recompute as { isPending?: boolean }).isPending} className="shrink-0">
          {(recompute as { isPending?: boolean }).isPending ? "Computing…" : "Recompute"}
        </Button>
      </div>

      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}

      {!isLoading && rows.length === 0 && (
        <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
          {segment === "Plumbing"
            ? <>⚠ No {segment} capacity data yet. Click <strong>Recompute</strong> to initialise rows, then set <strong>Override</strong> values manually until Plumbing actuals are wired.</>
            : <>⚠ No capacity data yet. Click <strong>Recompute</strong> to derive from PTMT ANUJ daily actuals.</>}
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-md border text-sm">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-50 text-xs font-semibold text-gray-600 uppercase tracking-wide">
                <th className="px-3 py-2 text-left">Category</th>
                <th className="px-3 py-2 text-right">Suggested</th>
                <th className="px-3 py-2 text-right">Override</th>
                <th className="px-3 py-2 text-right font-bold text-gray-800">Applied</th>
                <th className="px-3 py-2 text-right">Mean</th>
                <th className="px-3 py-2 text-right">p90</th>
                <th className="px-3 py-2 text-right">Best day</th>
                <th className="px-3 py-2 text-right">Days obs.</th>
                <th className="px-3 py-2 text-right">Plan needs/day</th>
                <th className="px-3 py-2 text-right">Headroom</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(row => {
                const applied = appliedCapacity(row);
                const headroom = applied - row.planNeedsPerDay;
                const draft = overrideDrafts[row.category];
                return (
                  <tr key={row.category} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium whitespace-nowrap">
                      {row.category}
                      {row.isThinData === 1 && (
                        <span className="ml-1 text-xs text-amber-600" title="Fewer than 10 producing days observed">⚠ thin data</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                      {Math.round(row.suggestedCapacity).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="text"
                        placeholder="—"
                        value={draft ?? (row.overrideCapacity != null ? String(Math.round(row.overrideCapacity)) : "")}
                        onChange={e => setOverrideDrafts(d => ({ ...d, [row.category]: e.target.value }))}
                        onBlur={() => { if (draft !== undefined) handleOverrideSave(row, draft); }}
                        onKeyDown={e => { if (e.key === "Enter" && draft !== undefined) handleOverrideSave(row, draft); }}
                        className="w-24 text-right text-sm border border-gray-300 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">
                      {Math.round(applied).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500">
                      {Math.round(row.meanPerDay).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500">
                      {Math.round(row.p90PerDay).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500">
                      {Math.round(row.bestDay).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500">
                      {row.daysObserved}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                      {row.planNeedsPerDay > 0 ? Math.round(row.planNeedsPerDay).toLocaleString() : "—"}
                    </td>
                    <td className={cn("px-3 py-2 text-right tabular-nums", headroomColor(headroom, row.planNeedsPerDay))}>
                      {row.planNeedsPerDay > 0 ? (headroom >= 0 ? "+" : "") + Math.round(headroom).toLocaleString() : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-400">
        Headroom = Applied − Plan needs/day. <span className="text-red-600">Red</span> = bottleneck (below plan need). <span className="text-amber-600">Amber</span> = within 10% headroom. <span className="text-green-600">Green</span> = ample headroom.
        Thin-data categories (&lt;10 producing days) are flagged — review manually before trusting.
      </p>
    </div>
  );
}

// ─── Main Seasonality Table ───────────────────────────────────────────────────

function SeasonalityTable({ segment }: { segment: string }) {
  const { data, isLoading, refetch } = useListBufferCategories({ segment } as any);
  const updateCategory = useUpdateBufferCategory();
  const recompute = useRecomputeSeasonality();
  const { toast } = useToast();
  const [overrideDrafts, setOverrideDrafts] = useState<Record<number, string>>({});
  const [selectedZ, setSelectedZ] = useState<number>(1.65);

  const categories = (data as unknown as BufferCategory[] | undefined) ?? [];
  const lastComputedAt = categories
    .map((c) => c.lastComputedAt)
    .filter(Boolean)
    .sort()
    .at(-1);
  const hasEngineData = categories.some((c) => c.lastComputedAt != null);

  function getApplied(cat: BufferCategory): number {
    return cat.overrideMultiplier ?? cat.suggestedMultiplier ?? cat.multiplier;
  }

  function parseIndices(raw: string | null | undefined): number[] | null {
    if (!raw) return null;
    try {
      const arr = JSON.parse(raw) as unknown;
      if (Array.isArray(arr) && arr.length === 12) return arr as number[];
    } catch { /* ignore */ }
    return null;
  }

  function handleOverrideSave(cat: BufferCategory, draftStr: string) {
    const trimmed = draftStr.trim();
    if (trimmed === "" || trimmed === "—") {
      // Clear override
      (updateCategory as unknown as { mutate: (args: object, cbs: object) => void }).mutate(
        { id: cat.id, data: { overrideMultiplier: null } },
        {
          onSuccess: () => {
            setOverrideDrafts((d) => { const next = { ...d }; delete next[cat.id]; return next; });
            refetch();
            toast({ title: "Override cleared", description: `${cat.name} → Suggested ×` });
          },
          onError: () => toast({ title: "Update failed", variant: "destructive" }),
        },
      );
      return;
    }
    const val = parseFloat(trimmed);
    if (Number.isNaN(val) || val < 0) {
      toast({ title: "Invalid value", description: "Enter a positive number or clear to use the suggestion.", variant: "destructive" });
      return;
    }
    (updateCategory as unknown as { mutate: (args: object, cbs: object) => void }).mutate(
      { id: cat.id, data: { overrideMultiplier: val } },
      {
        onSuccess: () => {
          setOverrideDrafts((d) => { const next = { ...d }; delete next[cat.id]; return next; });
          refetch();
          toast({ title: "Override saved", description: `${cat.name} → ${val.toFixed(2)}×` });
        },
        onError: () => toast({ title: "Update failed", variant: "destructive" }),
      },
    );
  }

  function handleRecompute() {
    recompute.mutate(
      { params: { z: selectedZ } },
      {
        onSuccess: () => {
          refetch();
          toast({
            title: "Seasonality computed",
            description: `Suggested multipliers updated from FY24-25 + FY25-26 order intake (z=${selectedZ}).`,
          });
        },
        onError: () =>
          toast({ title: "Recompute failed", description: "Check API logs.", variant: "destructive" }),
      },
    );
  }

  return (
    <div className="space-y-4">
      {/* Header controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700">Service level:</span>
          <div className="flex gap-1">
            {Z_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSelectedZ(opt.value)}
                className={cn(
                  "px-2 py-1 rounded text-xs font-medium border transition-colors",
                  selectedZ === opt.value
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50",
                )}
              >
                {opt.short}
              </button>
            ))}
          </div>
          <span className="text-xs text-gray-400">(z = {selectedZ})</span>
        </div>
        <Button
          size="sm"
          onClick={handleRecompute}
          disabled={recompute.isPending}
          className="shrink-0"
        >
          {recompute.isPending ? "Computing… (reads 24 tabs)" : hasEngineData ? "Recompute" : "Compute engine"}
        </Button>
      </div>

      {/* Data window label */}
      <div className="rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-800">
        <strong>Suggested ×</strong> derived from FY2024-25 + FY2025-26 order intake (24 months).
        FY2026-27 excluded (part-year); FY2023-24 excluded (old ERP layout).
        {lastComputedAt && (
          <span className="ml-2 text-blue-600">Last computed: {fmtDateTime(lastComputedAt)}.</span>
        )}
      </div>

      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}

      {!isLoading && !hasEngineData && (
        <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
          ⚠ Engine has not been run yet. Click <strong>Compute engine</strong> to derive suggested multipliers
          from historical order intake. This reads 24 Google Sheets tabs — expect 1–2 minutes.
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm min-w-[900px]">
          <thead>
            <tr className="bg-gray-50 border-b text-xs text-gray-600 font-semibold uppercase tracking-wide">
              <th className="px-3 py-2 text-left">Category</th>
              <th className="px-3 py-2 text-right">Avg month</th>
              <th className="px-3 py-2 text-right">CV</th>
              <th className="px-3 py-2 text-center">Class</th>
              <th className="px-3 py-2 text-right">Suggested ×</th>
              <th className="px-3 py-2 text-center">Override ×</th>
              <th className="px-3 py-2 text-right font-bold text-gray-800">Applied ×</th>
              <th className="px-3 py-2 text-left">Peak</th>
              <th className="px-3 py-2 text-right">YoY</th>
              <th className="px-3 py-2 text-center">Signal</th>
              <th className="px-3 py-2 text-center">Apr → Mar</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {categories.map((cat) => {
              const indices = parseIndices(cat.seasonalIndices);
              const isInsufficient = cat.dataQuality === "insufficient" || (!cat.lastComputedAt && !cat.suggestedMultiplier);
              const isThin = cat.dataQuality === "thin";
              const applied = getApplied(cat);
              const draftKey = cat.id;
              const currentDraft = overrideDrafts[draftKey];
              const overrideDisplay =
                currentDraft !== undefined
                  ? currentDraft
                  : cat.overrideMultiplier != null
                  ? String(cat.overrideMultiplier)
                  : "";

              return (
                <tr key={cat.id} className={cn("hover:bg-gray-50 transition-colors", isInsufficient && "bg-amber-50/40")}>
                  {/* Category */}
                  <td className="px-3 py-2.5">
                    <div className="font-medium">{cat.name}</div>
                    {isInsufficient && cat.lastComputedAt && (
                      <div className="text-xs text-amber-700 mt-0.5">⚠ No order data — override required</div>
                    )}
                    {isThin && (
                      <div className="text-xs text-amber-700 mt-0.5">⚠ Thin data — verify manually</div>
                    )}
                  </td>

                  {/* Avg month */}
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {cat.avgMonth != null ? cat.avgMonth.toLocaleString() : <span className="text-gray-400">—</span>}
                  </td>

                  {/* CV */}
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {cat.cvValue != null ? cat.cvValue.toFixed(2) : <span className="text-gray-400">—</span>}
                  </td>

                  {/* Class */}
                  <td className="px-3 py-2.5 text-center">
                    <ClassBadge cls={cat.volatilityClass} />
                  </td>

                  {/* Suggested × */}
                  <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                    {cat.suggestedMultiplier != null ? (
                      <span>{cat.suggestedMultiplier.toFixed(2)}×</span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>

                  {/* Override × (editable) */}
                  <td className="px-3 py-2.5 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <Input
                        type="text"
                        inputMode="decimal"
                        value={overrideDisplay}
                        placeholder="—"
                        onChange={(e) =>
                          setOverrideDrafts((d) => ({ ...d, [draftKey]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleOverrideSave(cat, overrideDisplay);
                          if (e.key === "Escape") setOverrideDrafts((d) => { const n = { ...d }; delete n[draftKey]; return n; });
                        }}
                        onBlur={() => {
                          if (currentDraft !== undefined) handleOverrideSave(cat, overrideDisplay);
                        }}
                        className="w-20 h-7 text-center text-sm"
                      />
                    </div>
                  </td>

                  {/* Applied × */}
                  <td className="px-3 py-2.5 text-right font-bold tabular-nums">
                    <span
                      className={cn(
                        "text-base",
                        cat.overrideMultiplier != null ? "text-indigo-700" : "text-gray-900",
                      )}
                    >
                      {applied.toFixed(2)}×
                    </span>
                    {cat.overrideMultiplier != null && (
                      <span className="ml-1 text-xs text-indigo-500">override</span>
                    )}
                  </td>

                  {/* Peak */}
                  <td className="px-3 py-2.5">
                    {cat.peakMonth && cat.peakIndex != null ? (
                      <span className="text-sm">
                        {cat.peakMonth} <span className="text-xs text-gray-500">({cat.peakIndex.toFixed(2)})</span>
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>

                  {/* YoY */}
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {cat.yoy != null ? (
                      <span
                        className={cn(
                          "text-sm font-medium",
                          cat.yoy > 0.08 ? "text-green-700" : cat.yoy < -0.08 ? "text-red-700" : "text-gray-700",
                        )}
                      >
                        {cat.yoy > 0 ? "+" : ""}{(cat.yoy * 100).toFixed(0)}%
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>

                  {/* Signal */}
                  <td className="px-3 py-2.5 text-center">
                    <SignalBadge signal={cat.signal} />
                  </td>

                  {/* Sparkline */}
                  <td className="px-3 py-2.5 text-center">
                    {indices ? (
                      <SeasonalitySparkline indices={indices} />
                    ) : (
                      <span className="text-gray-400 text-xs">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="text-xs text-gray-500 space-y-1">
        <p>
          <strong>Suggested ×</strong> = 1 + z × CV, where CV is measured on deseasonalised FY2024-25 + FY2025-26 order intake.
          Current hard-coded values (1.5/1.2) were placeholders — engine values are typically lower because
          seasonal shape is removed before measuring volatility.
        </p>
        <p>
          <strong>Override ×</strong>: type a value and press Enter (or click away) to override a category.
          Clear the field to snap back to the engine suggestion.
          <strong className="ml-1 text-indigo-700">Applied ×</strong> is what the plan's Buffer Req uses.
        </p>
        <p>
          <strong>Sparkline</strong> shows the seasonal index Apr→Mar (1.00 = average month).
          <span className="ml-1 text-orange-500">■</span> above 1.3 ·
          <span className="ml-1 text-blue-400">■</span> below 0.7 ·
          <span className="ml-1 text-indigo-500">■</span> near average.
          Dashed line = 1.00.
        </p>
      </div>
    </div>
  );
}

function GoogleSheetsStatus() {
  const { data, isLoading, refetch } = useGetSyncStatus();
  const syncSheets = useSyncSheets();
  const { toast } = useToast();

  const sources = (data as unknown as SyncSource[] | undefined) ?? [];

  const lastSyncedAt = sources
    .map((s) => s.lastSyncedAt)
    .filter(Boolean)
    .sort()
    .at(-1);

  return (
    <div className="space-y-3">
      {lastSyncedAt && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-blue-50 border border-blue-200 text-sm text-blue-800">
          <span className="text-base">🔄</span>
          <span>
            <strong>Last synced:</strong> {fmtDateTime(lastSyncedAt)}
          </span>
        </div>
      )}

      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={() =>
            syncSheets.mutate(undefined, {
              onSuccess: () => {
                toast({ title: "Sync complete", description: "Live Google Sheets sources refreshed." });
                refetch();
              },
              onError: () =>
                toast({ title: "Sync failed", description: "Check the sheet connections and try again.", variant: "destructive" }),
            })
          }
          disabled={syncSheets.isPending}
        >
          {syncSheets.isPending ? "Syncing…" : "Sync now"}
        </Button>
      </div>
      {isLoading && <p className="text-sm text-gray-500">Loading sync status…</p>}
      {!isLoading &&
        sources.map((src) => (
          <div key={src.id} className="flex items-center justify-between py-2 border-b last:border-b-0">
            <div>
              <p className="text-sm font-medium">{src.name}</p>
              {src.message && <p className="text-xs text-gray-500">{src.message}</p>}
            </div>
            <div className="flex items-center gap-2">
              {src.lastSyncedAt && (
                <span className="text-xs text-gray-500">
                  {fmtDateTime(src.lastSyncedAt)}
                </span>
              )}
              <Badge className={cn("capitalize", statusColor(src.status))}>{src.status}</Badge>
            </div>
          </div>
        ))}
      {!isLoading && sources.length === 0 && (
        <p className="text-sm text-gray-500">No live sheet sources configured.</p>
      )}
    </div>
  );
}

type CheckResult = {
  name: string;
  expected: number;
  actual: number;
  pass: boolean;
  tolerance?: string;
};

type ValidationResponse = {
  month: string;
  segment?: string;
  allPass: boolean;
  passCount: number;
  failCount: number;
  checks: CheckResult[];
  categoryTotals?: Record<string, number>;
};

function ValidationPanel({ segment }: { segment: string }) {
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [month, setMonth] = useState(defaultMonth);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ValidationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isPlumbing = segment === "Plumbing";

  const runChecks = async () => {
    if (!month) return;
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      const url = `/api/plan/validate?month=${encodeURIComponent(month)}&segment=${encodeURIComponent(segment)}`;
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as ValidationResponse;
      setResult(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        {isPlumbing
          ? "Runs 12 golden-value spot-checks — one per planning line (4 materials × 3 types: Pipe/Fitting/Solvent), verified cell-by-cell vs July 2026 master Excel. All must pass before the Plumbing plan is trustworthy."
          : "Runs 6 golden-value spot-checks against the uploaded files and live sheet data. All checks must pass before the plan is trustworthy. Fails are shown loudly — no silent fallbacks."}
      </p>

      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-gray-700 whitespace-nowrap">Planning month</label>
        <Input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="w-44 h-8"
        />
        <Button size="sm" onClick={runChecks} disabled={running || !month}>
          {running ? "Running…" : "Run checks"}
        </Button>
      </div>

      {error && (
        <div className="px-3 py-2 rounded-md bg-red-50 border border-red-200 text-sm text-red-700">
          Error: {error}
        </div>
      )}

      {result && (
        <div className="space-y-2">
          <div
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium",
              result.allPass
                ? "bg-green-50 border border-green-200 text-green-800"
                : "bg-red-50 border border-red-200 text-red-800",
            )}
          >
            <span className="text-base">{result.allPass ? "✅" : "❌"}</span>
            <span>
              {result.allPass
                ? `All ${result.passCount} checks passed for ${result.month}`
                : `${result.failCount} of ${result.passCount + result.failCount} checks FAILED for ${result.month}`}
            </span>
          </div>

          <div className="rounded-md border divide-y text-sm">
            {result.checks.map((c) => (
              <div key={c.name} className="flex items-center justify-between px-3 py-2">
                <div className="flex items-center gap-2">
                  <span>{c.pass ? "✅" : "❌"}</span>
                  <span className={cn("font-medium", !c.pass && "text-red-700")}>{c.name}</span>
                  {c.tolerance && <span className="text-xs text-gray-400">({c.tolerance})</span>}
                </div>
                <div className="text-right text-xs font-mono">
                  {c.pass ? (
                    <span className="text-green-700">{c.actual.toLocaleString()}</span>
                  ) : (
                    <span className="text-red-700">
                      got {c.actual.toLocaleString()} · expected {c.expected.toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function DataPage() {
  const { segment } = useSegment();
  const localUploadKinds = segment === "Plumbing" ? PLUMBING_LOCAL_UPLOAD_KINDS : PTMT_LOCAL_UPLOAD_KINDS;

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h2 className="text-xl font-semibold">Data — {segment}</h2>
          <p className="text-sm text-gray-500">
            {segment === "Plumbing"
              ? "One global upload (DATA.xlsx, shared with PTMT) + one local Plumbing upload. Avg 3-Month Sale comes live from the Sale 26-27 Google Sheets connection."
              : "One global upload (DATA.xlsx, shared with Plumbing) + two local PTMT uploads. Avg 3-Month Sale comes live from the Sale 26-27 Google Sheets connection."}
          </p>
        </div>

        {/* ── Global uploads — shared by both PTMT and Plumbing ── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Global uploads — shared by all segments (1 required)</CardTitle>
          </CardHeader>
          <CardContent>
            {GLOBAL_UPLOAD_KINDS.map((u) => (
              <UploadRow key={u.kind} {...u} />
            ))}
            <div className="pt-3 text-xs text-gray-500 border-t mt-2">
              DATA.xlsx must be uploaded here once. The plan engine reads the PendingOrder sheet and routes
              rows to PTMT or Plumbing automatically based on the Segment column — no duplicate upload needed.
            </div>
          </CardContent>
        </Card>

        {/* ── Local uploads — segment-specific ── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Local uploads — {segment} ({segment === "Plumbing" ? 1 : 2} required)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {localUploadKinds.map((u) => (
              <UploadRow key={u.kind} {...u} />
            ))}
            {segment === "PTMT" && (
              <div className="pt-3 text-xs text-gray-500 space-y-1 border-t mt-2">
                <p>
                  <strong>Stock</strong> comes from the F.G Sheet of the F.G. STOCK factory Excel (col A/B/C).
                  The LAST MONTH PENDING ITEMS tab inside that file is <em>not</em> used — upload file 2 instead.
                </p>
                <p>
                  <strong>Last-Month Pending</strong> comes from the dedicated LAST_MONTH file's PTMT tab
                  (not from F.G. STOCK). PTMT-segment total should be ~137,939.
                </p>
              </div>
            )}
            {segment === "Plumbing" && (
              <div className="pt-3 text-xs text-gray-500 space-y-1 border-t mt-2">
                <p>
                  <strong>Net Stock column (Col R)</strong>: positive values → opening stock as on 1st of month;
                  negative values → absolute value = pending order last month. Both come from this single file.
                </p>
                <p>
                  <strong>Category column</strong> maps each row to one of 12 planning lines:
                  CPVC/UPVC/SWR/AGRI × Pipe/Fitting/Solvent. TRADING, WATER TANK, PPR, and Column Pipe rows
                  are excluded from the plan automatically.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Google Sheets — live data sync</CardTitle>
          </CardHeader>
          <CardContent>
            <GoogleSheetsStatus />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Golden-value validation checks</CardTitle>
          </CardHeader>
          <CardContent>
            <ValidationPanel segment={segment} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Production Capacity (pcs/day by category)</CardTitle>
            <p className="text-xs text-gray-500 mt-1">
              Three-column model: <strong>Suggested</strong> (p90 of trailing 90-day actuals, auto-computed) ·{" "}
              <strong>Override</strong> (user, optional — type to set, clear to restore suggestion) ·{" "}
              <strong>Applied</strong> (= Override if set, else Suggested). All levelling modules use Applied.
            </p>
          </CardHeader>
          <CardContent>
            <CapacityTable />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Buffer-stock multipliers (months of average sale)</CardTitle>
            <p className="text-xs text-gray-500 mt-1">
              Three-column model: <strong>Suggested ×</strong> (engine, read-only) ·{" "}
              <strong>Override ×</strong> (user, optional) · <strong>Applied ×</strong> (= override if set, else suggested). The plan's Buffer Req uses Applied ×.
            </p>
          </CardHeader>
          <CardContent>
            <SeasonalityTable segment={segment} />
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}

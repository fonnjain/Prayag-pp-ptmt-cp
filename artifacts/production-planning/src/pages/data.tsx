import { useRef, useState, useEffect, useCallback } from "react";
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
import { RefreshCw } from "lucide-react";

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

const PLUMBING_LOCAL_UPLOAD_KINDS: UploadKindDef[] = [
  {
    kind: UploadKind.plumbing_fg_stock,
    label: "FG Stock file (stock + pending last month)",
    hint: 'e.g. "FG Stock and Pending Production month of June.xlsx" → worksheet "FG Stock". Col R = Net Stock: POSITIVE → opening stock (1st of month). NEGATIVE → absolute value = pending order last month. Category col maps to one of 12 planning lines (CPVC/UPVC/SWR/AGRI × Pipe/Fitting/Solvent).',
    required: true,
  },
];

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
    // Applied = Override when set; otherwise the DB multiplier (business default).
    // suggestedMultiplier is ADVISORY ONLY — it never enters the plan automatically.
    return cat.overrideMultiplier ?? cat.multiplier;
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
            toast({ title: "Override cleared", description: `${cat.name} → business default ×` });
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

      {/* Advisory note */}
      <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
        ⚠ <strong>Suggested values are advisory</strong> — click to accept before they affect the plan.
        The plan always uses <strong>Applied ×</strong> (Override if set, otherwise the business default).
        Suggested is shown for review only and never auto-applied.
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

// ── Hardcoded fallback IDs shown as placeholders ──────────────────────────────
const PTMT_FALLBACK: Record<string, string> = {
  "2026-04": "16zsh5x4MdY8DX3H5_hw5iaOdkGixlUsPzesDVnwgfYo",
  "2026-05": "1T1M5MT47P3D4wCwi7tX7KcL_sHVtx43NSuXFDP9Oq78",
  "2026-06": "1nEDFjrVu6pnNkzZ9tJhvGvBDMUHjLStcc0RP2uHig4g",
  "2026-07": "1AjMLfcBkI0rGY8JdYP3MO8Ocn8lO-HIpol1tHgvK9O8",
};
const PLUMBING_FALLBACK: Record<string, string> = {
  "2026-07": "1wlB4Y4lnP7Y2SLZX6atFN-nrKA--ByYF8m2TVHuBxD0",
};

type WorkbookRow = {
  id: string;
  division: string;
  month: string;
  workbookId: string;
  label: string;
  updatedAt: string;
};

type DriveCandidate = { fileId: string; fileName: string; modifiedTime: string };

type DivisionSuggestState = {
  searching: boolean;
  candidates: DriveCandidate[];
  searchError: string | null;
  showManual: boolean;
  manualQuery: string;
  manualId: string;
  saving: boolean;
};

function initDivState(): DivisionSuggestState {
  return { searching: false, candidates: [], searchError: null, showManual: false, manualQuery: "", manualId: "", saving: false };
}

function abbreviateId(id: string) {
  return id.length > 16 ? `${id.slice(0, 10)}…${id.slice(-4)}` : id;
}

function fmtDriveDate(iso: string) {
  const d = new Date(iso);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function WorkbookConfigPanel() {
  const { toast } = useToast();
  const [dbRows, setDbRows]   = useState<WorkbookRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [divState, setDivState] = useState<Record<string, DivisionSuggestState>>({
    PTMT: initDivState(),
    Plumbing: initDivState(),
  });

  const currentMonth = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  })();

  const nextMonth = (() => {
    const d = new Date();
    const nd = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    return `${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, "0")}`;
  })();

  const fetchRows = useCallback(async () => {
    try {
      const res = await fetch("/api/workbook-config");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDbRows(await res.json());
    } catch {
      toast({ title: "Failed to load workbook config", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const patchDiv = (division: string, patch: Partial<DivisionSuggestState>) =>
    setDivState(prev => ({ ...prev, [division]: { ...prev[division], ...patch } }));

  const getActive = (division: string, month: string): { id: string; source: "DB" | "built-in" } | null => {
    const db = dbRows.find(r => r.division === division && r.month === month);
    if (db) return { id: db.workbookId, source: "DB" };
    const fb = (division === "PTMT" ? PTMT_FALLBACK : PLUMBING_FALLBACK)[month];
    if (fb) return { id: fb, source: "built-in" };
    return null;
  };

  const searchDrive = async (division: string, customQuery?: string) => {
    patchDiv(division, { searching: true, searchError: null, candidates: [] });
    try {
      const params = new URLSearchParams({ division, month: nextMonth });
      if (customQuery) params.set("query", customQuery);
      const res = await fetch(`/api/workbook-config/suggest?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const candidates: DriveCandidate[] = data.candidates ?? [];
      patchDiv(division, {
        searching: false,
        candidates,
        searchError: candidates.length === 0 ? "No matching files found in Drive." : null,
        showManual: candidates.length === 0,
      });
    } catch {
      patchDiv(division, { searching: false, searchError: "Drive search failed — check connection.", showManual: true });
    }
  };

  const saveForNextMonth = async (division: string, workbookId: string) => {
    const id = workbookId.trim();
    if (!id) return;
    patchDiv(division, { saving: true });
    const rowId = `${division.toLowerCase()}_${nextMonth}`;
    try {
      const res = await fetch(`/api/workbook-config/${rowId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ division, month: nextMonth, workbookId: id, label: `${division} daily workbook ${nextMonth}` }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({ title: "Saved", description: `${division} workbook configured for ${nextMonth}.` });
      patchDiv(division, { saving: false, candidates: [], showManual: false, manualId: "", manualQuery: "" });
      fetchRows();
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
      patchDiv(division, { saving: false });
    }
  };

  const removeNextMonth = async (division: string) => {
    const rowId = `${division.toLowerCase()}_${nextMonth}`;
    try {
      await fetch(`/api/workbook-config/${rowId}`, { method: "DELETE" });
      toast({ title: "Removed" });
      fetchRows();
    } catch {
      toast({ title: "Remove failed", variant: "destructive" });
    }
  };

  const renderDivision = (division: "PTMT" | "Plumbing") => {
    const ds = divState[division];
    const current  = getActive(division, currentMonth);
    const nextDbRow = dbRows.find(r => r.division === division && r.month === nextMonth);
    const keyword  = division === "PTMT" ? "'PTMT'" : "'PLUMBING'";

    return (
      <div className="space-y-3">
        <p className="text-xs font-bold text-gray-700 uppercase tracking-widest">{division}</p>

        {/* ── Current month — read-only, in flight ── */}
        <div className="rounded-md border bg-gray-50 px-3 py-2.5 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-600">Current month</span>
            <span className="text-xs text-gray-400">({currentMonth})</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">● Active</span>
          </div>
          {current ? (
            <div className="flex items-center gap-2">
              <code className="rounded bg-white border px-1.5 py-0.5 text-xs font-mono">{abbreviateId(current.id)}</code>
              <a
                href={`https://docs.google.com/spreadsheets/d/${current.id}`}
                target="_blank" rel="noreferrer"
                className="text-xs text-blue-600 hover:underline"
              >↗ Open</a>
              <span className="text-xs text-gray-400">source: {current.source}</span>
            </div>
          ) : (
            <p className="text-xs text-amber-600">No workbook configured for this month.</p>
          )}
        </div>

        {/* ── Next month — configurable ── */}
        <div className="rounded-md border px-3 py-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-600">Next month</span>
              <span className="text-xs text-gray-400">({nextMonth})</span>
              <span className="text-xs text-blue-600 font-medium">→ takes effect at month-end</span>
            </div>
            {nextDbRow && (
              <button className="text-xs text-red-500 hover:text-red-700" onClick={() => removeNextMonth(division)}>
                Remove
              </button>
            )}
          </div>

          {nextDbRow ? (
            <div className="flex items-center gap-2">
              <code className="rounded bg-white border px-1.5 py-0.5 text-xs font-mono">{abbreviateId(nextDbRow.workbookId)}</code>
              <a
                href={`https://docs.google.com/spreadsheets/d/${nextDbRow.workbookId}`}
                target="_blank" rel="noreferrer"
                className="text-xs text-blue-600 hover:underline"
              >↗ Open</a>
              <span className="text-xs text-gray-400">saved {fmtDriveDate(nextDbRow.updatedAt)}</span>
            </div>
          ) : (
            <p className="text-xs text-gray-400 italic">Not configured — will auto-detect from Drive at month-end.</p>
          )}

          <Button
            size="sm" variant="outline"
            className="h-7 text-xs gap-1"
            disabled={ds.searching}
            onClick={() => searchDrive(division)}
          >
            {ds.searching ? "Searching Drive…" : "🔍 Search Drive for suggestions"}
          </Button>
        </div>

        {/* ── Drive candidates ── */}
        {(ds.candidates.length > 0 || ds.searchError) && (
          <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2.5 space-y-2">
            {ds.searchError && <p className="text-xs text-amber-700">{ds.searchError}</p>}

            {ds.candidates.length > 0 && (
              <>
                <p className="text-xs font-semibold text-gray-600">
                  Drive suggestions for {nextMonth}:
                </p>
                <div className="space-y-1.5">
                  {ds.candidates.map((c, idx) => (
                    <div key={c.fileId} className="flex items-center gap-2">
                      <span className="w-3 shrink-0 text-yellow-500 text-xs">{idx === 0 ? "★" : ""}</span>
                      <span className="flex-1 text-xs truncate min-w-0" title={c.fileName}>{c.fileName}</span>
                      <span className="text-xs text-gray-400 shrink-0 whitespace-nowrap">{fmtDriveDate(c.modifiedTime)}</span>
                      <Button
                        size="sm"
                        className="h-6 text-xs px-2 shrink-0"
                        disabled={ds.saving}
                        onClick={() => saveForNextMonth(division, c.fileId)}
                      >
                        {ds.saving ? "…" : "Use this"}
                      </Button>
                    </div>
                  ))}
                </div>
              </>
            )}

            {!ds.showManual && (
              <button
                className="text-xs text-blue-600 hover:underline"
                onClick={() => patchDiv(division, { showManual: true })}
              >
                Not the right file? Enter manually ↓
              </button>
            )}
          </div>
        )}

        {/* ── Manual fallback ── */}
        {ds.showManual && (
          <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5 space-y-2.5">
            <p className="text-xs font-semibold text-gray-700">Enter manually</p>
            <p className="text-xs text-gray-500">
              Look in your Google Drive for a file with {keyword} in the name for{" "}
              {nextMonth}. You can search below or paste the Spreadsheet ID directly.
            </p>

            <div className="space-y-1">
              <p className="text-xs text-gray-500 font-medium">Search by file name:</p>
              <div className="flex gap-1.5">
                <Input
                  className="flex-1 h-7 text-xs"
                  placeholder={`e.g. ${division} DAILY ${nextMonth}`}
                  value={ds.manualQuery}
                  onChange={e => patchDiv(division, { manualQuery: e.target.value })}
                  onKeyDown={e => { if (e.key === "Enter" && ds.manualQuery.trim()) searchDrive(division, ds.manualQuery); }}
                />
                <Button
                  size="sm" variant="outline"
                  className="h-7 text-xs shrink-0"
                  disabled={ds.searching || !ds.manualQuery.trim()}
                  onClick={() => searchDrive(division, ds.manualQuery)}
                >
                  {ds.searching ? "…" : "Search"}
                </Button>
              </div>
            </div>

            <div className="space-y-1">
              <p className="text-xs text-gray-500 font-medium">Or paste Spreadsheet ID:</p>
              <div className="flex gap-1.5">
                <Input
                  className="flex-1 h-7 text-xs font-mono"
                  placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
                  value={ds.manualId}
                  onChange={e => patchDiv(division, { manualId: e.target.value })}
                />
                <Button
                  size="sm"
                  className="h-7 text-xs shrink-0"
                  disabled={ds.saving || !ds.manualId.trim()}
                  onClick={() => saveForNextMonth(division, ds.manualId)}
                >
                  {ds.saving ? "…" : "Save"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <p className="text-xs text-gray-500">
        Each division's daily-production workbook is a Google Spreadsheet. Use{" "}
        <strong>Search Drive</strong> to auto-suggest next month's file — the app will rank candidates
        by name match and recency. Accept a suggestion, or fall back to a manual search / paste.
        Changes to next month's workbook <strong>take effect at month-end</strong>.
        DB-configured IDs always override built-in fallbacks.
      </p>

      {loading && <p className="text-sm text-gray-400">Loading…</p>}

      {!loading && (
        <div className="space-y-6">
          {renderDivision("PTMT")}
          <div className="border-t" />
          {renderDivision("Plumbing")}
        </div>
      )}
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
          ? "Automated regression suite for Plumbing (July 2026 reference): 3 guard assertions (non-empty plan, FG Stock upload present, computed not copied) · 2 isolation checks · 12 buffer-multiplier defaults · 15 solvent-membership checks · 12 category totals ±1%. Any single failure means the plan cannot be trusted."
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

// ─── Plumbing Machine Capacity Panel ─────────────────────────────────────────

interface MachineRow {
  id: number;
  machineId: string;
  label: string | null;
  pool: string;
  shiftsPerDay: number;
  hoursPerShift: number;
  workingDays: number;
  lockedOut: boolean;
  rates: Record<string, number>;
}

function MachineCapacityPanel() {
  const currentMonth = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  })();
  const [machines, setMachines] = useState<MachineRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, { shifts?: string; hours?: string; locked?: boolean }>>({});
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/capacity/machines?segment=Plumbing&month=${encodeURIComponent(currentMonth)}`,
      );
      if (!res.ok) {
        const b = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(b.error ?? `HTTP ${res.status}`);
      }
      const body = await res.json() as { machines: MachineRow[] };
      setMachines(body.machines);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [currentMonth]);

  useEffect(() => { load(); }, [load]);

  const save = async (m: MachineRow) => {
    const draft = drafts[m.id] ?? {};
    const shifts = draft.shifts !== undefined ? parseFloat(draft.shifts) : m.shiftsPerDay;
    const hours  = draft.hours  !== undefined ? parseFloat(draft.hours)  : m.hoursPerShift;
    const locked = draft.locked !== undefined ? draft.locked : m.lockedOut;
    if (Number.isNaN(shifts) || Number.isNaN(hours) || shifts <= 0 || hours <= 0) {
      toast({ title: "Invalid value", description: "Shifts and hours must be positive numbers.", variant: "destructive" });
      return;
    }
    setSaving(m.id);
    try {
      const res = await fetch(`/api/capacity/machines/${encodeURIComponent(m.machineId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shiftsPerDay: shifts, hoursPerShift: hours, lockedOut: locked }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(b.error ?? `HTTP ${res.status}`);
      }
      toast({ title: "Saved", description: `${m.label ?? m.machineId} updated.` });
      setDrafts(d => { const next = { ...d }; delete next[m.id]; return next; });
      await load();
    } catch (e) {
      toast({ title: "Save failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const pipeMachines  = machines.filter(m => m.pool === "PIPE");
  const mouldMachines = machines.filter(m => m.pool === "MOULDING");

  const renderPool = (pool: MachineRow[], poolLabel: string) => (
    <div className="space-y-2">
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{poolLabel}</div>
      <div className="overflow-x-auto rounded-md border text-sm">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-gray-50 text-xs font-semibold text-gray-600 uppercase tracking-wide">
              <th className="px-3 py-2 text-left">Machine</th>
              <th className="px-3 py-2 text-left">Materials / Rate</th>
              <th className="px-3 py-2 text-center">Shifts/day</th>
              <th className="px-3 py-2 text-center">Hrs/shift</th>
              <th className="px-3 py-2 text-center">Locked out</th>
              <th className="px-3 py-2 text-center">h/day</th>
              <th className="px-3 py-2 text-center">h/month ≈</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {pool.map(m => {
              const draft = drafts[m.id] ?? {};
              const isDirty = Object.keys(draft).length > 0;
              const shifts = draft.shifts !== undefined ? draft.shifts : String(m.shiftsPerDay);
              const hours  = draft.hours  !== undefined ? draft.hours  : String(m.hoursPerShift);
              const locked = draft.locked !== undefined ? draft.locked : m.lockedOut;
              const materials = Object.entries(m.rates)
                .map(([k, v]) => `${k} ${v} kg/hr`)
                .join(", ");
              const sVal = parseFloat(shifts) || m.shiftsPerDay;
              const hVal = parseFloat(hours) || m.hoursPerShift;
              const hDay   = sVal * hVal;
              const hMonth = hDay * m.workingDays;
              return (
                <tr key={m.id} className={cn("hover:bg-gray-50", locked ? "opacity-50" : "")}>
                  <td className="px-3 py-2 font-medium whitespace-nowrap">
                    {m.label ?? m.machineId}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500 max-w-[180px]">{materials || "—"}</td>
                  <td className="px-3 py-2">
                    <Input
                      className="w-16 h-7 text-xs text-center"
                      value={shifts}
                      onChange={e => setDrafts(d => ({ ...d, [m.id]: { ...d[m.id], shifts: e.target.value } }))}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      className="w-16 h-7 text-xs text-center"
                      value={hours}
                      onChange={e => setDrafts(d => ({ ...d, [m.id]: { ...d[m.id], hours: e.target.value } }))}
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={locked}
                      onChange={e => setDrafts(d => ({ ...d, [m.id]: { ...d[m.id], locked: e.target.checked } }))}
                      className="h-4 w-4 rounded"
                    />
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums text-gray-600 text-xs">
                    {locked ? "—" : hDay.toFixed(0) + " h"}
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums text-gray-600 text-xs">
                    {locked ? "—" : hMonth.toFixed(0) + " h"}
                  </td>
                  <td className="px-3 py-2">
                    <Button
                      size="sm"
                      variant={isDirty ? "default" : "outline"}
                      className="h-7 text-xs px-2"
                      disabled={saving === m.id}
                      onClick={() => save(m)}
                    >
                      {saving === m.id ? "…" : isDirty ? "Save" : "✓"}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {loading && machines.length === 0 && (
        <div className="text-sm text-muted-foreground">Loading machines…</div>
      )}
      {machines.length > 0 && (
        <>
          {renderPool(pipeMachines, `PIPE (${pipeMachines.length} machines)`)}
          {renderPool(mouldMachines, `MOULDING (${mouldMachines.length} machines)`)}
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </>
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
            <CardTitle className="text-base">Workbook ID Configuration</CardTitle>
            <p className="text-xs text-gray-500 mt-1">
              Configure the Google Spreadsheet IDs for PTMT and Plumbing daily-production workbooks.
              DB entries take priority over built-in fallbacks. Paste the spreadsheet ID from the URL
              (the long string after <code>/d/</code>).
            </p>
          </CardHeader>
          <CardContent>
            <WorkbookConfigPanel />
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

        {segment === "Plumbing" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Machine Capacity — Plumbing Pipe &amp; Moulding</CardTitle>
              <p className="text-xs text-gray-500 mt-1">
                9 PIPE machines + 24 MOULDING machines seeded with kg/hr rates.
                AGRI Pipe → flex machines only (MC3/MC4/MC5). Solvent items are unconstrained.
                Edit shifts/hours below; changes take effect on the next plan build.
              </p>
            </CardHeader>
            <CardContent>
              <MachineCapacityPanel />
            </CardContent>
          </Card>
        )}

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

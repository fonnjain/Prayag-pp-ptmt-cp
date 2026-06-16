import { useData } from "@/lib/data-provider";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// "15 Jun 2026"
function fmtDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// "16 Jun 2026, 10:56 am"
function fmtDateTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  let h = d.getHours();
  const ampm = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${fmtDate(iso)}, ${h}:${m} ${ampm}`;
}

export function SnapshotStatus() {
  const { importBatches } = useData();
  const lastSync = importBatches[0]?.createdAt;
  const isLive = Boolean(lastSync);

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 px-4 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium">Company snapshot</span>
        {isLive ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 px-2.5 py-0.5 text-xs font-medium text-green-700">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
            Live · as of {fmtDate(lastSync)}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
            No data yet
          </span>
        )}
      </div>

      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
        <span>
          Auto-sync on
          {isLive && <> · last synced {fmtDateTime(lastSync)}</>}
        </span>
      </div>
    </div>
  );
}

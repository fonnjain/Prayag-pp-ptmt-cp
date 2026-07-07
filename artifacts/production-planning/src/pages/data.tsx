import { useRef, useState } from "react";
import {
  useListBufferCategories,
  useUpdateBufferCategory,
  useListUploads,
  useCreateUpload,
  useGetSyncStatus,
  useSyncSheets,
  UploadKind,
  type SyncSource,
  type UploadedFile,
  type BufferCategory,
} from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn, fmtDateTime } from "@/lib/utils";

const UPLOAD_KINDS: { kind: (typeof UploadKind)[keyof typeof UploadKind]; label: string; hint: string }[] = [
  {
    kind: UploadKind.pending_orders,
    label: "Current Pending Order",
    hint: "Item Code · Colour · Qty (current open pending order, Cat-no keyed)",
  },
  {
    kind: UploadKind.last_month_pending,
    label: "Last Month Pending Order",
    hint: "Item Code · Colour · Qty (previous month's pending snapshot)",
  },
  {
    kind: UploadKind.current_stock,
    label: "Current Stock",
    hint: "Item Code · Colour · Qty (finished-goods stock as on the 1st of the month)",
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

function UploadRow({ kind, label, hint }: (typeof UPLOAD_KINDS)[number]) {
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
        <p className="font-medium text-sm">{label}</p>
        <p className="text-xs text-gray-500">{hint}</p>
        {latest ? (
          <p className="text-xs text-gray-600 mt-1">
            Latest: {latest.filename} — {latest.rowCount} rows —{" "}
            {fmtDateTime(latest.uploadedAt)}
          </p>
        ) : (
          <p className="text-xs text-amber-600 mt-1">No file uploaded yet</p>
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
          {createUpload.isPending ? "Uploading..." : "Upload file"}
        </Button>
      </div>
    </div>
  );
}

function BufferMultiplierTable() {
  const { data, isLoading } = useListBufferCategories();
  const updateCategory = useUpdateBufferCategory();
  const { toast } = useToast();
  const [drafts, setDrafts] = useState<Record<number, string>>({});

  if (isLoading) return <p className="text-sm text-gray-500">Loading categories...</p>;

  const categories = (data as unknown as BufferCategory[] | undefined) ?? [];

  return (
    <div className="space-y-2">
      {categories.map((cat) => {
        const draft = drafts[cat.id] ?? String(cat.multiplier);
        return (
          <div key={cat.id} className="flex items-center justify-between gap-4 py-2 border-b last:border-b-0">
            <span className="text-sm font-medium">{cat.name}</span>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                step="0.1"
                min="0"
                value={draft}
                onChange={(e) => setDrafts((d) => ({ ...d, [cat.id]: e.target.value }))}
                className="w-24 h-8"
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={updateCategory.isPending || Number(draft) === cat.multiplier}
                onClick={() => {
                  const multiplier = Number(draft);
                  if (Number.isNaN(multiplier) || multiplier < 0) return;
                  updateCategory.mutate(
                    { id: cat.id, data: { multiplier } },
                    {
                      onSuccess: () =>
                        toast({ title: "Multiplier updated", description: `${cat.name} → ${multiplier}` }),
                      onError: () =>
                        toast({ title: "Update failed", variant: "destructive" }),
                    },
                  );
                }}
              >
                Save
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function GoogleSheetsStatus() {
  const { data, isLoading, refetch } = useGetSyncStatus();
  const syncSheets = useSyncSheets();
  const { toast } = useToast();

  const sources = (data as unknown as SyncSource[] | undefined) ?? [];

  return (
    <div className="space-y-3">
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
          {syncSheets.isPending ? "Syncing..." : "Sync now"}
        </Button>
      </div>
      {isLoading && <p className="text-sm text-gray-500">Loading sync status...</p>}
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

export default function DataPage() {
  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h2 className="text-xl font-semibold">Data</h2>
          <p className="text-sm text-gray-500">
            Upload the monthly snapshots, connect live Google Sheets sources, and set buffer-stock
            multipliers per category.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Monthly snapshot uploads</CardTitle>
          </CardHeader>
          <CardContent>
            {UPLOAD_KINDS.map((u) => (
              <UploadRow key={u.kind} {...u} />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Google Sheets connection status</CardTitle>
          </CardHeader>
          <CardContent>
            <GoogleSheetsStatus />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Buffer-stock multipliers (months of average sale)</CardTitle>
          </CardHeader>
          <CardContent>
            <BufferMultiplierTable />
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}

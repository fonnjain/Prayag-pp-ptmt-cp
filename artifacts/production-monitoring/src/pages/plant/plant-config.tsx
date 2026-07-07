import { useState } from "react";
import { useGetPlantConfig, getGetPlantConfigQueryKey, type PlantConfigData } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings, RefreshCw, Plus, Save } from "lucide-react";
import { toast } from "@/hooks/use-toast";

export default function PlantConfig({ month }: { month: string }) {
  const { data, isLoading, refetch } = useGetPlantConfig(
    { month },
    { query: { queryKey: getGetPlantConfigQueryKey({ month }) } }
  );
  const cfg = data ? (data as unknown as PlantConfigData) : undefined;
  const [workingDays, setWorkingDays] = useState<string>("");
  const [snapshotDate, setSnapshotDate] = useState<string>("");
  const [newMonth, setNewMonth] = useState("");
  const [newFileId, setNewFileId] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [invalidating, setInvalidating] = useState(false);

  if (isLoading) return <div className="flex items-center justify-center h-64 text-muted-foreground">Loading...</div>;
  if (!cfg) return <div className="text-red-500 p-4">Failed to load plant config.</div>;

  const effectiveWorkingDays = workingDays !== "" ? Number(workingDays) : cfg.workingDays;
  const effectiveSnapshot = snapshotDate !== "" ? snapshotDate : (cfg.snapshotDate ?? "");

  async function saveConfig() {
    setSaving(true);
    try {
      const res = await fetch("/api/plant/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month,
          workingDays: effectiveWorkingDays,
          snapshotDate: effectiveSnapshot || null,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      toast({ title: "Config saved" });
      refetch();
      setWorkingDays("");
      setSnapshotDate("");
    } catch {
      toast({ title: "Failed to save config", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function addSourceConfig() {
    if (!newMonth || !newFileId) { toast({ title: "Month and File ID required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/plant/source-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: newMonth, fileId: newFileId, notes: newNotes || undefined }),
      });
      if (!res.ok) throw new Error("Save failed");
      toast({ title: "Source config saved" });
      refetch();
      setNewMonth(""); setNewFileId(""); setNewNotes("");
    } catch {
      toast({ title: "Failed to save source config", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function invalidateCache() {
    setInvalidating(true);
    try {
      const res = await fetch("/api/plant/cache/invalidate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month }),
      });
      if (!res.ok) throw new Error("Invalidation failed");
      toast({ title: `Cache cleared for ${month}` });
    } catch {
      toast({ title: "Failed to clear cache", variant: "destructive" });
    } finally {
      setInvalidating(false);
    }
  }

  return (
    <div className="space-y-6 max-w-[900px] mx-auto pb-10">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight mb-1 flex items-center gap-2">
          <Settings className="h-7 w-7 text-primary" /> Plant Config
        </h1>
        <p className="text-muted-foreground text-sm">Calendar settings, snapshot date, and historical master file IDs</p>
      </header>

      {/* Calendar config */}
      <Card>
        <CardHeader>
          <CardTitle>Calendar Settings — {month}</CardTitle>
          <CardDescription>Working days and snapshot date for KPI computation</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="wd">Working Days in Month</Label>
              <Input id="wd" type="number" min={1} max={31} placeholder={String(cfg.workingDays)}
                value={workingDays} onChange={(e) => setWorkingDays(e.target.value)} />
              <div className="text-xs text-muted-foreground">Current: {cfg.workingDays}</div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="snap">Snapshot Date (YYYY-MM-DD)</Label>
              <Input id="snap" type="date" placeholder={cfg.snapshotDate ?? "leave blank for auto"}
                value={snapshotDate} onChange={(e) => setSnapshotDate(e.target.value)} />
              <div className="text-xs text-muted-foreground">Current: {cfg.snapshotDate ?? "auto (last data date)"}</div>
            </div>
          </div>
          <Button onClick={saveConfig} disabled={saving} className="gap-2">
            <Save className="h-4 w-4" /> {saving ? "Saving…" : "Save Config"}
          </Button>
        </CardContent>
      </Card>

      {/* Cache */}
      <Card>
        <CardHeader>
          <CardTitle>Ingestion Cache</CardTitle>
          <CardDescription>PTMT ANUJ Production data is cached for 15 minutes. Clear to force a fresh pull.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={invalidateCache} disabled={invalidating} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${invalidating ? "animate-spin" : ""}`} />
            {invalidating ? "Clearing…" : `Clear cache for ${month}`}
          </Button>
        </CardContent>
      </Card>

      {/* Source configs */}
      <Card>
        <CardHeader>
          <CardTitle>Historical Master File IDs</CardTitle>
          <CardDescription>For months before the current one, specify the monthly master workbook Google Sheets file ID (for SUMMARY tab plan targets).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {cfg.sourceConfigs.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 text-muted-foreground">
                    <th className="text-left py-2 pr-4 font-medium">Month</th>
                    <th className="text-left py-2 pr-4 font-medium">File ID</th>
                    <th className="text-left py-2 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {cfg.sourceConfigs.map((sc) => (
                    <tr key={sc.month} className="border-b border-border/20">
                      <td className="py-1.5 pr-4 font-mono text-xs">{sc.month}</td>
                      <td className="py-1.5 pr-4 font-mono text-xs text-muted-foreground truncate max-w-xs">{sc.fileId}</td>
                      <td className="py-1.5 text-xs text-muted-foreground">{sc.notes ?? "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="border-t border-border/50 pt-4 space-y-3">
            <div className="text-sm font-medium">Add / Update Source Config</div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="nm">Month (YYYY-MM)</Label>
                <Input id="nm" placeholder="2026-04" value={newMonth} onChange={(e) => setNewMonth(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nf">Google Sheets File ID</Label>
                <Input id="nf" placeholder="1A3B..." value={newFileId} onChange={(e) => setNewFileId(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nn">Notes (optional)</Label>
                <Input id="nn" placeholder="Apr 2026 master" value={newNotes} onChange={(e) => setNewNotes(e.target.value)} />
              </div>
            </div>
            <Button variant="outline" onClick={addSourceConfig} disabled={saving} className="gap-2">
              <Plus className="h-4 w-4" /> {saving ? "Saving…" : "Save Source Config"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

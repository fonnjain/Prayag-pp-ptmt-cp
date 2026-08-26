import { useState, useEffect, useRef } from "react";
import { 
  useListItemWeights, 
  useUpsertItemWeight,
  useListIdealHoursOverrides,
  useUpsertIdealHoursOverride,
  useGetMonitoringThresholds,
  useUpdateMonitoringThresholds,
  useGetMonitoringConfig,
  useUpdateMonitoringConfig,
  useListApiKeys,
  useCreateApiKey,
  useDeleteApiKey,
  useRegenerateApiKey,
  getGetMonitoringThresholdsQueryKey,
  getGetMonitoringConfigQueryKey,
  getListApiKeysQueryKey,
  type ItemWeight,
  type IdealHoursOverride,
  type MonitoringConfig,
  type WarningThresholds,
  type ApiKey,
  type CreateApiKeyRequest,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { Copy, KeyRound, Trash2, RefreshCw, Plus, AlertTriangle, Check } from "lucide-react";

export default function Settings({ month }: { month: string }) {
  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Settings</h1>
        <p className="text-muted-foreground">Manage administrative configurations and overrides.</p>
      </header>

      <Tabs defaultValue="api-keys" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="api-keys">API Keys</TabsTrigger>
          <TabsTrigger value="weights">Item Weights</TabsTrigger>
          <TabsTrigger value="overrides">Ideal Hours Overrides</TabsTrigger>
          <TabsTrigger value="config">Monitoring Config</TabsTrigger>
          <TabsTrigger value="thresholds">Warning Thresholds</TabsTrigger>
        </TabsList>

        <TabsContent value="api-keys" className="space-y-4">
          <ApiKeysTab />
        </TabsContent>

        <TabsContent value="weights" className="space-y-4">
          <ItemWeightsTab />
        </TabsContent>

        <TabsContent value="overrides" className="space-y-4">
          <IdealHoursTab month={month} />
        </TabsContent>

        <TabsContent value="config" className="space-y-4">
          <MonitoringConfigTab month={month} />
        </TabsContent>

        <TabsContent value="thresholds" className="space-y-4">
          <ThresholdsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ApiKeysTab() {
  const queryClient = useQueryClient();
  const { data: keysRaw, isLoading } = useListApiKeys({ query: { queryKey: getListApiKeysQueryKey() } });
  const keys = (keysRaw as unknown as ApiKey[]) ?? [];

  const createKey = useCreateApiKey();
  const deleteKey = useDeleteApiKey();
  const regenerateKey = useRegenerateApiKey();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [consumer, setConsumer] = useState<"machine-analysis" | "mis" | "legacy">("machine-analysis");
  const [segmentScopes, setSegmentScopes] = useState<"PTMT" | "Plumbing" | "both">("both");

  const [revealedKey, setRevealedKey] = useState<{ key: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ApiKey | null>(null);
  const [regenTarget, setRegenTarget] = useState<ApiKey | null>(null);

  function copyKey(k: string) {
    navigator.clipboard.writeText(k);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    createKey.mutate(
      { data: {
        name: name.trim(),
        description: description.trim() || undefined,
        consumer,
        scopes: ["read"],
        segmentScopes: segmentScopes === "both" ? ["PTMT", "Plumbing"] : [segmentScopes],
      } satisfies CreateApiKeyRequest },
      {
        onSuccess: (res) => {
          const r = res as unknown as ApiKey & { key: string };
          setRevealedKey({ key: r.key, name: r.name });
          setName(""); setDescription("");
          queryClient.invalidateQueries({ queryKey: getListApiKeysQueryKey() });
        },
        onError: () => toast({ title: "Failed to create key", variant: "destructive" }),
      }
    );
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    deleteKey.mutate(
      { id: deleteTarget.id },
      {
        onSuccess: () => {
          toast({ title: `Key "${deleteTarget.name}" deleted` });
          setDeleteTarget(null);
          queryClient.invalidateQueries({ queryKey: getListApiKeysQueryKey() });
        },
        onError: () => toast({ title: "Failed to delete key", variant: "destructive" }),
      }
    );
  }

  function confirmRegenerate() {
    if (!regenTarget) return;
    regenerateKey.mutate(
      { id: regenTarget.id },
      {
        onSuccess: (res) => {
          const r = res as unknown as ApiKey & { key: string };
          setRevealedKey({ key: r.key, name: r.name });
          setRegenTarget(null);
          queryClient.invalidateQueries({ queryKey: getListApiKeysQueryKey() });
        },
        onError: () => toast({ title: "Failed to regenerate key", variant: "destructive" }),
      }
    );
  }

  function fmtDate(s: string | null | undefined) {
    if (!s) return "Never";
    return new Date(s).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  return (
    <>
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" /> API Key Management
          </CardTitle>
          <CardDescription>
            Issue scoped read-only keys for machine analysis and MIS consumers.
            Use <code className="text-xs bg-muted px-1 py-0.5 rounded">Authorization: Bearer &lt;key&gt;</code> in request headers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">

          {/* Create form */}
          <form onSubmit={handleCreate} className="bg-muted/30 rounded-lg border border-border/50 p-4 space-y-3">
            <div className="text-sm font-medium">Issue New Key</div>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
              <div className="space-y-1.5">
                <Label htmlFor="kname">Label <span className="text-red-500">*</span></Label>
                <Input id="kname" placeholder="e.g. prayag-plant.com" value={name} onChange={e => setName(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="kdesc">Description (optional)</Label>
                <Input id="kdesc" placeholder="Machine data ingestion" value={description} onChange={e => setDescription(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="kconsumer">Consumer</Label>
                <select id="kconsumer" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={consumer} onChange={e => setConsumer(e.target.value as typeof consumer)}>
                  <option value="machine-analysis">Machine analysis</option>
                  <option value="mis">MIS</option>
                  <option value="legacy">Legacy</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="kscope">Segment scope</Label>
                <select id="kscope" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={segmentScopes} onChange={e => setSegmentScopes(e.target.value as typeof segmentScopes)}>
                  <option value="both">PTMT + Plumbing</option>
                  <option value="PTMT">PTMT only</option>
                  <option value="Plumbing">Plumbing only</option>
                </select>
              </div>
              <Button type="submit" disabled={createKey.isPending || !name.trim()} className="gap-2">
                <Plus className="h-4 w-4" /> {createKey.isPending ? "Generating…" : "Generate Key"}
              </Button>
            </div>
          </form>

          {/* Keys table */}
          {isLoading ? (
            <div className="text-muted-foreground text-sm py-4">Loading keys…</div>
          ) : keys.length === 0 ? (
            <div className="text-center text-muted-foreground py-10 border border-dashed border-border/50 rounded-lg">
              <KeyRound className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <div className="text-sm">No API keys yet. Generate one above.</div>
            </div>
          ) : (
            <div className="border border-border/50 rounded-lg overflow-hidden">
              <Table>
                <TableHeader className="bg-muted/30">
                  <TableRow>
                    <TableHead>Label</TableHead>
                    <TableHead>Key Prefix</TableHead>
                    <TableHead>Consumer / Scope</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Last Used</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keys.map((k) => (
                    <TableRow key={k.id}>
                      <TableCell>
                        <div className="font-medium">{k.name}</div>
                        {k.description && <div className="text-xs text-muted-foreground">{k.description}</div>}
                      </TableCell>
                      <TableCell>
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{k.keyPrefix}…</code>
                      </TableCell>
                      <TableCell>
                        <div className="text-xs font-medium">{k.consumer ?? "legacy"}</div>
                        <div className="text-xs text-muted-foreground">{(k.segmentScopes ?? ["PTMT", "Plumbing"]).join(" · ")}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={k.isActive ? "default" : "secondary"} className={k.isActive ? "bg-emerald-500/15 text-emerald-700 border-emerald-500/30" : ""}>
                          {k.isActive ? "Active" : "Revoked"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{fmtDate(k.createdAt)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{fmtDate(k.lastUsedAt)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button size="sm" variant="outline" className="gap-1.5 text-xs h-7" onClick={() => setRegenTarget(k)}>
                            <RefreshCw className="h-3 w-3" /> Regenerate
                          </Button>
                          <Button size="sm" variant="outline" className="gap-1.5 text-xs h-7 text-red-500 hover:text-red-600 hover:border-red-300" onClick={() => setDeleteTarget(k)}>
                            <Trash2 className="h-3 w-3" /> Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Revealed key modal */}
      <Dialog open={!!revealedKey} onOpenChange={(open) => { if (!open) setRevealedKey(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" /> Your API Key
            </DialogTitle>
            <DialogDescription>
              Copy this key now — it will <strong>never be shown again</strong>. Store it securely.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">Key for: <span className="font-medium text-foreground">{revealedKey?.name}</span></div>
            <div className="flex items-center gap-2 bg-muted rounded-lg p-3">
              <code className="flex-1 text-xs font-mono break-all select-all">{revealedKey?.key}</code>
              <Button size="sm" variant="outline" onClick={() => revealedKey && copyKey(revealedKey.key)} className="shrink-0 gap-1.5">
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <div className="text-xs text-muted-foreground bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded p-3">
              Use this key as: <code className="font-mono">Authorization: Bearer {revealedKey?.key?.slice(0, 20)}…</code>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setRevealedKey(null)}>Done — I've saved the key</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation modal */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" /> Delete API Key
            </DialogTitle>
            <DialogDescription>
              This permanently revokes access for <strong>"{deleteTarget?.name}"</strong>. Any system using this key will stop working immediately.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleteKey.isPending}>
              {deleteKey.isPending ? "Deleting…" : "Delete Key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Regenerate confirmation modal */}
      <Dialog open={!!regenTarget} onOpenChange={(open) => { if (!open) setRegenTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-amber-500" /> Regenerate API Key
            </DialogTitle>
            <DialogDescription>
              This issues a <strong>new secret</strong> for <strong>"{regenTarget?.name}"</strong>. The old key stops working <strong>immediately</strong> — update your integration before regenerating.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRegenTarget(null)}>Cancel</Button>
            <Button onClick={confirmRegenerate} disabled={regenerateKey.isPending} className="gap-2">
              <RefreshCw className={`h-4 w-4 ${regenerateKey.isPending ? "animate-spin" : ""}`} />
              {regenerateKey.isPending ? "Regenerating…" : "Regenerate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ItemWeightsTab() {
  const { data: weightsRaw, refetch } = useListItemWeights();
  const weights = weightsRaw as unknown as ItemWeight[] | undefined;
  const upsertWeight = useUpsertItemWeight();
  
  const [itemCode, setItemCode] = useState("");
  const [colour, setColour] = useState("");
  const [weightKg, setWeightKg] = useState("");

  const handleUpsert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemCode || !colour) return;
    
    upsertWeight.mutate(
      { data: { itemCode, colour, weightKg: weightKg ? parseFloat(weightKg) : null } },
      {
        onSuccess: () => {
          toast({ title: "Item weight saved", description: `${itemCode} (${colour}) updated.` });
          refetch();
          setItemCode("");
          setColour("");
          setWeightKg("");
        },
        onError: () => {
          toast({ title: "Failed to save item weight", variant: "destructive" });
        }
      }
    );
  };

  return (
    <Card className="border-border/50">
      <CardHeader>
        <CardTitle>Item Weights</CardTitle>
        <CardDescription>Weights are required to convert pieces into kg targets for pace calculations.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form onSubmit={handleUpsert} className="grid grid-cols-4 gap-4 items-end bg-muted/30 p-4 rounded-lg border border-border/50">
          <div className="space-y-2">
            <Label htmlFor="itemCode">Item Code</Label>
            <Input id="itemCode" value={itemCode} onChange={e => setItemCode(e.target.value)} required placeholder="e.g. PTMT-01" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="colour">Colour</Label>
            <Input id="colour" value={colour} onChange={e => setColour(e.target.value)} required placeholder="e.g. PTMT" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="weightKg">Weight (kg)</Label>
            <Input id="weightKg" type="number" step="0.0001" value={weightKg} onChange={e => setWeightKg(e.target.value)} placeholder="0.05" />
          </div>
          <Button type="submit" disabled={upsertWeight.isPending}>
            {upsertWeight.isPending ? "Saving..." : "Add / Update"}
          </Button>
        </form>

        <div className="border border-border/50 rounded-lg overflow-hidden">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead>Item Code</TableHead>
                <TableHead>Colour</TableHead>
                <TableHead className="text-right">Weight (kg)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(weights || []).map((w: any) => (
                <TableRow key={w.id}>
                  <TableCell className="font-medium">{w.itemCode}</TableCell>
                  <TableCell>{w.colour}</TableCell>
                  <TableCell className="text-right font-mono">{w.weightKg || "Not set"}</TableCell>
                </TableRow>
              ))}
              {(!weights || weights.length === 0) && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                    No weights configured yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function IdealHoursTab({ month }: { month: string }) {
  const { data: overridesRaw, refetch } = useListIdealHoursOverrides({ month });
  const overrides = overridesRaw as unknown as IdealHoursOverride[] | undefined;
  const upsertOverride = useUpsertIdealHoursOverride();
  
  const [machineId, setMachineId] = useState("");
  const [hours, setHours] = useState("");

  const handleUpsert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!machineId || !hours) return;
    
    upsertOverride.mutate(
      { data: { machineId, month, hours: parseFloat(hours) } },
      {
        onSuccess: () => {
          toast({ title: "Override saved", description: `${machineId} updated for ${month}.` });
          refetch();
          setMachineId("");
          setHours("");
        },
        onError: () => {
          toast({ title: "Failed to save override", variant: "destructive" });
        }
      }
    );
  };

  return (
    <Card className="border-border/50">
      <CardHeader>
        <CardTitle>Ideal Hours Overrides</CardTitle>
        <CardDescription>Override the standard calculated ideal hours for a specific machine in {month}.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form onSubmit={handleUpsert} className="grid grid-cols-3 gap-4 items-end bg-muted/30 p-4 rounded-lg border border-border/50">
          <div className="space-y-2">
            <Label htmlFor="machineId">Machine ID</Label>
            <Input id="machineId" value={machineId} onChange={e => setMachineId(e.target.value)} required placeholder="e.g. M-01" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="hours">Ideal Hours</Label>
            <Input id="hours" type="number" step="0.1" value={hours} onChange={e => setHours(e.target.value)} required placeholder="720" />
          </div>
          <Button type="submit" disabled={upsertOverride.isPending}>
            {upsertOverride.isPending ? "Saving..." : "Save Override"}
          </Button>
        </form>

        <div className="border border-border/50 rounded-lg overflow-hidden">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead>Machine ID</TableHead>
                <TableHead className="text-right">Ideal Hours</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(overrides || []).map((o: any) => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">{o.machineId}</TableCell>
                  <TableCell className="text-right font-mono">{o.hours}</TableCell>
                </TableRow>
              ))}
              {(!overrides || overrides.length === 0) && (
                <TableRow>
                  <TableCell colSpan={2} className="text-center text-muted-foreground py-8">
                    No overrides set for {month}.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function MonitoringConfigTab({ month }: { month: string }) {
  const queryClient = useQueryClient();
  const { data: configRaw, isLoading } = useGetMonitoringConfig(
    { month },
    { query: { queryKey: getGetMonitoringConfigQueryKey({ month }) } }
  );
  const config = configRaw as unknown as MonitoringConfig | undefined;
  const updateConfig = useUpdateMonitoringConfig();

  const [workingDays, setWorkingDays] = useState("26");
  const [shiftsPerDay, setShiftsPerDay] = useState("2");
  const [shiftHours, setShiftHours] = useState("12");
  const [snapshotDate, setSnapshotDate] = useState("");

  const initializedForId = useRef<string | null>(null);

  useEffect(() => {
    if (config && initializedForId.current !== month) {
      initializedForId.current = month;
      setWorkingDays(config.workingDays?.toString() ?? "26");
      setShiftsPerDay(config.shiftsPerDay?.toString() ?? "2");
      setShiftHours(config.shiftHours?.toString() ?? "12");
      setSnapshotDate(config.snapshotDate ?? "");
    }
  }, [config, month]);

  // Reset initialization when month changes so we pick up the new month's config
  useEffect(() => {
    initializedForId.current = null;
  }, [month]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateConfig.mutate(
      { 
        data: { 
          month, 
          workingDays: parseInt(workingDays),
          shiftsPerDay: parseInt(shiftsPerDay),
          shiftHours: parseFloat(shiftHours),
          snapshotDate: snapshotDate || null
        } 
      },
      {
        onSuccess: (data) => {
          toast({ title: "Configuration saved" });
          queryClient.setQueryData(getGetMonitoringConfigQueryKey({ month }), data);
        },
        onError: () => {
          toast({ title: "Failed to save configuration", variant: "destructive" });
        }
      }
    );
  };

  if (isLoading) return <div className="p-4">Loading config...</div>;

  return (
    <Card className="border-border/50">
      <CardHeader>
        <CardTitle>Monthly Configuration for {month}</CardTitle>
        <CardDescription>Adjust baseline parameters for calculations in this specific month.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6 max-w-md">
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="workingDays">Working Days in Month</Label>
              <Input id="workingDays" type="number" value={workingDays} onChange={e => setWorkingDays(e.target.value)} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="shiftsPerDay">Shifts Per Day</Label>
              <Input id="shiftsPerDay" type="number" value={shiftsPerDay} onChange={e => setShiftsPerDay(e.target.value)} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="shiftHours">Shift Hours</Label>
              <Input id="shiftHours" type="number" step="0.5" value={shiftHours} onChange={e => setShiftHours(e.target.value)} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="snapshotDate">Snapshot Date Override (Optional)</Label>
              <Input id="snapshotDate" type="date" value={snapshotDate} onChange={e => setSnapshotDate(e.target.value)} />
              <p className="text-xs text-muted-foreground">Forces calculations to behave as if this is the current date.</p>
            </div>
          </div>
          <Button type="submit" disabled={updateConfig.isPending}>
            {updateConfig.isPending ? "Saving..." : "Save Configuration"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function ThresholdsTab() {
  const queryClient = useQueryClient();
  const { data: thresholdsRaw, isLoading } = useGetMonitoringThresholds(
    { query: { queryKey: getGetMonitoringThresholdsQueryKey() } }
  );
  const thresholds = thresholdsRaw as unknown as WarningThresholds | undefined;
  const updateThresholds = useUpdateMonitoringThresholds();

  const [form, setForm] = useState<Partial<WarningThresholds>>({});
  const initialized = useRef(false);

  useEffect(() => {
    if (thresholds && !initialized.current) {
      initialized.current = true;
      setForm(thresholds);
    }
  }, [thresholds]);

  const handleChange = (key: keyof WarningThresholds, value: string) => {
    setForm((prev: Partial<WarningThresholds>) => ({ ...prev, [key]: parseFloat(value) || 0 }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateThresholds.mutate(
      { data: form as WarningThresholds },
      {
        onSuccess: (data) => {
          toast({ title: "Thresholds saved" });
          queryClient.setQueryData(getGetMonitoringThresholdsQueryKey(), data);
        },
        onError: () => {
          toast({ title: "Failed to save thresholds", variant: "destructive" });
        }
      }
    );
  };

  if (isLoading) return <div className="p-4">Loading thresholds...</div>;

  return (
    <Card className="border-border/50">
      <CardHeader>
        <CardTitle>Global Warning Thresholds</CardTitle>
        <CardDescription>Configure the values that trigger info, medium, high, and critical warnings across all months.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
            
            <div className="space-y-4">
              <h3 className="font-semibold border-b pb-2">Pace & Catch-Up</h3>
              <div className="grid grid-cols-[2fr_1fr] items-center gap-4">
                <Label>Behind Pace (High) %</Label>
                <Input type="number" step="0.1" value={form.behindPaceHigh || ""} onChange={e => handleChange('behindPaceHigh', e.target.value)} />
              </div>
              <div className="grid grid-cols-[2fr_1fr] items-center gap-4">
                <Label>Behind Pace (Critical) %</Label>
                <Input type="number" step="0.1" value={form.behindPaceCritical || ""} onChange={e => handleChange('behindPaceCritical', e.target.value)} />
              </div>
              <div className="grid grid-cols-[2fr_1fr] items-center gap-4">
                <Label>Catch-up Infeasible Ratio</Label>
                <Input type="number" step="0.1" value={form.catchupInfeasibleRatio || ""} onChange={e => handleChange('catchupInfeasibleRatio', e.target.value)} />
                <p className="col-span-2 text-xs text-muted-foreground mt-[-10px]">Multiplier of required-per-day that implies an unrealistic daily target.</p>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="font-semibold border-b pb-2">Inventory & Backlog</h3>
              <div className="grid grid-cols-[2fr_1fr] items-center gap-4">
                <Label>Stockout Days Cover (Min)</Label>
                <Input type="number" step="0.1" value={form.stockoutDaysCover || ""} onChange={e => handleChange('stockoutDaysCover', e.target.value)} />
              </div>
              <div className="grid grid-cols-[2fr_1fr] items-center gap-4">
                <Label>Backlog Aged Days (Critical)</Label>
                <Input type="number" step="1" value={form.backlogAgedDays || ""} onChange={e => handleChange('backlogAgedDays', e.target.value)} />
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="font-semibold border-b pb-2">Machine Quality</h3>
              <div className="grid grid-cols-[2fr_1fr] items-center gap-4">
                <Label>Low Utilisation (Warning) %</Label>
                <Input type="number" step="0.1" value={form.lowUtilisation || ""} onChange={e => handleChange('lowUtilisation', e.target.value)} />
              </div>
              <div className="grid grid-cols-[2fr_1fr] items-center gap-4">
                <Label>High Rejection (High) %</Label>
                <Input type="number" step="0.1" value={form.highRejectionHigh || ""} onChange={e => handleChange('highRejectionHigh', e.target.value)} />
              </div>
              <div className="grid grid-cols-[2fr_1fr] items-center gap-4">
                <Label>High Rejection (Critical) %</Label>
                <Input type="number" step="0.1" value={form.highRejectionCritical || ""} onChange={e => handleChange('highRejectionCritical', e.target.value)} />
              </div>
              <div className="grid grid-cols-[2fr_1fr] items-center gap-4">
                <Label>No Production (Days)</Label>
                <Input type="number" step="1" value={form.noProductionDays || ""} onChange={e => handleChange('noProductionDays', e.target.value)} />
              </div>
            </div>

          </div>
          
          <div className="pt-4 border-t border-border/50">
            <Button type="submit" disabled={updateThresholds.isPending}>
              {updateThresholds.isPending ? "Saving..." : "Save All Thresholds"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

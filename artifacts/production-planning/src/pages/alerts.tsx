import { useMemo, useState } from "react";
import {
  useAcknowledgeAlert,
  useGetAlerts,
  useGetAlertsHistory,
  useMuteAlert,
  useUpdateAlertThreshold,
  useResetAlertThreshold,
  type Alert,
  type AlertState,
  type AlertsResponse,
  type AlertThreshold,
} from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/app-layout";
import { useSegment } from "@/contexts/segment-context";
import { useMonth } from "@workspace/month-filter";
import { formatMonthLabel } from "@/lib/month";
import { MonthEmptyState } from "@/components/month-empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle, BellRing, CheckCircle2, Clock3, EyeOff, Loader2, RotateCcw, Settings2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";

type AlertView = Alert & { state: AlertState };

function asPayload(data: unknown): AlertsResponse | undefined {
  return data as AlertsResponse | undefined;
}

function stateLabel(state: AlertState): string {
  return state === "clear" ? "Green" : state[0].toUpperCase() + state.slice(1);
}

function stateClass(state: AlertState): string {
  if (state === "fired") return "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300";
  if (state === "muted") return "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300";
  if (state === "suppressed") return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300";
  return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300";
}

function formatNumber(value: number | null | undefined): string {
  return value == null ? "—" : value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : "—";
}

function AlertCard({ alert, onAcknowledge, onMute }: { alert: AlertView; onAcknowledge: (alert: AlertView) => void; onMute: (alert: AlertView) => void }) {
  const detailEntries = Object.entries(alert.details ?? {}).filter(([, value]) => typeof value !== "object");
  return (
    <Card className={cn("border-l-4", alert.state === "fired" ? "border-l-red-500" : alert.state === "suppressed" ? "border-l-amber-500" : alert.state === "muted" ? "border-l-slate-400" : "border-l-emerald-500")}>
      <CardContent className="p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="font-mono">{alert.code}</Badge>
              <Badge variant="outline" className={stateClass(alert.state)}>{stateLabel(alert.state)}</Badge>
              {alert.acknowledgedAt && <Badge variant="secondary">Acknowledged</Badge>}
            </div>
            <h3 className="text-base font-semibold">{alert.title}</h3>
            <p className="text-sm text-muted-foreground">{alert.message}</p>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
              <span>Value: <strong className="text-foreground">{formatNumber(alert.value)}</strong></span>
              <span>Threshold: <strong className="text-foreground">{formatNumber(alert.threshold)}</strong></span>
              <span>Difference: <strong className="text-foreground">{formatNumber(alert.difference)}</strong></span>
              <span>Quantity: <strong className="text-foreground">{formatNumber(alert.quantity)}</strong></span>
              <span>Started: <strong className="text-foreground">{formatDate(alert.firstSeenAt)}</strong></span>
            </div>
            {detailEntries.length > 0 && (
              <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {detailEntries.map(([key, value]) => <span key={key} className="mr-4"><span className="font-medium text-foreground">{key}:</span> {String(value)}</span>)}
              </div>
            )}
            <div className="flex flex-wrap gap-3 pt-1">
              {alert.sourceLinks.map((source) => <a key={`${alert.id}-${source.href}`} href={source.href} className="text-xs font-medium text-primary hover:underline">{source.label}</a>)}
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            {alert.state === "fired" && alert.id !== null && (
              <>
                <Button variant="outline" size="sm" onClick={() => onAcknowledge(alert)}><CheckCircle2 className="mr-1.5 h-4 w-4" />Acknowledge</Button>
                <Button variant="outline" size="sm" onClick={() => onMute(alert)}><VolumeX className="mr-1.5 h-4 w-4" />Mute</Button>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState({ label, suppressed = false }: { label: string; suppressed?: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-card/50 p-12 text-center">
      {suppressed ? <EyeOff className="mb-3 h-10 w-10 text-amber-500/60" /> : <CheckCircle2 className="mb-3 h-10 w-10 text-emerald-500/60" />}
      <p className="font-medium">{label}</p>
    </div>
  );
}

export default function AlertsPage() {
  const { segment } = useSegment();
  const { month, isMonthAvailable, isAvailableMonthsLoading } = useMonth();
  const { toast } = useToast();
  const alertsQuery = useGetAlerts({ month, segment }, { query: { staleTime: 30_000 } as any });
  const historyQuery = useGetAlertsHistory({ segment, limit: 100 }, { query: { staleTime: 30_000 } as any });
  const acknowledge = useAcknowledgeAlert();
  const mute = useMuteAlert();
  const updateThreshold = useUpdateAlertThreshold();
  const resetThreshold = useResetAlertThreshold();
  const [tab, setTab] = useState("active");
  const [muteAlert, setMuteAlert] = useState<AlertView | null>(null);
  const [muteReason, setMuteReason] = useState("");
  const [muteUntil, setMuteUntil] = useState("");
  const [threshold, setThreshold] = useState<AlertThreshold | null>(null);
  const [thresholdValue, setThresholdValue] = useState("");
  const [thresholdReason, setThresholdReason] = useState("");
  const payload = asPayload(alertsQuery.data);
  const alerts = (payload?.alerts ?? []) as AlertView[];
  const summary = payload?.summary;
  const active = useMemo(() => alerts.filter((alert) => alert.state === "fired"), [alerts]);
  const muted = useMemo(() => alerts.filter((alert) => alert.state === "muted"), [alerts]);
  const suppressed = useMemo(() => alerts.filter((alert) => alert.state === "suppressed"), [alerts]);
  const showMonthEmpty = !isAvailableMonthsLoading && !isMonthAvailable;

  function refresh() {
    void alertsQuery.refetch();
    void historyQuery.refetch();
  }

  function handleAcknowledge(alert: AlertView) {
    if (alert.id === null) return;
    acknowledge.mutate({ id: alert.id }, {
      onSuccess: () => { toast({ title: "Alert acknowledged" }); refresh(); },
      onError: () => toast({ title: "Could not acknowledge alert", variant: "destructive" }),
    });
  }

  function handleMute() {
    if (!muteAlert?.id || !muteReason.trim() || !muteUntil) return;
    mute.mutate({ id: muteAlert.id, data: { reason: muteReason.trim(), mutedUntil: new Date(muteUntil).toISOString() } }, {
      onSuccess: () => { setMuteAlert(null); setMuteReason(""); setMuteUntil(""); toast({ title: "Alert muted" }); refresh(); },
      onError: () => toast({ title: "Could not mute alert", variant: "destructive" }),
    });
  }

  function handleThresholdSave() {
    if (!threshold || !thresholdReason.trim() || !thresholdValue) return;
    updateThreshold.mutate({ code: threshold.code, data: { segment, value: Number(thresholdValue), reason: thresholdReason.trim() } }, {
      onSuccess: () => { setThreshold(null); setThresholdReason(""); toast({ title: "Threshold updated" }); refresh(); },
      onError: () => toast({ title: "Could not update threshold", variant: "destructive" }),
    });
  }

  function handleThresholdReset(item: AlertThreshold) {
    resetThreshold.mutate({ code: item.code, data: { segment } }, {
      onSuccess: () => { toast({ title: "Threshold reset to default" }); refresh(); },
      onError: () => toast({ title: "Could not reset threshold", variant: "destructive" }),
    });
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2"><BellRing className="h-5 w-5 text-primary" /><h1 className="text-2xl font-semibold tracking-tight">Alerts</h1></div>
            <p className="mt-1 text-sm text-muted-foreground">{formatMonthLabel(month)} · {segment} · transparent rules for the current operating month</p>
          </div>
          <Button variant="outline" onClick={refresh} disabled={alertsQuery.isFetching}><RotateCcw className={cn("mr-2 h-4 w-4", alertsQuery.isFetching && "animate-spin")} />Refresh evaluation</Button>
        </div>

        {showMonthEmpty ? (
          <MonthEmptyState segment={segment} />
        ) : alertsQuery.isError ? (
          <Card><CardContent className="flex items-center gap-3 p-6 text-sm text-destructive"><AlertCircle className="h-5 w-5" />The alert evaluation could not be loaded. Check the source status and try again.</CardContent></Card>
        ) : alertsQuery.isLoading ? (
          <Card><CardContent className="flex items-center gap-3 p-8 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />Evaluating source quality and production rules…</CardContent></Card>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {[
                ["Fired", summary?.fired ?? 0, "text-red-600"],
                ["Muted", summary?.muted ?? 0, "text-slate-600"],
                ["Suppressed", summary?.suppressed ?? 0, "text-amber-600"],
                ["Green", summary?.clear ?? 0, "text-emerald-600"],
                ["Quantity at stake", formatNumber(summary?.quantityAtStake), "text-foreground"],
              ].map(([label, value, color]) => <Card key={label}><CardContent className="p-4"><p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p><p className={cn("mt-1 text-2xl font-semibold", color)}>{value}</p></CardContent></Card>)}
            </div>
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="grid w-full grid-cols-5 lg:w-auto lg:grid-cols-none lg:inline-flex">
                <TabsTrigger value="active">Current ({active.length})</TabsTrigger>
                <TabsTrigger value="muted">Muted ({muted.length})</TabsTrigger>
                <TabsTrigger value="suppressed">Suppressed ({suppressed.length})</TabsTrigger>
                <TabsTrigger value="rules">Rules</TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
              </TabsList>
              <TabsContent value="active" className="mt-4 space-y-4">{active.length ? active.map((alert) => <AlertCard key={alert.code} alert={alert} onAcknowledge={handleAcknowledge} onMute={setMuteAlert} />) : <EmptyState label="No fired alerts for this segment and month." />}</TabsContent>
              <TabsContent value="muted" className="mt-4 space-y-4">{muted.length ? muted.map((alert) => <AlertCard key={alert.code} alert={alert} onAcknowledge={handleAcknowledge} onMute={setMuteAlert} />) : <EmptyState label="No alerts are currently muted." />}</TabsContent>
              <TabsContent value="suppressed" className="mt-4 space-y-4">{suppressed.length ? suppressed.map((alert) => <AlertCard key={alert.code} alert={alert} onAcknowledge={handleAcknowledge} onMute={setMuteAlert} />) : <EmptyState label="No rules are suppressed." suppressed />}</TabsContent>
              <TabsContent value="rules" className="mt-4">
                <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Settings2 className="h-4 w-4" />Thresholds for {segment}</CardTitle></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Rule</TableHead><TableHead>Meaning</TableHead><TableHead>Value</TableHead><TableHead>Observed</TableHead><TableHead>Would fire</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{(payload?.thresholds ?? []).map((item) => <TableRow key={item.code}><TableCell className="font-medium"><span className="mr-2 font-mono text-xs">{item.code}</span>{item.name}</TableCell><TableCell className="max-w-sm text-xs text-muted-foreground">{item.description}</TableCell><TableCell>{formatNumber(item.value)} {item.unit}</TableCell><TableCell className="text-xs text-muted-foreground">{formatNumber(item.observedMin)} – {formatNumber(item.observedMax)}</TableCell><TableCell>{item.wouldFireCount}</TableCell><TableCell className="text-right"><Button variant="ghost" size="sm" onClick={() => { setThreshold(item); setThresholdValue(String(item.value)); }}><Settings2 className="mr-1 h-4 w-4" />Edit</Button><Button variant="ghost" size="sm" onClick={() => handleThresholdReset(item)} disabled={resetThreshold.isPending}><RotateCcw className="mr-1 h-4 w-4" />Reset</Button></TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
              </TabsContent>
              <TabsContent value="history" className="mt-4">
                <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Clock3 className="h-4 w-4" />State changes and decisions</CardTitle></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>When</TableHead><TableHead>Rule</TableHead><TableHead>Action</TableHead><TableHead>State</TableHead><TableHead>Message</TableHead><TableHead>Actor</TableHead></TableRow></TableHeader><TableBody>{((historyQuery.data as unknown as { history?: Array<{ id: number; code: string; action: string; state: string; message: string; occurredAt: string; actor: string | null }> } | undefined)?.history ?? []).map((event) => <TableRow key={event.id}><TableCell className="whitespace-nowrap text-xs">{formatDate(event.occurredAt)}</TableCell><TableCell className="font-mono text-xs">{event.code}</TableCell><TableCell>{event.action}</TableCell><TableCell><Badge variant="outline" className={stateClass(event.state as AlertState)}>{stateLabel(event.state as AlertState)}</Badge></TableCell><TableCell className="max-w-md truncate text-xs">{event.message}</TableCell><TableCell className="text-xs text-muted-foreground">{event.actor ?? "system"}</TableCell></TableRow>)}</TableBody></Table>{!(historyQuery.data as unknown as { history?: unknown[] } | undefined)?.history?.length && <EmptyState label="No alert history has been recorded yet." />}</CardContent></Card>
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>

      <Dialog open={!!muteAlert} onOpenChange={(open) => !open && setMuteAlert(null)}>
        <DialogContent><DialogHeader><DialogTitle>Mute {muteAlert?.code}</DialogTitle><DialogDescription>Muting requires a reason and an expiry. The rule will be re-evaluated after the expiry.</DialogDescription></DialogHeader><div className="space-y-4 py-4"><Textarea placeholder="Why is this expected or being handled elsewhere?" value={muteReason} onChange={(event) => setMuteReason(event.target.value)} /><Input type="datetime-local" value={muteUntil} onChange={(event) => setMuteUntil(event.target.value)} /></div><DialogFooter><Button variant="outline" onClick={() => setMuteAlert(null)}>Cancel</Button><Button onClick={handleMute} disabled={!muteReason.trim() || !muteUntil || mute.isPending}>{mute.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Mute alert</Button></DialogFooter></DialogContent>
      </Dialog>
      <Dialog open={!!threshold} onOpenChange={(open) => !open && setThreshold(null)}>
        <DialogContent><DialogHeader><DialogTitle>Edit {threshold?.code} threshold</DialogTitle><DialogDescription>{threshold?.description} Changes are scoped to {segment} and recorded with your reason.</DialogDescription></DialogHeader><div className="space-y-4 py-4"><Input type="number" min="0" value={thresholdValue} onChange={(event) => setThresholdValue(event.target.value)} /><Textarea placeholder="Why should this threshold change?" value={thresholdReason} onChange={(event) => setThresholdReason(event.target.value)} /></div><DialogFooter><Button variant="outline" onClick={() => setThreshold(null)}>Cancel</Button><Button onClick={handleThresholdSave} disabled={!thresholdReason.trim() || !thresholdValue || updateThreshold.isPending}>{updateThreshold.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save threshold</Button></DialogFooter></DialogContent>
      </Dialog>
    </AppLayout>
  );
}
import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Download, Filter, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AuditUser {
  id: number;
  email: string;
  role: string;
}

interface AuditReport {
  filters: {
    userId: number | null;
    userEmail: string | null;
    startDate: string;
    endDate: string;
    timeZone: string;
  };
  totals: {
    sessions: number;
    activeSeconds: number;
    idleSeconds: number;
    pageViews: number;
    actions: number;
  };
  daily: Array<{
    date: string;
    userEmail: string;
    app: string;
    sessions: number;
    activeSeconds: number;
    idleSeconds: number;
    pageViews: number;
    actions: number;
  }>;
  pages: Array<{ app: string; route: string; count: number }>;
  actions: Array<{ app: string; name: string; count: number }>;
  timeline: Array<{
    id: number;
    userEmail: string;
    app: string;
    kind: string;
    name: string;
    route: string | null;
    occurredAt: string;
  }>;
}

function toDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function defaultRange(): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 29);
  return { startDate: toDateInput(start), endDate: toDateInput(end) };
}

function formatDuration(seconds: number): string {
  const totalMinutes = Math.floor(seconds / 60);
  return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
}

function formatEventTime(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

export function ActivityAuditPanel({ users }: { users: AuditUser[] }) {
  const defaults = useMemo(defaultRange, []);
  const [userId, setUserId] = useState("");
  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);
  const [report, setReport] = useState<AuditReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryString = () => {
    const params = new URLSearchParams({ startDate, endDate });
    if (userId) params.set("userId", userId);
    return params.toString();
  };

  const loadReport = async (
    requestedUserId = userId,
    requestedStartDate = startDate,
    requestedEndDate = endDate,
  ) => {
    setError(null);
    if (!requestedStartDate || !requestedEndDate) {
      setError("Choose both a start and end date.");
      return;
    }
    if (requestedEndDate < requestedStartDate) {
      setError("End date must be on or after the start date.");
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({
        startDate: requestedStartDate,
        endDate: requestedEndDate,
      });
      if (requestedUserId) params.set("userId", requestedUserId);
      const response = await fetch(`/api/auth/activity/report?${params.toString()}`, { credentials: "include" });
      const body = await response.json().catch(() => ({})) as AuditReport & { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Request failed (HTTP ${response.status})`);
      setReport(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load activity audit");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadReport(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => {
    const next = defaultRange();
    setUserId("");
    setStartDate(next.startDate);
    setEndDate(next.endDate);
    void loadReport("", next.startDate, next.endDate);
  };

  const downloadPdf = async () => {
    setPdfLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/auth/activity/report.pdf?${queryString()}`, { credentials: "include" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Failed to generate PDF");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `user-activity-${startDate}-to-${endDate}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to download PDF");
    } finally {
      setPdfLoading(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-lg border border-card-border bg-card">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Filter size={17} className="text-primary" />
            <h2 className="text-sm font-semibold">User Activity Audit</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Review account usage, page visits, active time, idle time, and named actions.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void downloadPdf()} disabled={pdfLoading || loading} className="gap-1.5 self-start">
          {pdfLoading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
          Download PDF
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 border-b border-border bg-muted/20 px-4 py-4 md:grid-cols-[1.4fr_1fr_1fr_auto_auto] md:items-end">
        <label className="space-y-1 text-xs font-medium">
          User
          <select
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-normal"
          >
            <option value="">All users</option>
            {users.map((user) => <option key={user.id} value={user.id}>{user.email}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs font-medium">
          Start date
          <span className="relative block">
            <CalendarDays size={14} className="pointer-events-none absolute left-3 top-2.5 text-muted-foreground" />
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-2 text-sm font-normal" />
          </span>
        </label>
        <label className="space-y-1 text-xs font-medium">
          End date
          <span className="relative block">
            <CalendarDays size={14} className="pointer-events-none absolute left-3 top-2.5 text-muted-foreground" />
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-2 text-sm font-normal" />
          </span>
        </label>
        <Button onClick={() => void loadReport()} disabled={loading} size="sm" className="gap-1.5">
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          Apply
        </Button>
        <Button variant="outline" onClick={reset} disabled={loading} size="sm">Reset</Button>
      </div>

      {error && <p className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}

      {loading && !report ? (
        <div className="px-4 py-10 text-center text-sm text-muted-foreground">Loading activity…</div>
      ) : report ? (
        <div className="space-y-5 p-4">
          <p className="text-xs text-muted-foreground">
            Showing <span className="font-medium text-foreground">{report.filters.userEmail ?? "all users"}</span> from{" "}
            <span className="font-medium text-foreground">{report.filters.startDate}</span> through{" "}
            <span className="font-medium text-foreground">{report.filters.endDate}</span> · {report.filters.timeZone}
          </p>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            {[
              ["Sessions", String(report.totals.sessions)],
              ["Active time", formatDuration(report.totals.activeSeconds)],
              ["Idle time", formatDuration(report.totals.idleSeconds)],
              ["Page views", String(report.totals.pageViews)],
              ["Named actions", String(report.totals.actions)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md border border-border bg-background px-3 py-2">
                <p className="text-[11px] text-muted-foreground">{label}</p>
                <p className="mt-1 text-lg font-semibold">{value}</p>
              </div>
            ))}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">Daily summary</h3>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="min-w-full text-xs">
                <thead className="bg-muted/30 text-left"><tr>
                  {["Date", "User", "App", "Sessions", "Active", "Idle", "Pages", "Actions"].map((heading) => <th key={heading} className="whitespace-nowrap px-3 py-2 font-medium text-muted-foreground">{heading}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-border/50">
                  {report.daily.map((row) => <tr key={`${row.date}-${row.userEmail}-${row.app}`}>
                    <td className="whitespace-nowrap px-3 py-2">{row.date}</td><td className="px-3 py-2">{row.userEmail}</td><td className="px-3 py-2">{row.app}</td><td className="px-3 py-2">{row.sessions}</td><td className="px-3 py-2">{formatDuration(row.activeSeconds)}</td><td className="px-3 py-2">{formatDuration(row.idleSeconds)}</td><td className="px-3 py-2">{row.pageViews}</td><td className="px-3 py-2">{row.actions}</td>
                  </tr>)}
                  {report.daily.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">No activity in this range.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-semibold">Most visited screens</h3>
              <div className="rounded-md border border-border">
                {report.pages.slice(0, 10).map((page) => <div key={`${page.app}-${page.route}`} className="flex items-center justify-between border-b border-border/50 px-3 py-2 text-xs last:border-0"><span className="truncate">{page.route}<span className="ml-2 text-muted-foreground">({page.app})</span></span><span className="font-semibold">{page.count}</span></div>)}
                {report.pages.length === 0 && <p className="px-3 py-6 text-center text-xs text-muted-foreground">No page views.</p>}
              </div>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold">Named actions</h3>
              <div className="rounded-md border border-border">
                {report.actions.slice(0, 10).map((action) => <div key={`${action.app}-${action.name}`} className="flex items-center justify-between border-b border-border/50 px-3 py-2 text-xs last:border-0"><span>{action.name}<span className="ml-2 text-muted-foreground">({action.app})</span></span><span className="font-semibold">{action.count}</span></div>)}
                {report.actions.length === 0 && <p className="px-3 py-6 text-center text-xs text-muted-foreground">No named actions.</p>}
              </div>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">Timeline</h3>
            <div className="max-h-[360px] overflow-auto rounded-md border border-border">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-muted/90 text-left"><tr>
                  {["Time", "User", "App", "Type", "Event", "Route"].map((heading) => <th key={heading} className="whitespace-nowrap px-3 py-2 font-medium text-muted-foreground">{heading}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-border/50">
                  {report.timeline.map((event) => <tr key={event.id}><td className="whitespace-nowrap px-3 py-2">{formatEventTime(event.occurredAt)}</td><td className="px-3 py-2">{event.userEmail}</td><td className="px-3 py-2">{event.app}</td><td className="px-3 py-2 capitalize">{event.kind}</td><td className="px-3 py-2">{event.name}</td><td className="max-w-[240px] truncate px-3 py-2">{event.route ?? "—"}</td></tr>)}
                  {report.timeline.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">No events in this range.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
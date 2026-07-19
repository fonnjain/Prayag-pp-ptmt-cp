import { Switch, Route, Router as WouterRouter, Link, useLocation } from "wouter";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { useState, useMemo, Fragment, useRef, useCallback, useEffect } from "react";
import {
  LayoutDashboard, ShoppingCart, Factory, TrendingUp, Database,
  RefreshCw, ChevronRight, AlertCircle, Loader2, Layers, ChevronDown, ChevronUp,
  ClipboardList, Download, KeyRound, Plus, Trash2, Copy, Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import SEED from "./data/seed.json";

// ─── Query Client ─────────────────────────────────────────────────────────────
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false, retry: 1 },
  },
});

// ─── Constants ────────────────────────────────────────────────────────────────
const AMBER = "hsl(38 90% 48%)";
const GREEN = "hsl(142 60% 42%)";
const BLUE = "hsl(217 85% 58%)";
const RED = "hsl(0 72% 54%)";
const PURPLE = "hsl(262 72% 58%)";
const CHART_COLORS = [AMBER, GREEN, BLUE, RED, PURPLE, "#f59e0b", "#10b981", "#3b82f6"];
const FISCAL_MONTHS = ["Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar"];
const FY_OPTIONS = ["2026-27","2025-26","2024-25","2023-24"];

// ─── Formatters ───────────────────────────────────────────────────────────────
function fmtCr(value: number): string {
  const cr = value / 1e7;
  if (cr >= 100) return `₹${cr.toFixed(0)} Cr`;
  if (cr >= 10)  return `₹${cr.toFixed(1)} Cr`;
  if (cr >= 1)   return `₹${cr.toFixed(2)} Cr`;
  const lakh = value / 1e5;
  if (lakh >= 1) return `₹${lakh.toFixed(1)} L`;
  return `₹${(value / 1000).toFixed(0)}K`;
}
function fmtQty(n: number | undefined | null): string {
  if (n == null || !isFinite(n)) return "—";
  if (n >= 1e5) return `${(n / 1e5).toFixed(1)}L`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}
function toCr(n: number): number { return parseFloat((n / 1e7).toFixed(2)); }

// ─── Heatmap color helper ──────────────────────────────────────────────────────
function heatColor(value: number, min: number, max: number): string {
  const t = max === min ? 0.5 : (value - min) / (max - min);
  // low = red (0°), mid = amber (38°), high = green (142°)
  const hue = t < 0.5
    ? 0 + (38 - 0) * (t / 0.5)
    : 38 + (142 - 38) * ((t - 0.5) / 0.5);
  const sat = 70;
  const lig = t < 0.5 ? 52 - 4 * t : 48 + 4 * (t - 0.5);
  return `hsl(${hue.toFixed(0)} ${sat}% ${lig.toFixed(0)}%)`;
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────
function CustomTooltip({ active, payload, label, formatter }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-card-border rounded-md px-3 py-2 text-xs shadow-md">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-medium text-foreground">
            {formatter ? formatter(p.value) : p.value?.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-card border border-card-border rounded-lg p-4">
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold mt-1" style={color ? { color } : undefined}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Loading / Error ──────────────────────────────────────────────────────────
function LoadingState({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center text-sm">
      <Loader2 size={16} className="animate-spin" />
      <span>{label ?? "Loading data from Google Sheets…"}</span>
    </div>
  );
}
function ErrorState({ message }: { message?: string }) {
  return (
    <div className="flex items-center gap-2 text-destructive py-12 justify-center text-sm">
      <AlertCircle size={16} />
      <span>{message ?? "Failed to load data."}</span>
    </div>
  );
}

// ─── Badges ───────────────────────────────────────────────────────────────────
function Badge({ label, variant }: { label: string; variant: "green" | "amber" | "red" | "blue" | "gray" }) {
  const cls = {
    green: "bg-green-100 text-green-800",
    amber: "bg-amber-100 text-amber-800",
    red:   "bg-red-100 text-red-800",
    blue:  "bg-blue-100 text-blue-800",
    gray:  "bg-gray-100 text-gray-700",
  }[variant];
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium", cls)}>
      {label}
    </span>
  );
}

function trendBadge(signal: string) {
  if (signal === "Growing")  return <Badge label="↑ Growing" variant="green" />;
  if (signal === "Declining") return <Badge label="↓ Declining" variant="red" />;
  return <Badge label="→ Stable" variant="gray" />;
}
function volBadge(cls: string) {
  if (cls === "High")   return <Badge label="High CV" variant="red" />;
  if (cls === "Medium") return <Badge label="Med CV" variant="amber" />;
  return <Badge label="Low CV" variant="blue" />;
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { href: "/",            label: "Overview",            icon: <LayoutDashboard size={15} /> },
  { href: "/management",  label: "Management Reports",  icon: <ClipboardList size={15} /> },
  { href: "/orders",      label: "Orders",              icon: <ShoppingCart size={15} /> },
  { href: "/production",  label: "Production",          icon: <Factory size={15} /> },
  { href: "/stock-buffer",label: "Stock Buffer",        icon: <Layers size={15} /> },
  { href: "/sales",       label: "Sales",               icon: <TrendingUp size={15} /> },
  { href: "/sources",     label: "Data Sources",        icon: <Database size={15} /> },
  { href: "/api-keys",    label: "API Keys",            icon: <KeyRound size={15} /> },
];

function SidebarLink({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) {
  const [location] = useLocation();
  const isActive = href === "/" ? location === "/" : location.startsWith(href);
  return (
    <Link href={href}>
      <span className={cn(
        "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm cursor-pointer transition-colors",
        isActive
          ? "bg-primary text-primary-foreground font-medium"
          : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      )}>
        <span className="shrink-0 opacity-70">{icon}</span>
        <span className="truncate">{label}</span>
        {isActive && <ChevronRight size={12} className="ml-auto shrink-0 opacity-60" />}
      </span>
    </Link>
  );
}

// ─── Cross-App Nav ────────────────────────────────────────────────────────────
function CrossAppNav() {
  const path = window.location.pathname;
  const isOps = path.startsWith("/ops-dashboard");
  const isMon = path.startsWith("/monitoring");
  const tabs = [
    { label: "Ops Dashboard",         href: "/ops-dashboard/", active: isOps },
    { label: "Production Monitoring", href: "/monitoring/",   active: isMon },
    { label: "Production Planning",   href: "/",              active: !isOps && !isMon },
  ];
  return (
    <nav className="fixed top-0 left-0 right-0 z-30 h-9 flex items-center px-4 gap-1 border-b border-sidebar-border bg-sidebar">
      <span className="text-[11px] font-bold mr-3" style={{ color: AMBER }}>prayag</span>
      {tabs.map((app) => (
        <a key={app.href} href={app.href}
          className={cn(
            "px-3 py-1 rounded text-xs font-medium transition-colors",
            app.active
              ? "bg-amber-500/10 text-amber-600 font-semibold"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          )}
        >{app.label}</a>
      ))}
    </nav>
  );
}

const SEG_OPTIONS: Array<"PTMT" | "Plumbing" | "Combined"> = ["PTMT", "Plumbing", "Combined"];

function Sidebar({ fy, setFy, seg, setSeg }: {
  fy: string; setFy: (v: string) => void;
  seg: "PTMT" | "Plumbing" | "Combined"; setSeg: (v: "PTMT" | "Plumbing" | "Combined") => void;
}) {
  return (
    <aside className="fixed top-9 left-0 bottom-0 z-20 flex w-56 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="px-5 pt-5 pb-4 border-b border-sidebar-border">
        <div className="text-[22px] font-bold tracking-tight leading-none" style={{ color: AMBER }}>prayag</div>
        <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">India Operations</div>
      </div>
      <div className="px-3 pt-3 pb-1 space-y-3">
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70 select-none block mb-1 px-1">
            Fiscal Year
          </label>
          <select
            value={fy}
            onChange={(e) => setFy(e.target.value)}
            className="w-full text-sm bg-background border border-border rounded-md px-2 py-1.5 text-foreground cursor-pointer"
          >
            {FY_OPTIONS.map((f) => <option key={f} value={f}>FY {f}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70 select-none block mb-1 px-1">
            Segment
          </label>
          <div className="flex flex-col gap-1">
            {SEG_OPTIONS.map((s) => (
              <button
                key={s}
                onClick={() => setSeg(s)}
                className={cn(
                  "w-full text-left px-2 py-1.5 rounded-md text-sm font-medium transition-colors",
                  seg === s
                    ? "bg-amber-500/15 text-amber-700 font-semibold"
                    : "text-sidebar-foreground hover:bg-sidebar-accent"
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {NAV_ITEMS.map((item) => <SidebarLink key={item.href} {...item} />)}
      </nav>
      <div className="px-4 py-3 border-t border-sidebar-border">
        <p className="text-[10px] text-muted-foreground/60 select-none">Live · Google Sheets</p>
      </div>
    </aside>
  );
}

// ─── Overview Page ────────────────────────────────────────────────────────────
const CAT_SHORT: Record<string, string> = {
  "Cocks Standard": "Std Cocks",
  "Cocks Premium": "Pre Cocks",
  "Faucets & Jetsprays & Shower": "Faucets",
  "Accessories": "Access.",
  "Cistern & Seat Cover": "Cistern",
  "Cabinet": "Cabinet",
  "Ball Cock": "Ball Ck",
};

function OverviewPage({ fy, seg }: { fy: string; seg: "PTMT" | "Plumbing" | "Combined" }) {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["ops-overview", fy],
    queryFn: async () => {
      const res = await fetch(`/api/ops/overview?fy=${fy}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });
  const { data: orders, isLoading: ordersLoading } = useQuery({
    queryKey: ["ops-orders", fy],
    queryFn: async () => {
      const res = await fetch(`/api/ops/orders?fy=${fy}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  // Current month for management summary + plan summary
  const currentMonth = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }, []);

  const { data: mgmtSummary, isLoading: mgmtLoading } = useQuery({
    queryKey: ["mgmt-summary", currentMonth],
    queryFn: async () => {
      const res = await fetch(`/api/ops/management-summary?month=${currentMonth}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
  });

  const { data: planPtmt } = useQuery({
    queryKey: ["plan-summary-ptmt", currentMonth],
    queryFn: async () => {
      const res = await fetch(`/api/plan/summary?month=${currentMonth}&segment=PTMT`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: seg === "PTMT" || seg === "Combined",
    staleTime: 5 * 60 * 1000,
  });

  const { data: planPlumbing } = useQuery({
    queryKey: ["plan-summary-plumbing", currentMonth],
    queryFn: async () => {
      const res = await fetch(`/api/plan/summary?month=${currentMonth}&segment=Plumbing`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: seg === "Plumbing" || seg === "Combined",
    staleTime: 5 * 60 * 1000,
  });

  // Human-readable current month name e.g. "Jul"
  const curMonName = useMemo(() => {
    const [y, m] = currentMonth.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleString("en-IN", { month: "short" });
  }, [currentMonth]);

  // Chart data derived from management summary
  const mgmtVolumeData = useMemo(() => {
    if (!mgmtSummary?.summary) return [];
    return mgmtSummary.summary.map((c: any) => ({
      cat: CAT_SHORT[c.name] ?? c.name,
      "E · Prior FY avg": Math.round(c.totalE / 1000),
      "H · Last 3Mo avg": Math.round(c.totalH / 1000),
      "I · Last month": Math.round(c.totalI / 1000),
      [`J · ${curMonName} (live)`]: Math.round((c.totalJ ?? 0) / 1000),
    }));
  }, [mgmtSummary, curMonName]);

  const mgmtSeasonData = useMemo(() => {
    if (!mgmtSummary?.summary) return [];
    return mgmtSummary.summary.map((c: any) => ({
      cat: CAT_SHORT[c.name] ?? c.name,
      "F · Peak months avg": Math.round(c.totalF / 1000),
      "G · Off-peak avg": Math.round(c.totalG / 1000),
      [`J · ${curMonName} (live)`]: Math.round((c.totalJ ?? 0) / 1000),
    }));
  }, [mgmtSummary, curMonName]);

  const trendData = useMemo(() => {
    if (!orders?.monthly) return [];
    return orders.monthly.map((m: any) => ({
      month: m.month,
      "Orders (₹ Cr)": toCr(m.value),
    }));
  }, [orders]);

  // PTMT combined trend from seed data
  const ptmtCombined = useMemo(() => {
    const { orders: o, plan: p, sales: s } = SEED.combined_ptmt_qty;
    const fys = ["2020-21","2021-22","2022-23","2023-24","2024-25","2025-26"];
    return fys.map((f) => ({
      fy: f,
      "Plan (L units)": p[f as keyof typeof p] ? parseFloat(((p[f as keyof typeof p] as number) / 1e5).toFixed(1)) : null,
      "Sales (L units)": s[f as keyof typeof s] ? parseFloat(((s[f as keyof typeof s] as number) / 1e5).toFixed(1)) : null,
      "Orders (L units)": (o as any)[f] ? parseFloat(((o as any)[f] / 1e5).toFixed(1)) : null,
    }));
  }, []);

  // Year-over-year order values from seed
  const orderYrData = useMemo(() => {
    return Object.entries(SEED.orders.year_value_cr).map(([fy, val]) => ({ fy, "Value (₹ Cr)": val }));
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Overview</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Prayag India · FY {fy}</p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-border rounded-md text-muted-foreground hover:bg-muted transition-colors"
        >
          <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Production Plan Summary — segment-scoped */}
      {(seg === "PTMT" || seg === "Plumbing") && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-foreground mb-3 uppercase tracking-wide">
            {seg} Production Plan · {currentMonth}
          </h2>
          {seg === "PTMT" && planPtmt && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard label="Max Plan" value={fmtQty(planPtmt.totalPcs)} sub="pieces" color={BLUE} />
              <KpiCard label="Min Required" value={fmtQty(planPtmt.totalMin)} sub="buffer floor" />
              <KpiCard label="Categories" value={String(planPtmt.categories.length)} />
              <KpiCard label="Min/Max Ratio" value={planPtmt.totalPcs > 0 ? `${Math.round(planPtmt.totalMin / planPtmt.totalPcs * 100)}%` : "—"} />
            </div>
          )}
          {seg === "Plumbing" && planPlumbing && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard label="Production Required" value={fmtQty(planPlumbing.totalPcs)} sub="pieces" color={BLUE} />
              <KpiCard label="Weight Required" value={fmtQty(planPlumbing.totalKg)} sub="kg" />
              <KpiCard label="Categories" value={String(planPlumbing.categories.length)} />
              <KpiCard label="Top Category" value={planPlumbing.categories[0]?.name ?? "—"} sub={fmtQty(planPlumbing.categories[0]?.pcs ?? 0) + " pcs"} />
            </div>
          )}
        </div>
      )}
      {seg === "Combined" && (planPtmt || planPlumbing) && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-foreground mb-3 uppercase tracking-wide">
            Production Plan · {currentMonth} · Both Segments
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {planPtmt && (
              <div className="bg-card border border-card-border rounded-lg p-4">
                <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wide">PTMT</p>
                <div className="grid grid-cols-2 gap-3">
                  <KpiCard label="Max Plan" value={fmtQty(planPtmt.totalPcs)} sub="pcs" color={BLUE} />
                  <KpiCard label="Min Required" value={fmtQty(planPtmt.totalMin)} sub="pcs" />
                </div>
              </div>
            )}
            {planPlumbing && (
              <div className="bg-card border border-card-border rounded-lg p-4">
                <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wide">Plumbing</p>
                <div className="grid grid-cols-2 gap-3">
                  <KpiCard label="Production Req." value={fmtQty(planPlumbing.totalPcs)} sub="pcs" color={GREEN} />
                  <KpiCard label="Weight Req." value={fmtQty(planPlumbing.totalKg)} sub="kg" />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* KPIs — live data gated, seed KPIs always show */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {isLoading || error ? (
          <>
            <KpiCard label="Order Value YTD" value="—" sub={`FY ${fy} · loading…`} color={AMBER} />
            <KpiCard label="Order Qty YTD" value="—" sub="Loading…" />
          </>
        ) : (
          <>
            <KpiCard label="Order Value YTD" value={fmtCr(data?.orderValue ?? 0)}
              sub={`FY ${fy} · ${fmtQty(data?.orderQty ?? 0)} units`} color={AMBER} />
            <KpiCard label="Order Qty YTD" value={fmtQty(data?.orderQty ?? 0)} sub="All product groups" />
          </>
        )}
        <KpiCard label="PTMT Sales (25-26)" value={fmtQty(SEED.sales_ptmt.fy_qty["2025-26"])}
          sub="Seed · 3-Yr Sale Master" color={GREEN} />
        <KpiCard label="PTMT Plan (25-26)" value={fmtQty(SEED.production_ptmt.fy_plan_units["2025-26"])}
          sub="Seed · daily production sheets" color={BLUE} />
      </div>

      {/* Management Report card — with live charts */}
      {(() => {
        const d = new Date();
        const mNum = d.getMonth() + 1;
        const yr = d.getFullYear();
        const curFyStart = mNum >= 4 ? yr : yr - 1;
        const priorFy = `${curFyStart - 1}-${String(curFyStart).slice(2)}`;
        const N = ((mNum - 4 + 12) % 12) + 1;
        const G = 12 - N;
        const FM = ["Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar"];
        const priorFyStart = curFyStart - 1;
        const labels = FM.map((name, i) => `${name}-${String(i <= 8 ? priorFyStart : priorFyStart + 1).slice(2)}`);
        const fEnd = labels[N - 1];
        const gStart = labels[N];
        const curMo = ["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][mNum === 1 ? 12 : mNum - 1];
        return (
          <div className="mb-6 bg-card border border-card-border rounded-lg p-5">
            {/* Header row */}
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <ClipboardList size={15} className="text-amber-500" />
                  <h3 className="text-sm font-semibold text-foreground">Management Reports · {d.toLocaleString("en-IN", { month: "long" })} {yr}</h3>
                </div>
                <p className="text-xs text-muted-foreground">Prior FY {priorFy} seasonality split for each item across 7 categories</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap justify-end">
                <a
                  href={`/api/plan/export/excel?month=${yr}-${String(mNum).padStart(2, "0")}`}
                  download={`planning-report-${yr}-${String(mNum).padStart(2, "0")}.xlsx`}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-green-600 text-white rounded-md font-medium hover:bg-green-700 transition-colors whitespace-nowrap"
                >
                  <Download size={12} />
                  Planning Report
                </a>
                <Link href="/management">
                  <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-amber-500 text-white rounded-md font-medium hover:bg-amber-600 transition-colors cursor-pointer whitespace-nowrap">
                    <ClipboardList size={12} />
                    View Report
                  </span>
                </Link>
              </div>
            </div>

            {/* Column legend pills */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs mb-5">
              <div className="bg-blue-50/60 border border-blue-100 rounded-md px-3 py-2">
                <div className="text-blue-600 font-semibold">F · {N} months</div>
                <div className="text-muted-foreground mt-0.5">Apr-{String(priorFyStart).slice(2)} – {fEnd}</div>
              </div>
              <div className="bg-purple-50/60 border border-purple-100 rounded-md px-3 py-2">
                <div className="text-purple-600 font-semibold">G · {G} months</div>
                <div className="text-muted-foreground mt-0.5">{gStart} – Mar-{String(curFyStart).slice(2)}</div>
              </div>
              <div className="bg-green-50/60 border border-green-100 rounded-md px-3 py-2">
                <div className="text-green-600 font-semibold">H · Last 3 Mo Avg</div>
                <div className="text-muted-foreground mt-0.5">Current FY rolling avg</div>
              </div>
              <div className="bg-muted/60 border border-border rounded-md px-3 py-2">
                <div className="text-foreground font-semibold">I · {curMo} Sale</div>
                <div className="text-muted-foreground mt-0.5">Last completed month</div>
              </div>
            </div>

            {/* Charts */}
            {mgmtLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-6 justify-center">
                <Loader2 size={14} className="animate-spin" />
                Loading analysis data…
              </div>
            ) : mgmtVolumeData.length > 0 ? (
              <div className="flex flex-col gap-6">
                {/* Chart 1 — Volume by Category (E / H / I) */}
                <div>
                  <div className="flex items-baseline gap-2 mb-1">
                    <p className="text-sm font-semibold text-foreground">Category Volume</p>
                    <span className="text-xs text-muted-foreground">· K units / month</span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">
                    Sum of avg monthly sale per unique code —&nbsp;
                    <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{background:AMBER}} /> <span className="font-medium text-foreground">E Prior FY avg</span></span>
                    &nbsp;·&nbsp;
                    <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{background:GREEN}} /> <span className="font-medium text-foreground">H Last 3Mo avg</span></span>
                    &nbsp;·&nbsp;
                    <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-slate-400" /> <span className="font-medium text-foreground">I Last month</span></span>
                    &nbsp;·&nbsp;
                    <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-teal-500" /> <span className="font-medium text-foreground">J {curMonName} live</span></span>
                  </p>
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={mgmtVolumeData} layout="vertical" margin={{ top: 4, right: 28, left: 4, bottom: 4 }} barCategoryGap="22%" barGap={2}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}K`} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="cat" tick={{ fontSize: 12, fontWeight: 500 }} width={80} axisLine={false} tickLine={false} />
                      <Tooltip
                        formatter={(v: number, name: string) => [`${v.toLocaleString()}K units`, name]}
                        contentStyle={{ fontSize: 12, borderRadius: 8 }}
                        cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                      />
                      <Bar dataKey="E · Prior FY avg" fill={AMBER} radius={[0,4,4,0]} maxBarSize={16} />
                      <Bar dataKey="H · Last 3Mo avg" fill={GREEN} radius={[0,4,4,0]} maxBarSize={16} />
                      <Bar dataKey="I · Last month" fill="#94a3b8" radius={[0,4,4,0]} maxBarSize={16} />
                      <Bar dataKey={`J · ${curMonName} (live)`} fill="#14b8a6" radius={[0,4,4,0]} maxBarSize={16} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="border-t border-border" />

                {/* Chart 2 — Seasonality: F (peak) vs G (off-peak) */}
                <div>
                  <div className="flex items-baseline gap-2 mb-1">
                    <p className="text-sm font-semibold text-foreground">Seasonality Split</p>
                    <span className="text-xs text-muted-foreground">· K units / month avg</span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">
                    Prior FY split —&nbsp;
                    <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{background:BLUE}} /> <span className="font-medium text-foreground">F first {N} months</span></span>
                    &nbsp;vs&nbsp;
                    <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{background:PURPLE}} /> <span className="font-medium text-foreground">G last {G} months</span></span>
                    &nbsp;·&nbsp;
                    <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-teal-500" /> <span className="font-medium text-foreground">J {curMonName} live</span></span>
                    &nbsp;— longer F bar = early-year peak
                  </p>
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={mgmtSeasonData} layout="vertical" margin={{ top: 4, right: 28, left: 4, bottom: 4 }} barCategoryGap="22%" barGap={2}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}K`} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="cat" tick={{ fontSize: 12, fontWeight: 500 }} width={80} axisLine={false} tickLine={false} />
                      <Tooltip
                        formatter={(v: number, name: string) => [`${v.toLocaleString()}K units`, name]}
                        contentStyle={{ fontSize: 12, borderRadius: 8 }}
                        cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                      />
                      <Bar dataKey="F · Peak months avg" fill={BLUE} radius={[0,4,4,0]} maxBarSize={16} />
                      <Bar dataKey="G · Off-peak avg" fill={PURPLE} radius={[0,4,4,0]} maxBarSize={16} />
                      <Bar dataKey={`J · ${curMonName} (live)`} fill="#14b8a6" radius={[0,4,4,0]} maxBarSize={16} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ) : null}
          </div>
        );
      })()}

      {data && (
        <>

          {/* PTMT Combined trend — the key insight */}
          <div className="bg-card border border-card-border rounded-lg p-5 mb-5">
            <h3 className="text-sm font-semibold text-foreground mb-1">
              PTMT: Orders vs Production Plan vs Sales · Units (L)
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              Key insight: <strong>Sales rising, plans cut to ~half of sales → planning lags demand</strong>
            </p>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={ptmtCombined} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="fy" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}L`} />
                <Tooltip content={<CustomTooltip formatter={(v: number) => `${v}L units`} />} />
                <Legend />
                <Line type="monotone" dataKey="Plan (L units)" stroke={BLUE} strokeWidth={2}
                  dot={{ r: 4 }} strokeDasharray="5 3" connectNulls />
                <Line type="monotone" dataKey="Sales (L units)" stroke={GREEN} strokeWidth={2.5}
                  dot={{ r: 4 }} connectNulls />
                <Line type="monotone" dataKey="Orders (L units)" stroke={AMBER} strokeWidth={2}
                  dot={{ r: 4 }} strokeDasharray="3 2" connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* 4-year order value summary from seed */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
            <div className="bg-card border border-card-border rounded-lg p-5">
              <h3 className="text-sm font-semibold text-foreground mb-4">Annual Order Value · ₹ Cr (Seed)</h3>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={orderYrData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="fy" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${v}Cr`} />
                  <Tooltip content={<CustomTooltip formatter={(v: number) => `₹${v} Cr`} />} />
                  <Bar dataKey="Value (₹ Cr)" fill={AMBER} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* This FY monthly trend (live) */}
            <div className="bg-card border border-card-border rounded-lg p-5">
              <h3 className="text-sm font-semibold text-foreground mb-4">Monthly Order Value · FY {fy} (Live)</h3>
              {ordersLoading ? <LoadingState label="Loading monthly…" /> : trendData.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No monthly data yet for FY {fy}</p>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <AreaChart data={trendData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="amberGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={AMBER} stopOpacity={0.25} />
                        <stop offset="95%" stopColor={AMBER} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${v}Cr`} />
                    <Tooltip content={<CustomTooltip formatter={(v: number) => `₹${v} Cr`} />} />
                    <Area type="monotone" dataKey="Orders (₹ Cr)" stroke={AMBER} fill="url(#amberGrad)"
                      strokeWidth={2} dot={{ r: 3 }} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Festival & Season Info */}
          <div className="bg-card border border-card-border rounded-lg p-5">
            <h3 className="text-sm font-semibold text-foreground mb-3">Festival & Season Calendar</h3>
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <p className="font-medium text-foreground mb-2">Festivals</p>
                <div className="space-y-1.5">
                  {data.festivals?.diwali?.map((f: any) => (
                    <div key={f.date} className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ background: AMBER }} />
                      <span className="text-muted-foreground">{f.label}</span>
                      <span className="text-foreground ml-auto">{f.date}</span>
                    </div>
                  ))}
                  {data.festivals?.holi?.slice(0, 3).map((f: any) => (
                    <div key={f.date} className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ background: PURPLE }} />
                      <span className="text-muted-foreground">{f.label}</span>
                      <span className="text-foreground ml-auto">{f.date}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="font-medium text-foreground mb-2">IMD Seasons</p>
                <div className="space-y-1.5">
                  {data.festivals?.seasons?.map((s: any) => (
                    <div key={s.name} className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-sm" style={{ background: s.color }} />
                      <span className="text-muted-foreground">{s.name}</span>
                      <span className="text-foreground ml-auto text-[10px]">
                        {s.months.map((m: number) => ["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m]).join(", ")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Management Reports Page ──────────────────────────────────────────────────
function defaultMgmtMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const MGMT_CATEGORIES = [
  "Cocks Standard","Cocks Premium","Faucets & Jetsprays & Shower",
  "Accessories","Cistern & Seat Cover","Cabinet","Ball Cock",
];

function fmtN(v: number) { return Math.round(v).toLocaleString("en-IN"); }

function ManagementReportsPage() {
  const [month, setMonth] = useState(defaultMgmtMonth);
  const [activeCategory, setActiveCategory] = useState(MGMT_CATEGORIES[0]);
  const [search, setSearch] = useState("");

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["mgmt-view", month],
    queryFn: async () => {
      const res = await fetch(`/api/ops/management-view?month=${month}`);
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error ?? "Failed"); }
      return res.json();
    },
    enabled: /^\d{4}-\d{2}$/.test(month),
    staleTime: 10 * 60 * 1000,
  });

  const catData = data?.categories?.find((c: any) => c.name === activeCategory);
  const filteredItems = useMemo(() => {
    const rows: any[] = catData?.items ?? [];
    if (!search.trim()) return rows;
    const q = search.trim().toUpperCase();
    return rows.filter((r: any) =>
      r.itemCode?.toUpperCase().includes(q) || r.colour?.toUpperCase().includes(q)
    );
  }, [catData, search]);

  const hdrs = data?.meta?.headers;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Management Reports</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Seasonality &amp; sales history · columns E–I per item
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">Planning Month</label>
            <input
              type="month"
              value={month}
              onChange={e => setMonth(e.target.value)}
              className="text-sm bg-background border border-border rounded-md px-2 py-1.5 text-foreground"
            />
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-border rounded-md text-muted-foreground hover:bg-muted transition-colors"
          >
            <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} />
            Refresh
          </button>
          <a
            href={`/api/plan/export/excel?month=${month}`}
            download={`planning-report-${month}.xlsx`}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md font-medium transition-colors bg-green-600 text-white hover:bg-green-700"
          >
            <Download size={12} />
            Planning Report
          </a>
          <a
            href={`/api/ops/management-view/excel?month=${month}`}
            download={`mgmt-view-${month}.xlsx`}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md font-medium transition-colors bg-amber-500 text-white hover:bg-amber-600"
          >
            <Download size={12} />
            Export Excel
          </a>
        </div>
      </div>

      {/* Meta banner */}
      {data?.meta && (
        <div className="mb-5 flex flex-wrap gap-3">
          {[
            { label: "Planning Month", value: month },
            { label: "Current FY", value: data.meta.currentFy },
            { label: "Prior FY (E/F/G)", value: data.meta.priorFy },
            { label: "N-Split", value: `N=${data.meta.N} → ${data.meta.N}/${12 - data.meta.N}` },
            { label: "Last Month (I)", value: data.meta.lastMonthName },
          ].map(({ label, value }) => (
            <div key={label} className="bg-card border border-card-border rounded-md px-3 py-2 text-xs">
              <span className="text-muted-foreground mr-1.5">{label}</span>
              <span className="font-semibold text-foreground">{value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Dynamic header legend */}
      {hdrs && (
        <div className="mb-5 bg-amber-50/50 border border-amber-200/60 rounded-lg p-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-amber-700/70 mb-2">Column Headers for {month}</p>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 text-xs">
            {(["E","F","G","H","I"] as const).map(col => (
              <div key={col}>
                <span className="font-bold text-foreground">{col}: </span>
                <span className="text-muted-foreground">{hdrs[col]}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Loading / Error */}
      {isLoading && (
        <div className="flex flex-col items-center py-20 gap-3">
          <Loader2 size={28} className="animate-spin text-amber-500" />
          <p className="text-sm text-muted-foreground">Loading management view — fetching sale sheets…</p>
          <p className="text-xs text-muted-foreground/60">First load may take 20–30 seconds (3 sheet reads)</p>
        </div>
      )}
      {error && !isLoading && (
        <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3 mb-5">
          <AlertCircle size={15} />
          {(error as Error).message}
        </div>
      )}

      {/* Category tabs + table */}
      {data && !isLoading && (
        <>
          {/* Category tab bar */}
          <div className="flex gap-1.5 flex-wrap mb-4">
            {MGMT_CATEGORIES.map(cat => {
              const catObj = data.categories?.find((c: any) => c.name === cat);
              const count = catObj?.items?.length ?? 0;
              return (
                <button
                  key={cat}
                  onClick={() => { setActiveCategory(cat); setSearch(""); }}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-xs font-medium transition-colors border",
                    activeCategory === cat
                      ? "bg-amber-500 text-white border-amber-500"
                      : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {cat} <span className={cn("ml-1 opacity-60", activeCategory === cat && "opacity-80")}>({count})</span>
                </button>
              );
            })}
          </div>

          {/* Search */}
          <div className="mb-3">
            <input
              type="text"
              placeholder="Filter by item code or colour…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="text-sm bg-background border border-border rounded-md px-3 py-1.5 w-full max-w-xs text-foreground placeholder:text-muted-foreground"
            />
          </div>

          {/* Table */}
          <div className="bg-card border border-card-border rounded-lg overflow-auto">
            <table className="w-full text-xs border-collapse min-w-[700px]">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left px-3 py-2 font-semibold text-foreground sticky left-0 bg-muted/40">Item Code</th>
                  <th className="text-left px-3 py-2 font-semibold text-foreground">Colour</th>
                  <th className="text-right px-3 py-2 font-semibold text-amber-700 whitespace-nowrap">
                    E · {hdrs?.E ?? "AVG SALE"}
                  </th>
                  <th className="text-right px-3 py-2 font-semibold text-blue-700 whitespace-nowrap">
                    F · {hdrs?.F ?? "N-Month"}
                  </th>
                  <th className="text-right px-3 py-2 font-semibold text-purple-700 whitespace-nowrap">
                    G · {hdrs?.G ?? "Rem Months"}
                  </th>
                  <th className="text-right px-3 py-2 font-semibold text-green-700 whitespace-nowrap">
                    H · Last 3Mo Avg
                  </th>
                  <th className="text-right px-3 py-2 font-semibold text-foreground whitespace-nowrap">
                    I · Last Month
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center text-muted-foreground py-10">
                      {search ? "No items match filter." : "No items in this category."}
                    </td>
                  </tr>
                ) : filteredItems.map((item: any, idx: number) => (
                  <tr key={`${item.itemCode}::${item.colour}::${idx}`}
                    className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-1.5 font-mono font-medium text-foreground sticky left-0 bg-card">{item.itemCode}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{item.colour || "—"}</td>
                    <td className="px-3 py-1.5 text-right text-amber-800">{fmtN(item.E)}</td>
                    <td className="px-3 py-1.5 text-right text-blue-800">{fmtN(item.F)}</td>
                    <td className="px-3 py-1.5 text-right text-purple-800">{fmtN(item.G)}</td>
                    <td className="px-3 py-1.5 text-right text-green-800 font-medium">{fmtN(item.H)}</td>
                    <td className="px-3 py-1.5 text-right font-semibold text-foreground">{fmtN(item.I)}</td>
                  </tr>
                ))}
              </tbody>
              {filteredItems.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/40 font-semibold">
                    <td className="px-3 py-1.5 sticky left-0 bg-muted/40">Total ({filteredItems.length})</td>
                    <td className="px-3 py-1.5" />
                    {(["E","F","G","H","I"] as const).map(col => (
                      <td key={col} className="px-3 py-1.5 text-right">
                        {fmtN(filteredItems.reduce((s: number, r: any) => s + (r[col] ?? 0), 0))}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            E/F/G = prior-FY averages · H = current-FY last-3-month avg · I = last month sale · all figures are monthly averages (not totals)
          </p>
        </>
      )}
    </div>
  );
}

// ─── Orders Page ──────────────────────────────────────────────────────────────
function OrdersPage({ fy, seg }: { fy: string; seg: "PTMT" | "Plumbing" | "Combined" }) {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["ops-orders", fy],
    queryFn: async () => {
      const res = await fetch(`/api/ops/orders?fy=${fy}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });
  const { data: yoy, isLoading: yoyLoading } = useQuery({
    queryKey: ["ops-orders-yoy"],
    queryFn: async () => {
      const res = await fetch(`/api/ops/orders/yoy`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const monthlyData = useMemo(() => {
    if (!data?.monthly) return [];
    return data.monthly.map((m: any) => ({
      month: m.month,
      "Value (₹ Cr)": toCr(m.value),
      "Qty (K)": parseFloat((m.qty / 1000).toFixed(1)),
    }));
  }, [data]);

  const yoyData = useMemo(() => {
    if (!yoy) return [];
    return yoy.map((row: any) => {
      const out: any = { month: row.month };
      for (const fy of ["2023-24","2024-25","2025-26","2026-27"]) {
        if (row[fy]) out[fy] = toCr(row[fy]);
      }
      return out;
    });
  }, [yoy]);

  // Seed channel data for FY context
  const seedChannels = useMemo(() => {
    const channelCr = SEED.orders.channel_cr as Record<string, Record<string, number>>;
    const fyData = channelCr[fy] ?? {};
    return Object.entries(fyData).map(([name, value]) => ({ name, value }));
  }, [fy]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Orders Received</h1>
          <p className="text-sm text-muted-foreground mt-0.5">FY {fy} · Live from Google Sheets</p>
        </div>
        <button onClick={() => refetch()} disabled={isFetching}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-border rounded-md text-muted-foreground hover:bg-muted transition-colors">
          <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {(seg === "Plumbing" || seg === "Combined") && (
        <div className="mb-5 flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2.5">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          <span>Orders data comes from the PTMT Order Sheet (Google Sheets). Plumbing orders are tracked separately and not yet in this view.</span>
        </div>
      )}

      {isLoading && <LoadingState />}
      {error && <ErrorState message="Could not load order data. The sheet may require Google Sheets access." />}

      {data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <KpiCard label="YTD Order Value" value={fmtCr(data.ytdValue)} color={AMBER} />
            <KpiCard label="YTD Quantity" value={fmtQty(data.ytdQty)} />
            <KpiCard label="Documents" value={data.ytdDocs?.toLocaleString() ?? "—"} sub="Unique orders" />
            <KpiCard label="Customers" value={data.ytdCustomers?.toLocaleString() ?? "—"} sub="Unique customers" />
          </div>

          {/* Monthly Value */}
          <div className="bg-card border border-card-border rounded-lg p-5 mb-5">
            <h3 className="text-sm font-semibold text-foreground mb-4">Monthly Order Value · ₹ Cr</h3>
            {monthlyData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No monthly data yet for FY {fy}</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={monthlyData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${v}Cr`} />
                  <Tooltip content={<CustomTooltip formatter={(v: number) => `₹${v} Cr`} />} />
                  <Bar dataKey="Value (₹ Cr)" fill={AMBER} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
            {/* By Group */}
            <div className="bg-card border border-card-border rounded-lg p-5">
              <h3 className="text-sm font-semibold text-foreground mb-4">Order Value by Product Group</h3>
              {!data.byGroup?.length ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No data</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.byGroup.slice(0, 8).map((g: any) => ({ ...g, value: toCr(g.value) }))}
                    layout="vertical" margin={{ top: 0, right: 16, left: 60, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `₹${v}Cr`} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={60} />
                    <Tooltip content={<CustomTooltip formatter={(v: number) => `₹${v} Cr`} />} />
                    <Bar dataKey="value" name="Value (₹ Cr)" fill={GREEN} radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Channel — live if available, seed as fallback */}
            <div className="bg-card border border-card-border rounded-lg p-5">
              <h3 className="text-sm font-semibold text-foreground mb-1">Channel Split</h3>
              <p className="text-xs text-muted-foreground mb-3">{data.byChannel?.length ? "Live" : "Seed data"}</p>
              {(() => {
                const channels = data.byChannel?.length
                  ? data.byChannel.map((c: any) => ({ ...c, value: toCr(c.value) }))
                  : seedChannels;
                return (
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={channels} dataKey="value" nameKey="name" cx="50%" cy="50%"
                        innerRadius={50} outerRadius={85} paddingAngle={3}
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        labelLine={false}>
                        {channels.map((_: any, i: number) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v: number) => `₹${v} Cr`} />
                    </PieChart>
                  </ResponsiveContainer>
                );
              })()}
            </div>
          </div>

          {/* Top Plants */}
          {data.byPlant?.length > 0 && (
            <div className="bg-card border border-card-border rounded-lg p-5 mb-5">
              <h3 className="text-sm font-semibold text-foreground mb-4">Top Plants / Locations</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.byPlant.slice(0, 8).map((p: any) => ({ ...p, value: toCr(p.value) }))}
                  layout="vertical" margin={{ top: 0, right: 16, left: 80, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `₹${v}Cr`} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={80} />
                  <Tooltip content={<CustomTooltip formatter={(v: number) => `₹${v} Cr`} />} />
                  <Bar dataKey="value" name="Value (₹ Cr)" fill={BLUE} radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}

      {/* YoY Comparison */}
      <div className="bg-card border border-card-border rounded-lg p-5">
        <h3 className="text-sm font-semibold text-foreground mb-1">Year-over-Year Order Value · ₹ Cr</h3>
        <p className="text-xs text-muted-foreground mb-4">Same-month comparison across all 4 fiscal years</p>
        {yoyLoading ? <LoadingState label="Loading YoY data (reads all 4 sheets)…" /> :
          !yoyData.length ? <p className="text-sm text-muted-foreground py-6 text-center">No YoY data available</p> : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={yoyData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${v}Cr`} />
                <Tooltip content={<CustomTooltip formatter={(v: number) => `₹${v} Cr`} />} />
                <Legend />
                {["2023-24","2024-25","2025-26","2026-27"].map((fyKey, i) => (
                  <Bar key={fyKey} dataKey={fyKey} fill={CHART_COLORS[i]} radius={[2, 2, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )
        }
      </div>
    </div>
  );
}

// ─── Production Page ──────────────────────────────────────────────────────────
function ProductionPage({ seg }: { seg: "PTMT" | "Plumbing" | "Combined" }) {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["ops-production"],
    queryFn: async () => {
      const res = await fetch(`/api/ops/production`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const currentMonth = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }, []);

  const { data: plumbingPlan } = useQuery({
    queryKey: ["plan-summary-plumbing-prod", currentMonth],
    queryFn: async () => {
      const res = await fetch(`/api/plan/summary?month=${currentMonth}&segment=Plumbing`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: seg === "Plumbing" || seg === "Combined",
    staleTime: 5 * 60 * 1000,
  });

  const CATEGORIES = [
    "Cocks Standard","Cocks Premium","Faucets & Jetsprays",
    "Accessorise","Cistern & Seat Cover","Cabinet","Ball Cock",
  ];

  // FY-level chart from seed data
  const fyPlanData = useMemo(() => {
    return Object.entries(SEED.production_ptmt.fy_plan_units).map(([fy, units]) => ({
      fy, "Plan (L units)": parseFloat((units / 1e5).toFixed(1)),
    }));
  }, []);

  const categoryData = useMemo(() => {
    const catFy = SEED.production_ptmt.category_fy as Record<string, Record<string, number>>;
    const fys = ["2023-24","2024-25","2025-26"];
    return fys.map((fy) => {
      const row: any = { fy };
      const data = catFy[fy] ?? {};
      for (const [k, v] of Object.entries(data)) {
        row[k] = Math.round(v / 1000);
      }
      return row;
    });
  }, []);

  const stackedData = useMemo(() => {
    if (!data) return [];
    return data.map((m: any) => {
      const row: any = { label: m.label };
      for (const cat of CATEGORIES) row[cat] = m.byCategory[cat] ?? 0;
      row.total = m.total;
      return row;
    });
  }, [data]);

  const totalMonths = data?.length ?? 0;
  const avgMonthly = data ? Math.round(data.reduce((s: number, m: any) => s + m.total, 0) / Math.max(totalMonths, 1)) : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Production Planning</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {seg === "Plumbing" ? "Plumbing" : seg === "Combined" ? "PTMT + Plumbing" : "PTMT"} · Annual plan trend + live monthly breakdown
          </p>
        </div>
        <button onClick={() => refetch()} disabled={isFetching}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-border rounded-md text-muted-foreground hover:bg-muted transition-colors">
          <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Plumbing plan summary — shown when Plumbing or Combined */}
      {(seg === "Plumbing" || seg === "Combined") && plumbingPlan && (
        <div className="bg-card border border-card-border rounded-lg p-5 mb-6">
          <h3 className="text-sm font-semibold text-foreground mb-1">
            Plumbing Production Plan · {currentMonth}
          </h3>
          <p className="text-xs text-muted-foreground mb-4">
            {plumbingPlan.categories.length} categories · {fmtQty(plumbingPlan.totalPcs)} pcs · {fmtQty(plumbingPlan.totalKg)} kg
          </p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <KpiCard label="Total Required" value={fmtQty(plumbingPlan.totalPcs)} sub="pieces" color={GREEN} />
            <KpiCard label="Total Weight" value={fmtQty(plumbingPlan.totalKg)} sub="kg" />
            <KpiCard label="Categories" value={String(plumbingPlan.categories.length)} />
            <KpiCard label="Top Category" value={plumbingPlan.categories[0]?.name ?? "—"} sub={fmtQty(plumbingPlan.categories[0]?.pcs ?? 0) + " pcs"} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  {["Category", "Pieces", "Kg"].map((h) => (
                    <th key={h} className={`text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground ${h !== "Category" ? "text-right" : ""}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plumbingPlan.categories.map((c: any) => (
                  <tr key={c.name} className="border-b border-border/50 hover:bg-muted/20">
                    <td className="px-3 py-1.5 font-medium text-foreground">{c.name}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-foreground">{c.pcs.toLocaleString("en-IN")}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{c.kg > 0 ? c.kg.toLocaleString("en-IN") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* FY-level KPIs from seed */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Plan 2023-24" value={fmtQty(SEED.production_ptmt.fy_plan_units["2023-24"])}
          sub="7.1M units planned" color={AMBER} />
        <KpiCard label="Plan 2024-25" value={fmtQty(SEED.production_ptmt.fy_plan_units["2024-25"])}
          sub="4.9M — sharp cut" />
        <KpiCard label="Plan 2025-26" value={fmtQty(SEED.production_ptmt.fy_plan_units["2025-26"])}
          sub="4.2M — still declining" />
        <KpiCard label="Sales 2025-26" value={fmtQty(SEED.sales_ptmt.fy_qty["2025-26"])}
          sub="7.5M — plan is ~55% of sales" color={RED} />
      </div>

      {/* 6-year FY plan trend */}
      <div className="bg-card border border-card-border rounded-lg p-5 mb-5">
        <h3 className="text-sm font-semibold text-foreground mb-1">PTMT Annual Plan · 6 Years (Seed)</h3>
        <p className="text-xs text-muted-foreground mb-4">Production plan peaked in 2022-23 at 7.7M, now declining despite rising sales</p>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={fyPlanData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="fy" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}L`} />
            <Tooltip content={<CustomTooltip formatter={(v: number) => `${v}L units`} />} />
            <Bar dataKey="Plan (L units)" fill={BLUE} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Category breakdown 3 years */}
      <div className="bg-card border border-card-border rounded-lg p-5 mb-5">
        <h3 className="text-sm font-semibold text-foreground mb-1">By Category · 3 Years (units K)</h3>
        <p className="text-xs text-muted-foreground mb-4">Cocks Standard dominates; all categories declining since 2023-24</p>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={categoryData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="fy" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}K`} />
            <Tooltip content={<CustomTooltip formatter={(v: number) => `${v.toLocaleString()}K units`} />} />
            <Legend />
            {["Cocks Standard","Ball Cock","Faucets & Jetsprays","Cistern & Seat Cover","Accessorise","Cabinet"].map((cat, i) => (
              <Bar key={cat} dataKey={cat} stackId="a" fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Live monthly data */}
      {isLoading && <LoadingState label="Reading PTMT production sheets (rate-limited, may take ~30s)…" />}
      {error && <ErrorState message="Could not load live production data from PTMT sheets." />}

      {data && stackedData.length > 0 && (
        <div className="bg-card border border-card-border rounded-lg p-5">
          <h3 className="text-sm font-semibold text-foreground mb-1">Monthly PTMT Plan · Live (Stacked by Category)</h3>
          <p className="text-xs text-muted-foreground mb-4">
            {totalMonths} months · avg {fmtQty(avgMonthly)} units/month
          </p>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={stackedData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtQty(v)} />
              <Tooltip content={<CustomTooltip formatter={(v: number) => fmtQty(v)} />} />
              <Legend />
              {CATEGORIES.map((cat, i) => (
                <Bar key={cat} dataKey={cat} stackId="a" fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ─── Stock Buffer Engine ─────────────────────────────────────────────────────

interface BufferCategory {
  id: number;
  name: string;
  segment: string;
  multiplier: number;
  updatedAt: string;
  suggestedMultiplier: number | null;
  overrideMultiplier: number | null;
  cvValue: number | null;
  volatilityClass: string | null;
  avgMonth: number | null;
  peakMonth: string | null;
  peakIndex: number | null;
  yoy: number | null;
  signal: string | null;
  seasonalIndices: string | null;
  dataQuality: string | null;
  zScore: number | null;
  reliabilityFlag: string | null;
  lastComputedAt: string | null;
}

const Z_LEVELS = [
  { label: "90%", z: 1.28 },
  { label: "95%", z: 1.65 },
  { label: "98%", z: 2.05 },
];

function reliabilityBadge(flag: string | null) {
  if (!flag) return <span className="text-[10px] text-emerald-600 font-medium">✓ Clean</span>;
  if (flag.includes("insufficient"))
    return <span className="text-[10px] bg-red-100 text-red-700 font-medium px-1.5 py-0.5 rounded" title={flag}>No data</span>;
  if (flag.includes("unreliable"))
    return <span className="text-[10px] bg-orange-100 text-orange-700 font-medium px-1.5 py-0.5 rounded" title={flag}>⚠ Unreliable</span>;
  if (flag.includes("thin"))
    return <span className="text-[10px] bg-amber-100 text-amber-700 font-medium px-1.5 py-0.5 rounded" title={flag}>Thin data</span>;
  return <span className="text-[10px] text-muted-foreground" title={flag}>⚠ Review</span>;
}

function parseIndices(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      // Plumbing engine stores indices as number[] aligned to FISCAL_MONTHS order
      const result: Record<string, number> = {};
      FISCAL_MONTHS.forEach((m, i) => { if (parsed[i] != null) result[m] = parsed[i] as number; });
      return result;
    }
    return parsed as Record<string, number>;
  } catch { return {}; }
}

function LiveBufferHeatmap({ indices, applied }: { indices: Record<string, number>; applied: number }) {
  const values = FISCAL_MONTHS.map((m) => (indices[m] ?? 0) * applied);
  const hasData = values.some((v) => v > 0);
  if (!hasData) return <p className="text-xs text-muted-foreground mt-2 italic">No seasonal index data available.</p>;
  const positiveVals = values.filter((v) => v > 0);
  const min = Math.min(...positiveVals);
  const max = Math.max(...positiveVals);
  return (
    <div className="mt-4">
      <h4 className="text-xs font-semibold text-foreground mb-2 uppercase tracking-wide">
        Month Multiplier Heatmap · (Seasonal Index × Applied ×)
      </h4>
      <div className="grid grid-cols-12 gap-1">
        {FISCAL_MONTHS.map((m, i) => {
          const v = values[i];
          const bg = v > 0 ? heatColor(v, min, max) : "#d1d5db";
          return (
            <div key={m} className="flex flex-col items-center gap-0.5">
              <div
                className="w-full h-9 rounded flex items-center justify-center text-[10px] font-bold text-white"
                style={{ background: bg }}
              >
                {v > 0 ? v.toFixed(2) : "–"}
              </div>
              <span className="text-[9px] text-muted-foreground">{m}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StockBufferPage({ seg: globalSeg }: { seg?: "PTMT" | "Plumbing" | "Combined" }) {
  const [segment, setSegment] = useState<"PTMT" | "Plumbing">(
    globalSeg === "Plumbing" ? "Plumbing" : "PTMT"
  );
  const [z, setZ] = useState(1.65);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [overrideDrafts, setOverrideDrafts] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [recomputing, setRecomputing] = useState(false);
  const [recomputeError, setRecomputeError] = useState<string | null>(null);

  const { data: categories = [], isLoading, error, refetch } = useQuery<BufferCategory[]>({
    queryKey: ["buffer-categories", segment],
    queryFn: async () => {
      const res = await fetch(`/api/buffer-categories?segment=${segment}`);
      if (!res.ok) throw new Error("Failed to load categories");
      return res.json();
    },
  });

  // Sync drafts from persisted overrides whenever API data changes
  useEffect(() => {
    setOverrideDrafts((prev) => {
      const next: Record<number, string> = {};
      for (const cat of categories) {
        next[cat.id] = prev[cat.id] ?? (cat.overrideMultiplier != null ? cat.overrideMultiplier.toFixed(3) : "");
      }
      return next;
    });
  }, [categories]);

  // Reset on segment change
  useEffect(() => {
    setOverrideDrafts({});
    setExpanded(null);
    setRecomputeError(null);
  }, [segment]);

  function computedSuggested(cat: BufferCategory): number | null {
    if (cat.cvValue == null) return cat.suggestedMultiplier;
    return parseFloat((1 + z * cat.cvValue).toFixed(3));
  }

  async function saveOverride(cat: BufferCategory, forceNull = false) {
    const draft = overrideDrafts[cat.id] ?? "";
    const val = forceNull ? null : (draft === "" ? null : parseFloat(draft));
    if (!forceNull && draft !== "" && (isNaN(val as number) || (val as number) < 0.5 || (val as number) > 10)) return;
    setSavingId(cat.id);
    try {
      const res = await fetch(`/api/buffer-categories/${cat.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrideMultiplier: val }),
      });
      if (!res.ok) throw new Error("Save failed");
      await refetch();
    } finally {
      setSavingId(null);
    }
  }

  async function doRecompute() {
    setRecomputing(true);
    setRecomputeError(null);
    try {
      const res = await fetch(`/api/buffer-categories/recompute?segment=${segment}&z=${z}`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Recompute failed");
      }
      await refetch();
    } catch (e) {
      setRecomputeError((e as Error).message);
    } finally {
      setRecomputing(false);
    }
  }

  // Group Plumbing categories by material prefix
  const grouped = useMemo(() => {
    if (segment !== "Plumbing") return null;
    const map: Record<string, BufferCategory[]> = {};
    for (const cat of categories) {
      const material = cat.name.split(" ")[0];
      if (!map[material]) map[material] = [];
      map[material].push(cat);
    }
    return map;
  }, [categories, segment]);

  const overrideCount = categories.filter((c) => c.overrideMultiplier != null).length;
  const lastComputed = categories[0]?.lastComputedAt ?? null;
  const storedZ = categories[0]?.zScore ?? null;

  const theadCols = ["Category", "Avg/Month", "Vol", "Trend", "Peak", "Reliability", "Suggested ×", "Override ×", "Applied ×", ""];

  const renderRow = (cat: BufferCategory) => {
    const suggested = computedSuggested(cat);
    const draft = overrideDrafts[cat.id] ?? "";
    const isExpanded = expanded === cat.id;
    const isSaving = savingId === cat.id;
    const indices = parseIndices(cat.seasonalIndices);
    const applied = cat.multiplier;

    return (
      <Fragment key={cat.id}>
        <tr
          className={cn(
            "border-b border-border last:border-0 transition-colors",
            isExpanded ? "bg-muted/30" : "hover:bg-muted/20 cursor-pointer"
          )}
          onClick={() => setExpanded(isExpanded ? null : cat.id)}
        >
          <td className="px-3 py-2.5 font-medium text-foreground whitespace-nowrap">{cat.name}</td>
          <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
            {cat.avgMonth != null ? `${fmtQty(Math.round(cat.avgMonth))}/mo` : "–"}
          </td>
          <td className="px-3 py-2.5">{cat.volatilityClass ? volBadge(cat.volatilityClass) : <span className="text-muted-foreground">–</span>}</td>
          <td className="px-3 py-2.5">{cat.signal ? trendBadge(cat.signal) : <span className="text-muted-foreground">–</span>}</td>
          <td className="px-3 py-2.5 text-muted-foreground text-xs">{cat.peakMonth ?? "–"}</td>
          <td className="px-3 py-2.5">{reliabilityBadge(cat.reliabilityFlag)}</td>
          <td className="px-3 py-2.5 font-mono text-foreground">
            {suggested != null ? suggested.toFixed(3) : <span className="text-muted-foreground text-xs">no data</span>}
          </td>
          <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-1">
              <input
                type="number"
                step="0.05"
                min="0.5"
                max="10"
                value={draft}
                placeholder={suggested != null ? suggested.toFixed(3) : "–"}
                onChange={(e) => setOverrideDrafts((p) => ({ ...p, [cat.id]: e.target.value }))}
                className="w-20 text-xs font-mono border border-border rounded px-2 py-1 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                onClick={() => saveOverride(cat)}
                disabled={isSaving}
                title="Save override"
                className="text-xs text-primary hover:text-primary/70 disabled:opacity-40 px-0.5"
              >
                {isSaving ? <Loader2 size={11} className="animate-spin" /> : "✓"}
              </button>
              {cat.overrideMultiplier != null && (
                <button
                  onClick={() => { setOverrideDrafts((p) => ({ ...p, [cat.id]: "" })); saveOverride(cat, true); }}
                  title="Clear override"
                  className="text-xs text-muted-foreground hover:text-destructive px-0.5"
                >×</button>
              )}
            </div>
          </td>
          <td className="px-3 py-2.5">
            <span className={cn("font-mono font-semibold", cat.overrideMultiplier != null ? "text-amber-600" : "text-foreground")}>
              {applied.toFixed(3)}
            </span>
            {cat.overrideMultiplier != null && <span className="ml-1 text-[9px] text-amber-600 font-medium">OVR</span>}
          </td>
          <td className="px-3 py-2.5 text-muted-foreground">
            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </td>
        </tr>
        {isExpanded && (
          <tr key={`${cat.id}-detail`} className="bg-muted/10 border-b border-border">
            <td colSpan={10} className="px-4 py-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
                <div>
                  <div className="flex flex-wrap gap-4 mb-3">
                    {cat.cvValue != null && <span><strong>CV:</strong> {(cat.cvValue * 100).toFixed(1)}%</span>}
                    {cat.yoy != null && <span><strong>YoY:</strong> {cat.yoy >= 0 ? "+" : ""}{(cat.yoy * 100).toFixed(1)}%</span>}
                    {cat.avgMonth != null && <span><strong>Avg/month:</strong> {cat.avgMonth.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>}
                    {cat.dataQuality && <span><strong>Quality:</strong> {cat.dataQuality}</span>}
                  </div>
                  {cat.reliabilityFlag && (
                    <p className="text-amber-700 bg-amber-50 rounded px-2 py-1 mb-3">{cat.reliabilityFlag}</p>
                  )}
                  <LiveBufferHeatmap indices={indices} applied={applied} />
                </div>
                <div>
                  <p className="font-semibold text-foreground mb-2">Seasonal Indices</p>
                  <div className="grid grid-cols-3 gap-1">
                    {FISCAL_MONTHS.map((m) => (
                      <div key={m} className="flex justify-between pr-2">
                        <span className="text-muted-foreground">{m}:</span>
                        <span className="font-mono">{indices[m] != null ? indices[m].toFixed(3) : "–"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </td>
          </tr>
        )}
      </Fragment>
    );
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Stock Buffer Engine</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Data-driven safety-stock multipliers · FY2024-25 & 2025-26 basis (recency-weighted)
          </p>
        </div>
      </div>

      {/* Segment toggle */}
      <div className="flex gap-2 mb-4">
        {(["PTMT", "Plumbing"] as const).map((seg) => (
          <button
            key={seg}
            onClick={() => setSegment(seg)}
            className={cn(
              "px-4 py-1.5 rounded-full text-sm font-medium border transition-colors",
              segment === seg
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:bg-muted"
            )}
          >
            {seg}
          </button>
        ))}
      </div>

      {/* Controls */}
      <div className="bg-card border border-card-border rounded-lg p-4 mb-5 flex items-center gap-6 flex-wrap">
        <div>
          <p className="text-xs font-semibold text-foreground uppercase tracking-wide mb-1.5">Service Level (z)</p>
          <div className="flex gap-2">
            {Z_LEVELS.map(({ label, z: zv }) => (
              <button
                key={label}
                onClick={() => setZ(zv)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium border transition-colors",
                  z === zv
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:bg-muted"
                )}
              >
                {label} (z={zv})
              </button>
            ))}
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          <strong className="text-foreground">Suggested ×</strong> = 1 + z × CV (live preview)
          &nbsp;·&nbsp; <strong className="text-foreground">Applied</strong> = DB-persisted (override ?? computed)
          {overrideCount > 0 && (
            <span className="text-amber-600 font-medium ml-2">{overrideCount} override{overrideCount > 1 ? "s" : ""} active</span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-3">
          {lastComputed && (
            <span className="text-[11px] text-muted-foreground">
              Computed {new Date(lastComputed).toLocaleDateString("en-IN")}{storedZ != null ? ` · z=${storedZ}` : ""}
            </span>
          )}
          <button
            onClick={doRecompute}
            disabled={recomputing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {recomputing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {recomputing ? "Computing…" : "Recompute"}
          </button>
        </div>
      </div>

      {recomputeError && (
        <div className="bg-red-50 border border-red-200 rounded-md px-4 py-2.5 mb-4 text-xs text-red-700 flex items-center gap-2">
          <AlertCircle size={13} /> {recomputeError}
        </div>
      )}

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center">
          <Loader2 size={16} className="animate-spin" /> Loading categories…
        </div>
      )}
      {error && <div className="text-sm text-destructive py-4 text-center">Failed to load categories. Check API connection.</div>}

      {!isLoading && !error && (
        <div className="bg-card border border-card-border rounded-lg overflow-hidden mb-5">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  {theadCols.map((h) => (
                    <th key={h} className="text-left px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {segment === "Plumbing" && grouped
                  ? Object.entries(grouped).map(([material, cats]) => (
                      <Fragment key={material}>
                        <tr className="bg-muted/50 border-b border-border">
                          <td colSpan={10} className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                            {material}
                          </td>
                        </tr>
                        {cats.map(renderRow)}
                      </Fragment>
                    ))
                  : categories.map(renderRow)}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!isLoading && categories.length > 0 && (
        <div className="bg-card border border-card-border rounded-lg p-5">
          <h3 className="text-sm font-semibold text-foreground mb-1">Applied Multiplier by Category</h3>
          <p className="text-xs text-muted-foreground mb-4">Higher = wider safety buffer. Overrides shown in amber.</p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart
              data={categories.map((cat) => ({
                name: cat.name.length > 12 ? cat.name.slice(0, 12) + "…" : cat.name,
                fullName: cat.name,
                applied: cat.multiplier,
                suggested: computedSuggested(cat) ?? cat.multiplier,
                hasOverride: cat.overrideMultiplier != null,
              }))}
              margin={{ top: 4, right: 16, left: 0, bottom: 40 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-35} textAnchor="end" interval={0} />
              <YAxis tick={{ fontSize: 11 }} domain={[1, "auto"]} />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload;
                  return (
                    <div className="bg-card border border-card-border rounded-md px-3 py-2 text-xs shadow-md">
                      <p className="font-semibold mb-1">{d.fullName}</p>
                      <p>Applied ×: <strong>{(d.applied as number).toFixed(3)}</strong></p>
                      <p>Suggested ×: {(d.suggested as number).toFixed(3)}</p>
                      {d.hasOverride && <p className="text-amber-600 mt-1">Override active</p>}
                    </div>
                  );
                }}
              />
              <Bar dataKey="applied" radius={[3, 3, 0, 0]}>
                {categories.map((cat) => (
                  <Cell key={cat.id} fill={cat.overrideMultiplier != null ? AMBER : BLUE} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ─── Sales Page ───────────────────────────────────────────────────────────────
function SalesPage({ fy, seg }: { fy: string; seg: "PTMT" | "Plumbing" | "Combined" }) {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["ops-sales", fy],
    queryFn: async () => {
      const res = await fetch(`/api/ops/sales?fy=${fy}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const monthlyData = useMemo(() => {
    if (!data?.monthly) return [];
    return data.monthly.map((m: any) => ({
      month: m.month,
      "Sales (₹ Cr)": toCr(m.value),
    }));
  }, [data]);

  // PTMT sales trend from seed
  const ptmtSalesTrend = useMemo(() => {
    return Object.entries(SEED.sales_ptmt.fy_qty).map(([fy, qty]) => ({
      fy,
      "PTMT Sales (L units)": parseFloat((qty / 1e5).toFixed(1)),
    }));
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Sales</h1>
          <p className="text-sm text-muted-foreground mt-0.5">FY {fy} · 3-Year Sale Master</p>
        </div>
        <button onClick={() => refetch()} disabled={isFetching}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-border rounded-md text-muted-foreground hover:bg-muted transition-colors">
          <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {(seg === "Plumbing" || seg === "Combined") && (
        <div className="mb-5 flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2.5">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          <span>Sales data comes from the PTMT 3-Year Sale Master. Plumbing sales history is tracked in a separate workbook and not yet integrated here.</span>
        </div>
      )}

      {/* PTMT sales trend from seed — always visible */}
      <div className="bg-card border border-card-border rounded-lg p-5 mb-5">
        <h3 className="text-sm font-semibold text-foreground mb-1">PTMT Sales Trend · 4 Years (Seed)</h3>
        <p className="text-xs text-muted-foreground mb-4">Consistent growth: +28% YoY in 2023-24, +22% in 2024-25, +6% in 2025-26</p>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={ptmtSalesTrend} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="fy" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}L`} />
            <Tooltip content={<CustomTooltip formatter={(v: number) => `${v}L units`} />} />
            <Bar dataKey="PTMT Sales (L units)" fill={GREEN} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {isLoading && <LoadingState label="Reading Sale Master sheet (large file, may take ~20s)…" />}
      {error && <ErrorState message="Could not load sales data from Sale Master." />}

      {data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            <KpiCard label="Total Sales Value" value={fmtCr(data.totalValue ?? 0)} color={GREEN} />
            <KpiCard label="Months" value={String(data.monthly?.length ?? 0)} sub="with data" />
            <KpiCard label="Products" value={String(data.byProduct?.length ?? 0)} sub="tracked" />
          </div>

          {monthlyData.length > 0 && (
            <div className="bg-card border border-card-border rounded-lg p-5 mb-5">
              <h3 className="text-sm font-semibold text-foreground mb-4">Monthly Sales Value · ₹ Cr</h3>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={monthlyData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="greenGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={GREEN} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={GREEN} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${v}Cr`} />
                  <Tooltip content={<CustomTooltip formatter={(v: number) => `₹${v} Cr`} />} />
                  <Area type="monotone" dataKey="Sales (₹ Cr)" stroke={GREEN} fill="url(#greenGrad)"
                    strokeWidth={2} dot={{ r: 3 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {data.byProduct?.length > 0 && (
            <div className="bg-card border border-card-border rounded-lg p-5">
              <h3 className="text-sm font-semibold text-foreground mb-4">Sales by Product · ₹ Cr</h3>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart
                  data={data.byProduct.slice(0, 12).map((p: any) => ({ ...p, value: toCr(p.value) }))}
                  layout="vertical" margin={{ top: 0, right: 16, left: 100, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `₹${v}Cr`} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={100} />
                  <Tooltip content={<CustomTooltip formatter={(v: number) => `₹${v} Cr`} />} />
                  <Bar dataKey="value" name="Sales (₹ Cr)" fill={GREEN} radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {!data.monthly?.length && !data.byProduct?.length && (
            <div className="bg-card border border-card-border rounded-lg p-12 text-center">
              <p className="text-sm text-muted-foreground">No sales data could be parsed for FY {fy}.</p>
              <p className="text-xs text-muted-foreground mt-1">The Sale Master sheet structure may differ from expected column names.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Data Sources Page ────────────────────────────────────────────────────────
function SourcesPage() {
  const sources = [
    { label: "Order Sheet 26-27", id: "1HFBAtvbAskejVkjuO8zHoEsE-pBAFij2ERMKFEvt64A", domain: "Orders", fy: "2026-27" },
    { label: "Order Sheet 25-26", id: "1Xzq-gmB6K7iuMcE6gb-O7OpvGgSDU33DzEVyK60LK6E", domain: "Orders", fy: "2025-26" },
    { label: "Order Sheet 24-25", id: "1cT6lWRPJ3oSeYhab-cqeVjJidGitFQsr0DOq-vNn6cI", domain: "Orders", fy: "2024-25" },
    { label: "Order Sheet 23-24", id: "1jtSUGE6iT8WuUKi56F4LYqjJgZF42oR1mk51imG8yq8", domain: "Orders", fy: "2023-24" },
    { label: "3 Year Sale Master", id: "1JpHX_hiRZ1l2QyyS3X3LbbsyqSLQ0oyIs3n9emnoH3s", domain: "Sales", fy: "Multi-year" },
    { label: "PTMT Daily Production (68 sheets)", id: "—", domain: "Production", fy: "2020–2026" },
    { label: "Rate List", id: "1njO-srsS29qiE4t45-zr5njbB7R2Zb-oSnv2NL1ONY4", domain: "Config", fy: "Ongoing" },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-foreground mb-1">Data Sources</h1>
      <p className="text-sm text-muted-foreground mb-6">All sheets read live via Google Sheets API · cached 5 min</p>

      <div className="bg-card border border-card-border rounded-lg overflow-hidden mb-5">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {["Name","Domain","FY","Sheet ID"].map((h) => (
                <th key={h} className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wide text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sources.map((s, i) => (
              <tr key={i} className={cn("border-b border-border last:border-0", i % 2 === 1 && "bg-muted/20")}>
                <td className="px-4 py-3 font-medium text-foreground">{s.label}</td>
                <td className="px-4 py-3">
                  <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium",
                    s.domain === "Orders" && "bg-amber-100 text-amber-800",
                    s.domain === "Sales" && "bg-green-100 text-green-800",
                    s.domain === "Production" && "bg-blue-100 text-blue-800",
                    s.domain === "Config" && "bg-gray-100 text-gray-700",
                  )}>
                    {s.domain}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{s.fy}</td>
                <td className="px-4 py-3 text-muted-foreground font-mono text-xs truncate max-w-[200px]">
                  {s.id === "—" ? "—" : (
                    <a href={`https://docs.google.com/spreadsheets/d/${s.id}`} target="_blank" rel="noopener noreferrer"
                      className="hover:text-primary hover:underline">{s.id.slice(0, 20)}…</a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 bg-muted/30 border border-border rounded-lg p-4 text-xs text-muted-foreground space-y-1.5">
        <p><strong className="text-foreground">Seed data:</strong> Pre-computed numbers load instantly. Click Refresh on any page to reload from live sheets.</p>
        <p><strong className="text-foreground">Cache:</strong> Sheet reads cached in-memory for 5 minutes per endpoint.</p>
        <p><strong className="text-foreground">Channel rule:</strong> Retail unless STATE / STATE HEAD contains JJM, GEM, GOVT, or PROJECT.</p>
        <p><strong className="text-foreground">PTMT plan column:</strong> Era-aware — col M (2020), col O (2021–24), col P (2025–26).</p>
        <p><strong className="text-foreground">Buffer engine:</strong> Basis = FY2024-25 & FY2025-26, recency-weighted (latest ×2). Overrides persist in localStorage.</p>
      </div>
    </div>
  );
}

// ─── API Keys Page ────────────────────────────────────────────────────────────
function ApiKeysPage() {
  const [keys, setKeys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<{ key: string; label: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/api-keys");
      if (res.ok) setKeys(await res.json());
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useState(() => { load(); return () => { mounted.current = false; }; });

  async function create() {
    if (!label.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim(), description: description.trim() || undefined }),
      });
      if (res.ok) {
        const created = await res.json();
        setNewKey({ key: created.rawKey ?? created.key, label: created.label });
        setLabel(""); setDescription("");
        load();
      }
    } finally {
      setCreating(false);
    }
  }

  async function deleteKey(id: string) {
    setActionLoading(id + "-del");
    try {
      await fetch(`/api/api-keys/${id}`, { method: "DELETE" });
      load();
    } finally {
      setActionLoading(null);
    }
  }

  async function regenerate(id: string) {
    setActionLoading(id + "-regen");
    try {
      const res = await fetch(`/api/api-keys/${id}/regenerate`, { method: "POST" });
      if (res.ok) {
        const updated = await res.json();
        setNewKey({ key: updated.rawKey ?? updated.key, label: updated.label });
        load();
      }
    } finally {
      setActionLoading(null);
    }
  }

  function copyKey() {
    if (!newKey) return;
    navigator.clipboard.writeText(newKey.key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function fmtDate(s: string) {
    return s ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <KeyRound size={22} className="text-amber-500" /> API Key Management
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Issue API keys for external systems. Use{" "}
          <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">Authorization: Bearer &lt;key&gt;</code>{" "}
          in request headers.
        </p>
      </div>

      {/* New key reveal dialog */}
      {newKey && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-lg p-4">
          <p className="text-sm font-semibold text-amber-800 mb-1">
            ⚠ Copy your key now — it won't be shown again
          </p>
          <p className="text-xs text-amber-700 mb-3">Key for: <strong>{newKey.label}</strong></p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-white border border-amber-200 rounded px-3 py-2 text-xs font-mono break-all select-all">
              {newKey.key}
            </code>
            <button
              onClick={copyKey}
              className="flex items-center gap-1.5 text-xs px-3 py-2 bg-amber-500 text-white rounded-md font-medium hover:bg-amber-600 transition-colors shrink-0"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <button
            onClick={() => setNewKey(null)}
            className="mt-3 text-xs text-amber-600 hover:underline"
          >
            I've saved it — dismiss
          </button>
        </div>
      )}

      {/* Create form */}
      <div className="bg-card border border-card-border rounded-lg p-5 mb-6">
        <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5">
          <Plus size={14} /> Issue New Key
        </h2>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="text-xs text-muted-foreground font-medium block mb-1">
              Label <span className="text-red-500">*</span>
            </label>
            <input
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="e.g. prayag-plant.com"
              className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              onKeyDown={e => e.key === "Enter" && create()}
            />
          </div>
          <div className="flex-1">
            <label className="text-xs text-muted-foreground font-medium block mb-1">Description</label>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Optional note"
              className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              onKeyDown={e => e.key === "Enter" && create()}
            />
          </div>
          <button
            onClick={create}
            disabled={creating || !label.trim()}
            className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 text-white rounded-md text-sm font-medium hover:bg-amber-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            {creating ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            Generate Key
          </button>
        </div>
      </div>

      {/* Keys table */}
      <div className="bg-card border border-card-border rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Active Keys</h2>
        </div>
        {loading ? (
          <div className="py-10 flex items-center justify-center gap-2 text-muted-foreground text-sm">
            <Loader2 size={15} className="animate-spin" /> Loading…
          </div>
        ) : keys.length === 0 ? (
          <div className="py-10 text-center text-muted-foreground text-sm">
            <KeyRound size={28} className="mx-auto mb-2 opacity-30" />
            No API keys yet. Generate one above.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/30 border-b border-border text-left">
              <tr>
                <th className="py-2.5 px-4 font-medium text-muted-foreground">Label</th>
                <th className="py-2.5 px-4 font-medium text-muted-foreground">Description</th>
                <th className="py-2.5 px-4 font-medium text-muted-foreground">Prefix</th>
                <th className="py-2.5 px-4 font-medium text-muted-foreground">Created</th>
                <th className="py-2.5 px-4 font-medium text-muted-foreground">Last Used</th>
                <th className="py-2.5 px-3 font-medium text-muted-foreground text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {keys.map((k: any) => (
                <tr key={k.id} className="hover:bg-muted/20 transition-colors">
                  <td className="py-2.5 px-4 font-medium">{k.label}</td>
                  <td className="py-2.5 px-4 text-muted-foreground text-xs">{k.description || "—"}</td>
                  <td className="py-2.5 px-4">
                    <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">{k.keyPrefix}…</code>
                  </td>
                  <td className="py-2.5 px-4 text-xs text-muted-foreground">{fmtDate(k.createdAt)}</td>
                  <td className="py-2.5 px-4 text-xs text-muted-foreground">{k.lastUsedAt ? fmtDate(k.lastUsedAt) : "Never"}</td>
                  <td className="py-2.5 px-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => regenerate(k.id)}
                        disabled={actionLoading === k.id + "-regen"}
                        title="Regenerate key"
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                      >
                        {actionLoading === k.id + "-regen"
                          ? <Loader2 size={13} className="animate-spin" />
                          : <RefreshCw size={13} />}
                      </button>
                      <button
                        onClick={() => deleteKey(k.id)}
                        disabled={actionLoading === k.id + "-del"}
                        title="Delete key"
                        className="p-1.5 rounded hover:bg-red-50 text-muted-foreground hover:text-red-600 transition-colors disabled:opacity-50"
                      >
                        {actionLoading === k.id + "-del"
                          ? <Loader2 size={13} className="animate-spin" />
                          : <Trash2 size={13} />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Layout ───────────────────────────────────────────────────────────────────
function AppLayout({ children, fy, setFy, seg, setSeg }: {
  children: React.ReactNode;
  fy: string; setFy: (v: string) => void;
  seg: "PTMT" | "Plumbing" | "Combined"; setSeg: (v: "PTMT" | "Plumbing" | "Combined") => void;
}) {
  return (
    <>
      <CrossAppNav />
      <div className="flex min-h-screen bg-background pt-9">
        <Sidebar fy={fy} setFy={setFy} seg={seg} setSeg={setSeg} />
        <main className="ml-56 flex-1 min-h-screen">
          <div className="max-w-[1200px] mx-auto px-6 py-6">{children}</div>
        </main>
      </div>
    </>
  );
}

// ─── Router ───────────────────────────────────────────────────────────────────
function AppRouter() {
  const [fy, setFy] = useState("2026-27");
  const [seg, setSeg] = useState<"PTMT" | "Plumbing" | "Combined">("PTMT");
  return (
    <AppLayout fy={fy} setFy={setFy} seg={seg} setSeg={setSeg}>
      <Switch>
        <Route path="/"             component={() => <OverviewPage fy={fy} seg={seg} />} />
        <Route path="/management"   component={() => <ManagementReportsPage />} />
        <Route path="/orders"       component={() => <OrdersPage fy={fy} seg={seg} />} />
        <Route path="/production"   component={() => <ProductionPage seg={seg} />} />
        <Route path="/stock-buffer" component={() => <StockBufferPage seg={seg} />} />
        <Route path="/sales"        component={() => <SalesPage fy={fy} seg={seg} />} />
        <Route path="/sources"      component={() => <SourcesPage />} />
        <Route path="/api-keys"     component={() => <ApiKeysPage />} />
        <Route component={() => (
          <div className="text-center py-20">
            <h2 className="text-lg font-semibold text-foreground">Page not found</h2>
            <Link href="/" className="text-sm text-primary hover:underline mt-2 block">← Back to Overview</Link>
          </div>
        )} />
      </Switch>
    </AppLayout>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AppRouter />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

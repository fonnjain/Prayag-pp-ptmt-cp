import { Switch, Route, Router as WouterRouter, Link, useLocation } from "wouter";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { useState, useMemo, Fragment } from "react";
import {
  LayoutDashboard, ShoppingCart, Factory, TrendingUp, Database,
  RefreshCw, ChevronRight, AlertCircle, Loader2, Layers, ChevronDown, ChevronUp,
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
function fmtQty(n: number): string {
  if (n >= 1e5) return `${(n / 1e5).toFixed(1)}L`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
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
  { href: "/",            label: "Overview",     icon: <LayoutDashboard size={15} /> },
  { href: "/orders",      label: "Orders",       icon: <ShoppingCart size={15} /> },
  { href: "/production",  label: "Production",   icon: <Factory size={15} /> },
  { href: "/stock-buffer",label: "Stock Buffer", icon: <Layers size={15} /> },
  { href: "/sales",       label: "Sales",        icon: <TrendingUp size={15} /> },
  { href: "/sources",     label: "Data Sources", icon: <Database size={15} /> },
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

function Sidebar({ fy, setFy }: { fy: string; setFy: (v: string) => void }) {
  return (
    <aside className="fixed top-9 left-0 bottom-0 z-20 flex w-56 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="px-5 pt-5 pb-4 border-b border-sidebar-border">
        <div className="text-[22px] font-bold tracking-tight leading-none" style={{ color: AMBER }}>prayag</div>
        <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">India Operations</div>
      </div>
      <div className="px-3 pt-3 pb-1">
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
function OverviewPage({ fy }: { fy: string }) {
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

// ─── Orders Page ──────────────────────────────────────────────────────────────
function OrdersPage({ fy }: { fy: string }) {
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
function ProductionPage() {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["ops-production"],
    queryFn: async () => {
      const res = await fetch(`/api/ops/production`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
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
          <p className="text-sm text-muted-foreground mt-0.5">PTMT · Annual plan trend + live monthly breakdown</p>
        </div>
        <button onClick={() => refetch()} disabled={isFetching}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-border rounded-md text-muted-foreground hover:bg-muted transition-colors">
          <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

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

// ─── Stock Buffer Engine ───────────────────────────────────────────────────────
type SeedCategory = (typeof SEED.stock_buffer.categories)[number];

const Z_LEVELS = [
  { label: "90%", z: 1.28 },
  { label: "95%", z: 1.65 },
  { label: "98%", z: 2.05 },
];

function BufferHeatmap({ cat, applied }: { cat: SeedCategory; applied: number }) {
  const values = FISCAL_MONTHS.map((m) => {
    const si = (cat.seasonal_index as Record<string, number>)[m] ?? 0;
    return si * applied;
  });
  const min = Math.min(...values);
  const max = Math.max(...values);

  return (
    <div className="mt-4">
      <h4 className="text-xs font-semibold text-foreground mb-2 uppercase tracking-wide">
        Month Multiplier Heatmap · (Seasonal Index × Applied ×)
      </h4>
      <div className="grid grid-cols-12 gap-1">
        {FISCAL_MONTHS.map((m, i) => {
          const v = values[i];
          const bg = heatColor(v, min, max);
          return (
            <div key={m} className="flex flex-col items-center gap-0.5">
              <div
                className="w-full h-9 rounded flex items-center justify-center text-[10px] font-bold text-white"
                style={{ background: bg }}
              >
                {v.toFixed(2)}
              </div>
              <span className="text-[9px] text-muted-foreground">{m}</span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
        <span>▪ Low (trim)</span>
        <div className="flex gap-0.5">
          {[0,0.25,0.5,0.75,1].map((t) => (
            <div key={t} className="w-6 h-2 rounded-sm" style={{ background: heatColor(min + t*(max-min), min, max) }} />
          ))}
        </div>
        <span>▪ High (build up)</span>
      </div>
    </div>
  );
}

function BufferTargets({ cat, applied }: { cat: SeedCategory; applied: number }) {
  const growth = cat.planning_growth;
  const rows = FISCAL_MONTHS.map((m) => {
    const si = (cat.seasonal_index as Record<string, number>)[m] ?? 0;
    const target = cat.avg_month_units * (1 + growth) * si * applied;
    return { month: m, seasonal_index: si, target };
  });
  return (
    <div className="mt-4">
      <h4 className="text-xs font-semibold text-foreground mb-2 uppercase tracking-wide">
        Next-Year Monthly Targets
        <span className="ml-2 font-normal text-muted-foreground normal-case">
          ({growth >= 0 ? "+" : ""}{(growth * 100).toFixed(1)}% growth assumption)
        </span>
      </h4>
      <div className="grid grid-cols-12 gap-1">
        {rows.map(({ month, seasonal_index, target }) => (
          <div key={month} className="flex flex-col items-center gap-0.5 text-center">
            <div className="text-[10px] font-bold text-foreground">{fmtQty(Math.round(target))}</div>
            <div className="text-[9px] text-muted-foreground">{month}</div>
            <div className="text-[9px] text-muted-foreground/60">si:{seasonal_index.toFixed(2)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StockBufferPage() {
  const [z, setZ] = useState(1.65);
  const [overrides, setOverrides] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem("buf-overrides") ?? "{}"); }
    catch { return {}; }
  });
  const [expanded, setExpanded] = useState<string | null>(null);

  const categories = SEED.stock_buffer.categories;

  function getSuggested(cat: SeedCategory) { return 1 + z * cat.cv; }
  function getApplied(cat: SeedCategory) {
    const ov = overrides[cat.category];
    const num = ov !== undefined && ov !== "" ? parseFloat(ov) : NaN;
    return isNaN(num) ? getSuggested(cat) : num;
  }

  function setOverride(category: string, val: string) {
    const next = { ...overrides, [category]: val };
    setOverrides(next);
    localStorage.setItem("buf-overrides", JSON.stringify(next));
  }
  function clearOverride(category: string) {
    const next = { ...overrides };
    delete next[category];
    setOverrides(next);
    localStorage.setItem("buf-overrides", JSON.stringify(next));
  }

  const overrideCount = Object.values(overrides).filter((v) => v !== "").length;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Stock Buffer Engine</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Data-driven safety-stock multipliers · FY2024-25 & 2025-26 basis (recency-weighted)
          </p>
        </div>
      </div>

      {/* Service level selector */}
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
          <strong className="text-foreground">Suggested ×</strong> = 1 + z × CV
          &nbsp;·&nbsp; <strong className="text-foreground">Applied</strong> = override if set, else suggested
          &nbsp;·&nbsp; {overrideCount > 0 && (
            <span className="text-amber-600 font-medium">{overrideCount} override{overrideCount > 1 ? "s" : ""} active</span>
          )}
        </div>
        <div className="ml-auto text-xs text-muted-foreground">
          Basis: {SEED.stock_buffer.basis}
        </div>
      </div>

      {/* Table */}
      <div className="bg-card border border-card-border rounded-lg overflow-hidden mb-5">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {["Category","Avg/Month","Vol Class","Trend","Peak","Suggested ×","Override ×","Applied ×",""].map((h) => (
                  <th key={h} className="text-left px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {categories.map((cat) => {
                const suggested = getSuggested(cat);
                const applied = getApplied(cat);
                const hasOverride = overrides[cat.category] !== undefined && overrides[cat.category] !== "";
                const isExpanded = expanded === cat.category;

                return (
                  <Fragment key={cat.category}>
                    <tr
                      className={cn(
                        "border-b border-border last:border-0 transition-colors",
                        isExpanded ? "bg-muted/30" : "hover:bg-muted/20 cursor-pointer"
                      )}
                      onClick={() => setExpanded(isExpanded ? null : cat.category)}
                    >
                      <td className="px-3 py-2.5 font-medium text-foreground whitespace-nowrap">
                        {cat.category}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                        {fmtQty(cat.avg_month_units)}/mo
                      </td>
                      <td className="px-3 py-2.5">{volBadge(cat.vol_class)}</td>
                      <td className="px-3 py-2.5">{trendBadge(cat.trend_signal)}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{cat.peak_month}</td>
                      <td className="px-3 py-2.5 font-mono text-foreground">{suggested.toFixed(3)}</td>
                      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            step="0.05"
                            min="1"
                            max="5"
                            value={overrides[cat.category] ?? ""}
                            placeholder={suggested.toFixed(3)}
                            onChange={(e) => setOverride(cat.category, e.target.value)}
                            className="w-20 text-xs font-mono border border-border rounded px-2 py-1 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                          {hasOverride && (
                            <button
                              onClick={() => clearOverride(cat.category)}
                              className="text-xs text-muted-foreground hover:text-destructive px-1"
                              title="Clear override"
                            >×</button>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={cn(
                          "font-mono font-semibold",
                          hasOverride ? "text-amber-600" : "text-foreground"
                        )}>
                          {applied.toFixed(3)}
                        </span>
                        {hasOverride && (
                          <span className="ml-1 text-[9px] text-amber-600 font-medium">OVR</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </td>
                    </tr>

                    {/* Expanded detail row */}
                    {isExpanded && (
                      <tr key={`${cat.category}-detail`} className="bg-muted/10 border-b border-border">
                        <td colSpan={9} className="px-4 py-4">
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
                            <div>
                              <div className="flex flex-wrap gap-2 mb-3">
                                <span><strong>CV:</strong> {(cat.cv * 100).toFixed(1)}%</span>
                                <span><strong>YoY:</strong> {cat.yoy >= 0 ? "+" : ""}{(cat.yoy * 100).toFixed(1)}%</span>
                                <span><strong>Planning growth:</strong> {cat.planning_growth >= 0 ? "+" : ""}{(cat.planning_growth * 100).toFixed(1)}%</span>
                                <span><strong>Avg/month:</strong> {cat.avg_month_units.toLocaleString()}</span>
                              </div>
                              <BufferHeatmap cat={cat} applied={applied} />
                            </div>
                            <div>
                              <BufferTargets cat={cat} applied={applied} />
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Summary chart: Applied × across all categories */}
      <div className="bg-card border border-card-border rounded-lg p-5">
        <h3 className="text-sm font-semibold text-foreground mb-1">Applied Multiplier by Category</h3>
        <p className="text-xs text-muted-foreground mb-4">Higher = wider safety buffer. Overrides shown in amber.</p>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart
            data={categories.map((cat) => ({
              name: cat.category.length > 10 ? cat.category.slice(0, 10) + "…" : cat.category,
              fullName: cat.category,
              applied: parseFloat(getApplied(cat).toFixed(3)),
              suggested: parseFloat(getSuggested(cat).toFixed(3)),
              hasOverride: overrides[cat.category] !== undefined && overrides[cat.category] !== "",
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
                    <p>Applied ×: <strong>{d.applied}</strong></p>
                    <p>Suggested ×: {d.suggested}</p>
                    {d.hasOverride && <p className="text-amber-600 mt-1">Override active</p>}
                  </div>
                );
              }}
            />
            <Bar dataKey="applied" radius={[3, 3, 0, 0]}>
              {categories.map((cat) => {
                const hasOvr = overrides[cat.category] !== undefined && overrides[cat.category] !== "";
                return <Cell key={cat.category} fill={hasOvr ? AMBER : BLUE} />;
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── Sales Page ───────────────────────────────────────────────────────────────
function SalesPage({ fy }: { fy: string }) {
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

// ─── Layout ───────────────────────────────────────────────────────────────────
function AppLayout({ children, fy, setFy }: { children: React.ReactNode; fy: string; setFy: (v: string) => void }) {
  return (
    <>
      <CrossAppNav />
      <div className="flex min-h-screen bg-background pt-9">
        <Sidebar fy={fy} setFy={setFy} />
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
  return (
    <AppLayout fy={fy} setFy={setFy}>
      <Switch>
        <Route path="/"             component={() => <OverviewPage fy={fy} />} />
        <Route path="/orders"       component={() => <OrdersPage fy={fy} />} />
        <Route path="/production"   component={() => <ProductionPage />} />
        <Route path="/stock-buffer" component={() => <StockBufferPage />} />
        <Route path="/sales"        component={() => <SalesPage fy={fy} />} />
        <Route path="/sources"      component={() => <SourcesPage />} />
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

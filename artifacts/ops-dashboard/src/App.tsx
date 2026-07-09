import { Switch, Route, Router as WouterRouter, Link, useLocation } from "wouter";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { useState, useMemo } from "react";
import {
  LayoutDashboard, ShoppingCart, Factory, TrendingUp, Database,
  RefreshCw, ChevronRight, AlertCircle, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Query Client ─────────────────────────────────────────────────────────────
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
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
  if (cr >= 10) return `₹${cr.toFixed(1)} Cr`;
  if (cr >= 1) return `₹${cr.toFixed(2)} Cr`;
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

// ─── Section Header ───────────────────────────────────────────────────────────
function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
    </div>
  );
}

// ─── Loading / Error states ───────────────────────────────────────────────────
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

// ─── Sidebar ──────────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: <LayoutDashboard size={15} /> },
  { href: "/orders", label: "Orders", icon: <ShoppingCart size={15} /> },
  { href: "/production", label: "Production", icon: <Factory size={15} /> },
  { href: "/sales", label: "Sales", icon: <TrendingUp size={15} /> },
  { href: "/sources", label: "Data Sources", icon: <Database size={15} /> },
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

function Sidebar({ fy, setFy }: { fy: string; setFy: (v: string) => void }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-20 flex w-56 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="px-5 pt-5 pb-4 border-b border-sidebar-border">
        <div className="text-[22px] font-bold tracking-tight leading-none" style={{ color: AMBER }}>
          prayag
        </div>
        <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
          India Operations
        </div>
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
          {FY_OPTIONS.map((f) => (
            <option key={f} value={f}>FY {f}</option>
          ))}
        </select>
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {NAV_ITEMS.map((item) => (
          <SidebarLink key={item.href} {...item} />
        ))}
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
      if (!res.ok) throw new Error("Failed to load overview");
      return res.json();
    },
  });

  const { data: orders, isLoading: ordersLoading } = useQuery({
    queryKey: ["ops-orders", fy],
    queryFn: async () => {
      const res = await fetch(`/api/ops/orders?fy=${fy}`);
      if (!res.ok) throw new Error("Failed to load orders");
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

      {isLoading && <LoadingState />}
      {error && <ErrorState />}

      {data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <KpiCard
              label="Order Value YTD"
              value={fmtCr(data.orderValue ?? 0)}
              sub={`FY ${fy} · ${fmtQty(data.orderQty ?? 0)} units`}
              color={AMBER}
            />
            <KpiCard
              label="Order Qty YTD"
              value={fmtQty(data.orderQty ?? 0)}
              sub="PTMT + All Groups"
            />
            <KpiCard
              label="Sales Value"
              value="Live via Sheet"
              sub="See Sales section"
            />
            <KpiCard
              label="Production Plan"
              value="Live via Sheet"
              sub="See Production section"
            />
          </div>

          {ordersLoading ? (
            <LoadingState label="Loading monthly trend…" />
          ) : (
            <div className="bg-card border border-card-border rounded-lg p-5 mb-6">
              <h3 className="text-sm font-semibold text-foreground mb-4">Monthly Order Value · FY {fy}</h3>
              <ResponsiveContainer width="100%" height={260}>
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
                  <Area type="monotone" dataKey="Orders (₹ Cr)" stroke={AMBER} fill="url(#amberGrad)" strokeWidth={2} dot={{ r: 3 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

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
      if (!res.ok) throw new Error("Failed to load orders");
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
      for (const fy of ["2023-24", "2024-25", "2025-26", "2026-27"]) {
        if (row[fy]) out[fy] = toCr(row[fy]);
      }
      return out;
    });
  }, [yoy]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Orders Received</h1>
          <p className="text-sm text-muted-foreground mt-0.5">FY {fy} · Live from Google Sheets</p>
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

      {isLoading && <LoadingState />}
      {error && <ErrorState message="Could not load order data. The sheet may require Google Sheets access." />}

      {data && (
        <>
          {/* KPIs */}
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
                  <BarChart data={data.byGroup.slice(0, 8).map((g: any) => ({ ...g, value: toCr(g.value) }))} layout="vertical" margin={{ top: 0, right: 16, left: 60, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `₹${v}Cr`} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={60} />
                    <Tooltip content={<CustomTooltip formatter={(v: number) => `₹${v} Cr`} />} />
                    <Bar dataKey="value" name="Value (₹ Cr)" fill={GREEN} radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Channel Donut */}
            <div className="bg-card border border-card-border rounded-lg p-5">
              <h3 className="text-sm font-semibold text-foreground mb-4">Channel Split</h3>
              {!data.byChannel?.length ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No data</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={data.byChannel.map((c: any) => ({ ...c, value: toCr(c.value) }))}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={90}
                      paddingAngle={3}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      labelLine={false}
                    >
                      {data.byChannel.map((_: any, i: number) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => `₹${v} Cr`} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Top Plants */}
          {data.byPlant?.length > 0 && (
            <div className="bg-card border border-card-border rounded-lg p-5 mb-5">
              <h3 className="text-sm font-semibold text-foreground mb-4">Top Plants / Locations</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.byPlant.slice(0, 8).map((p: any) => ({ ...p, value: toCr(p.value) }))} layout="vertical" margin={{ top: 0, right: 16, left: 80, bottom: 0 }}>
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
        {yoyLoading ? (
          <LoadingState label="Loading YoY data (reads all 4 sheets)…" />
        ) : !yoyData.length ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No YoY data available</p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={yoyData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${v}Cr`} />
              <Tooltip content={<CustomTooltip formatter={(v: number) => `₹${v} Cr`} />} />
              <Legend />
              {["2023-24", "2024-25", "2025-26", "2026-27"].map((fyKey, i) => (
                <Bar key={fyKey} dataKey={fyKey} fill={CHART_COLORS[i]} radius={[2, 2, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
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
    "Cocks Standard", "Cocks Premium", "Faucets & Jetsprays & Shower",
    "Accessories", "Cistern & Seat Cover", "Cabinet", "Ball Cock",
  ];

  const stackedData = useMemo(() => {
    if (!data) return [];
    return data.map((m: any) => {
      const row: any = { label: m.label };
      for (const cat of CATEGORIES) {
        row[cat] = m.byCategory[cat] ?? 0;
      }
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
          <p className="text-sm text-muted-foreground mt-0.5">PTMT 7-category plan · Live from Google Sheets</p>
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

      {isLoading && <LoadingState label="Reading PTMT production sheets (rate-limited, may take ~30s)…" />}
      {error && <ErrorState message="Could not load production data from PTMT sheets." />}

      {data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <KpiCard label="Months Available" value={String(totalMonths)} sub="From PTMT sheets" />
            <KpiCard label="Avg Monthly Plan" value={fmtQty(avgMonthly)} sub="Units across all categories" color={AMBER} />
            <KpiCard label="7 Categories" value="PTMT" sub="Cocks, Faucets, Cistern…" />
            <KpiCard label="Plan Column" value="P / O / M" sub="Era-aware (2020→2025)" />
          </div>

          {stackedData.length === 0 ? (
            <div className="bg-card border border-card-border rounded-lg p-12 text-center">
              <p className="text-sm text-muted-foreground">No production data could be parsed from the PTMT sheets.</p>
              <p className="text-xs text-muted-foreground mt-1">This may indicate the sheets need access permissions or the tab structure has changed.</p>
            </div>
          ) : (
            <>
              <div className="bg-card border border-card-border rounded-lg p-5 mb-5">
                <h3 className="text-sm font-semibold text-foreground mb-1">Monthly PTMT Plan · Units (Stacked by Category)</h3>
                <p className="text-xs text-muted-foreground mb-4">REPORT 1–7 summed per month</p>
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

              <div className="bg-card border border-card-border rounded-lg p-5">
                <h3 className="text-sm font-semibold text-foreground mb-4">Total Monthly Plan Trend</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={stackedData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtQty(v)} />
                    <Tooltip content={<CustomTooltip formatter={(v: number) => fmtQty(v)} />} />
                    <Line type="monotone" dataKey="total" name="Total Plan (units)" stroke={AMBER} strokeWidth={2} dot={{ r: 4, fill: AMBER }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </>
      )}
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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Sales</h1>
          <p className="text-sm text-muted-foreground mt-0.5">FY {fy} · 3-Year Sale Master</p>
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
                  <Area type="monotone" dataKey="Sales (₹ Cr)" stroke={GREEN} fill="url(#greenGrad)" strokeWidth={2} dot={{ r: 3 }} />
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
                  layout="vertical"
                  margin={{ top: 0, right: 16, left: 100, bottom: 0 }}
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

      <div className="bg-card border border-card-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wide text-muted-foreground">Name</th>
              <th className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wide text-muted-foreground">Domain</th>
              <th className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wide text-muted-foreground">FY</th>
              <th className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wide text-muted-foreground">Sheet ID</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s, i) => (
              <tr key={i} className={cn("border-b border-border last:border-0", i % 2 === 1 && "bg-muted/20")}>
                <td className="px-4 py-3 font-medium text-foreground">{s.label}</td>
                <td className="px-4 py-3">
                  <span className={cn(
                    "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium",
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
                    <a
                      href={`https://docs.google.com/spreadsheets/d/${s.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-primary hover:underline"
                    >
                      {s.id.slice(0, 20)}…
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 bg-muted/30 border border-border rounded-lg p-4 text-xs text-muted-foreground space-y-1.5">
        <p><strong className="text-foreground">Cache:</strong> All sheet reads are cached in-memory for 5 minutes. Use the Refresh button on each page to force a re-read.</p>
        <p><strong className="text-foreground">Rate limit:</strong> Google Sheets API allows ~60 requests/min. Multi-tab reads are throttled automatically.</p>
        <p><strong className="text-foreground">Channel rule:</strong> Orders are classified Retail unless STATE / STATE HEAD contains JJM, GEM, GOVT, or PROJECT.</p>
        <p><strong className="text-foreground">PTMT plan column:</strong> Era-aware — col M (2020), col O (2021–24), col P (2025–26).</p>
      </div>
    </div>
  );
}

// ─── Layout ───────────────────────────────────────────────────────────────────
function AppLayout({ children, fy, setFy }: { children: React.ReactNode; fy: string; setFy: (v: string) => void }) {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar fy={fy} setFy={setFy} />
      <main className="ml-56 flex-1 min-h-screen">
        <div className="max-w-[1200px] mx-auto px-6 py-6">{children}</div>
      </main>
    </div>
  );
}

// ─── Router ───────────────────────────────────────────────────────────────────
function AppRouter() {
  const [fy, setFy] = useState("2026-27");

  return (
    <AppLayout fy={fy} setFy={setFy}>
      <Switch>
        <Route path="/" component={() => <OverviewPage fy={fy} />} />
        <Route path="/orders" component={() => <OrdersPage fy={fy} />} />
        <Route path="/production" component={() => <ProductionPage />} />
        <Route path="/sales" component={() => <SalesPage fy={fy} />} />
        <Route path="/sources" component={() => <SourcesPage />} />
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

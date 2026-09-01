import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  Activity, 
  AlertTriangle, 
  CheckSquare, 
  ActivitySquare,
  PackageMinus,
  Settings,
  Sparkles,
  Factory,
  TrendingUp,
  Layers,
  BarChart2,
  ShieldAlert,
  ListChecks,
  SlidersHorizontal,
  FileText,
  Cpu,
  Tag,
  Upload,
  LogOut,
  Users,
  KeyRound,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { ChangePasswordDialog } from "@/components/change-password-dialog";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DatePreset, DateRange } from "@/hooks/use-date-filter";
import { useGetPlantBundle, getGetPlantBundleQueryKey, type PlantBundle } from "@workspace/api-client-react";
import { formatMonthLabel, preserveMonthInUrl, useMonth } from "@workspace/month-filter";
import { UnavailableMonthState } from "@/components/unavailable-month-state";

interface AppLayoutProps {
  children: React.ReactNode;
  month: string;
  preset: DatePreset;
  customMonth: string;
  dateRange: DateRange;
  setPreset: (p: DatePreset) => void;
  setCustomMonth: (m: string) => void;
  selectedCategory: string | null;
  setSelectedCategory: (c: string | null) => void;
}

const PRESET_LABELS: Record<DatePreset, string> = {
  "7d":    "Last 7 days",
  "15d":   "Last 15 days",
  "30d":   "Last 30 days",
  "mtd":   "Month to date",
  "month": "Month",
};

const PLANT_PATHS = new Set([
  "/plant", "/plant/velocity", "/plant/attainment", "/plant/warnings",
  "/plant/recommendations", "/plant/trend", "/plant/config", "/plant/reports", "/plant/categories",
  "/plant/plan-import",
]);

const PLUMBING_PATHS = new Set([
  "/plumbing", "/plumbing/velocity", "/plumbing/attainment", "/plumbing/warnings",
  "/plumbing/recommendations", "/plumbing/trend", "/plumbing/config", "/plumbing/reports",
  "/plumbing/plan-import", "/plumbing/machine-release", "/plumbing/machines",
  "/plumbing/quality", "/plumbing/actions", "/plumbing/backlog", "/plumbing/ai-analytics",
  "/plumbing/settings",
]);

const PLUMBING_CATEGORIES = [
  "CPVC Pipe", "CPVC Fitting", "CPVC Solvent",
  "UPVC Pipe", "UPVC Fitting", "UPVC Solvent",
  "SWR Pipe", "SWR Fitting", "SWR Solvent",
  "AGRI Pipe", "AGRI Fitting", "AGRI Solvent",
];

// ─── User controls (top-right of header) ─────────────────────────────────────
function UserControls() {
  const { user, logout } = useAuth();
  const [showChangePwd, setShowChangePwd] = useState(false);

  if (!user) return null;

  return (
    <>
      <div className="flex items-center gap-1.5 ml-2 shrink-0">
        {user.role === "admin" && (
          <a
            href="/monitoring/admin/users"
            className="flex items-center gap-1 h-7 px-2 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="User Management"
          >
            <Users size={13} /> <span className="hidden lg:inline">Users</span>
          </a>
        )}
        {user.mustChangePassword && (
          <span className="text-[11px] text-amber-600 bg-amber-500/10 rounded px-2 py-0.5 whitespace-nowrap">
            ⚠ Change password
          </span>
        )}
        <button
          onClick={() => setShowChangePwd(true)}
          className="h-7 px-2 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center gap-1"
          title="Change password"
        >
          <KeyRound size={13} />
        </button>
        <span className="text-xs text-muted-foreground max-w-[140px] truncate hidden sm:block" title={user.email}>
          {user.email}
        </span>
        <button
          onClick={() => void logout()}
          className="h-7 px-2 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center gap-1"
          title="Sign out"
        >
          <LogOut size={13} /> <span className="hidden lg:inline">Sign out</span>
        </button>
      </div>
      <ChangePasswordDialog
        open={showChangePwd || user.mustChangePassword}
        onOpenChange={setShowChangePwd}
        required={user.mustChangePassword}
      />
    </>
  );
}

// ─── Cross-App Nav ────────────────────────────────────────────────────────────
function CrossAppNav() {
  const { month, isFallback } = useMonth();
  const path = window.location.pathname;
  const isOps = path.startsWith("/ops-dashboard");
  const isMon = path.startsWith("/monitoring");
  const isProducts = path === "/products" || path.startsWith("/products/");
  const isAlerts = path === "/alerts" || path.startsWith("/alerts/");
  const isPlanning = !isOps && !isMon && !isProducts && !isAlerts;
  const tabs = [
    { label: "Ops Dashboard",         href: "/ops-dashboard/", active: isOps },
    { label: "Production Monitoring", href: "/monitoring/plant", active: isMon },
    { label: "Production Planning",   href: "/",              active: isPlanning },
    { label: "Products",              href: "/products",       active: isProducts },
    { label: "Alerts",                href: "/alerts",         active: isAlerts },
  ];
  const hrefForMonth = (href: string) =>
    isFallback ? href : `${href}?month=${encodeURIComponent(month)}`;
  return (
    <nav className="fixed top-0 left-0 right-0 z-30 h-9 flex items-center px-4 gap-1 border-b border-sidebar-border bg-sidebar">
      <span className="text-[11px] font-bold mr-3" style={{ color: "hsl(38 90% 48%)" }}>prayag</span>
      {tabs.map((app) => (
        <a key={app.href} href={hrefForMonth(app.href)}
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

export function AppLayout({
  children, month, preset, customMonth, dateRange,
  setPreset, setCustomMonth, selectedCategory, setSelectedCategory,
}: AppLayoutProps) {
  const [location] = useLocation();
  const monthState = useMonth();
  const isPlantPage    = PLANT_PATHS.has(location);
  const isPlumbingPage = PLUMBING_PATHS.has(location) || location.startsWith("/plumbing");

  const { data: bundleRaw } = useGetPlantBundle(
    { month },
    {
      query: {
        queryKey: getGetPlantBundleQueryKey({ month }),
        enabled: isPlantPage && !monthState.isAvailableMonthsLoading && monthState.isMonthAvailable,
      },
    }
  ) as { data: unknown };
  const bundle = bundleRaw as PlantBundle | undefined;
  const categoryOptions: string[] = isPlumbingPage
    ? PLUMBING_CATEGORIES
    : bundle?.categories?.map((c) => c.category) ?? [];

  useEffect(() => {
    preserveMonthInUrl(
      monthState.month,
      !monthState.isFallback && !monthState.isAvailableMonthsLoading,
    );
  }, [location, monthState.isAvailableMonthsLoading, monthState.isFallback, monthState.month]);

  // The filter is shared across both segments. Do not keep a PTMT category
  // selected after navigating to Plumbing (or vice versa), otherwise every
  // page receives a category that does not exist in its current data set.
  useEffect(() => {
    if (selectedCategory && categoryOptions.length > 0 && !categoryOptions.includes(selectedCategory)) {
      setSelectedCategory(null);
    }
  }, [selectedCategory, setSelectedCategory, categoryOptions.join("|")]);

  const plantNavItems = [
    { href: "/plant",                  label: "Control Board",    icon: Factory           },
    { href: "/plant/velocity",         label: "Velocity",         icon: TrendingUp        },
    { href: "/plant/attainment",       label: "Attainment",       icon: Layers            },
    { href: "/plant/warnings",         label: "Warnings",         icon: ShieldAlert       },
    { href: "/plant/recommendations",  label: "Recommendations",  icon: ListChecks        },
    { href: "/plant/trend",            label: "Trend",            icon: BarChart2         },
    { href: "/plant/categories",      label: "Category Breakdown", icon: Tag              },
    { href: "/plant/config",           label: "Config",           icon: SlidersHorizontal },
    { href: "/plant/plan-import",      label: "Plan Import",      icon: Upload            },
    { href: "/plant/reports",          label: "Reports",          icon: FileText          },
    { href: "/actions",                label: "Actions",          icon: CheckSquare       },
    { href: "/backlog",                label: "Backlog",          icon: PackageMinus      },
    { href: "/ai-analytics",           label: "AI Analytics",     icon: Sparkles          },
    { href: "/settings",               label: "Settings",         icon: Settings          },
  ];

  const machineNavItems = [
    { href: "/machines",      label: "Dashboard",    icon: LayoutDashboard },
    { href: "/velocity",      label: "Velocity",     icon: Activity        },
    { href: "/warnings",      label: "Warnings",     icon: AlertTriangle   },
    { href: "/quality",       label: "Quality",      icon: ActivitySquare  },
  ];

  function navLink(item: { href: string; label: string; icon: React.ElementType }) {
    const active = location === item.href;
    return (
      <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={cn(
        "flex items-center gap-3 px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground border-l-2 border-sidebar-primary"
          : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground border-l-2 border-transparent"
      )}>
        <item.icon className="h-4 w-4" />
        {item.label}
      </Link>
    );
  }

  function sectionLabel(label: string, Icon: React.ElementType) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 mb-1">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
    );
  }

  return (
    <>
    <CrossAppNav />
    <div className="flex min-h-screen overflow-x-hidden bg-background text-foreground pt-9">
      {/* Sidebar */}
      <div className="sticky top-9 z-20 flex h-[calc(100vh-2.25rem)] w-64 flex-shrink-0 flex-col overflow-hidden bg-sidebar border-r border-sidebar-border">
        <div className="p-6 border-b border-sidebar-border">
          <div className="flex items-center gap-3 font-bold text-sidebar-primary tracking-tight uppercase text-xl">
            <div className="w-4 h-4 bg-sidebar-primary"></div>
            {isPlumbingPage ? "Plumbing Mon" : "PTMT Mon"}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-4 space-y-4">
          {isPlumbingPage ? (
            <>
              <div className="px-3">
                {sectionLabel("Plant Level", Factory)}
                <nav className="space-y-1">
                  {navLink({ href: "/plumbing",                  label: "Plan Overview",    icon: LayoutDashboard   })}
                  {navLink({ href: "/plumbing/velocity",          label: "Velocity",         icon: TrendingUp        })}
                  {navLink({ href: "/plumbing/attainment",        label: "Attainment",       icon: Layers            })}
                  {navLink({ href: "/plumbing/warnings",          label: "Warnings",         icon: ShieldAlert       })}
                  {navLink({ href: "/plumbing/recommendations",   label: "Recommendations",  icon: ListChecks        })}
                  {navLink({ href: "/plumbing/trend",             label: "Trend",            icon: BarChart2         })}
                  {navLink({ href: "/plumbing/config",            label: "Config",           icon: SlidersHorizontal })}
                  {navLink({ href: "/plumbing/plan-import",       label: "Plan Import",      icon: Upload            })}
                  {navLink({ href: "/plumbing/reports",           label: "Reports",          icon: FileText          })}
                   {navLink({ href: "/plumbing/actions",            label: "Actions",          icon: CheckSquare       })}
                   {navLink({ href: "/plumbing/backlog",            label: "Backlog",          icon: PackageMinus      })}
                   {navLink({ href: "/plumbing/ai-analytics",       label: "AI Analytics",     icon: Sparkles          })}
                   {navLink({ href: "/plumbing/settings",            label: "Settings",         icon: Settings          })}
                </nav>
              </div>
              <div className="px-3">
                {sectionLabel("Machine Level", Cpu)}
                <nav className="space-y-1">
                  {navLink({ href: "/plumbing/machine-release", label: "Machine Release", icon: SlidersHorizontal })}
                  {navLink({ href: "/plumbing/machines",        label: "Dashboard",       icon: LayoutDashboard   })}
                   {navLink({ href: "/plumbing/velocity",         label: "Velocity",        icon: Activity          })}
                   {navLink({ href: "/plumbing/warnings",         label: "Warnings",        icon: AlertTriangle     })}
                  {navLink({ href: "/plumbing/quality",         label: "Quality",         icon: ActivitySquare    })}
                </nav>
              </div>
            </>
          ) : (
            <>
              <div className="px-3">
                {sectionLabel("Plant Level", Factory)}
                <nav className="space-y-1">{plantNavItems.map(navLink)}</nav>
              </div>
              <div className="px-3">
                {sectionLabel("Machine Level", Cpu)}
                <nav className="space-y-1">{machineNavItems.map(navLink)}</nav>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="relative z-30 min-h-16 shrink-0 border-b border-border bg-card px-4 py-3 shadow-sm sm:px-6 lg:px-8">
          <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex min-w-0 basis-full items-center gap-3 xl:flex-1 xl:basis-auto">
              <h1 className="shrink-0 whitespace-nowrap text-base font-semibold sm:text-lg">Production Performance &amp; Monitoring</h1>
              {/* PTMT / Plumbing segment toggle */}
              <div className="flex shrink-0 gap-0.5 rounded-md bg-muted p-0.5 text-sm">
                  <a
                  href={monthState.isFallback ? "/monitoring/plant" : `/monitoring/plant?month=${encodeURIComponent(monthState.month)}`}
                  className={cn(
                    "rounded px-3 py-1 transition-colors",
                    !isPlumbingPage
                      ? "bg-background font-medium text-foreground shadow"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >PTMT</a>
                  <a
                  href={monthState.isFallback ? "/monitoring/plumbing" : `/monitoring/plumbing?month=${encodeURIComponent(monthState.month)}`}
                  className={cn(
                    "rounded px-3 py-1 transition-colors",
                    isPlumbingPage
                      ? "bg-background font-medium text-foreground shadow"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >Plumbing</a>
              </div>
            </div>

            <div className="flex min-w-0 basis-full flex-wrap items-center justify-end gap-2 xl:basis-auto">
              {/* Type (category) filter — available for both PTMT and Plumbing plant views */}
              {(isPlantPage || isPlumbingPage) && categoryOptions.length > 0 && (
                <Select
                  value={selectedCategory ?? "__all__"}
                  onValueChange={(v) => setSelectedCategory(v === "__all__" ? null : v)}
                >
                  <SelectTrigger className="h-8 w-44 text-sm">
                    <Tag className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
                    <SelectValue placeholder="All Types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All Types</SelectItem>
                    {categoryOptions.map((cat) => (
                      <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {/* Date range dropdown */}
              <Select value={preset} onValueChange={(v) => setPreset(v as DatePreset)}>
                <SelectTrigger className="h-8 w-44 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PRESET_LABELS) as DatePreset[]).map((key) => (
                    <SelectItem key={key} value={key}>
                      {PRESET_LABELS[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Month picker — only when "Month" is selected */}
              {preset === "month" && (
                <select
                  aria-label="Plan month"
                  value={monthState.month}
                  onChange={(e) => setCustomMonth(e.target.value)}
                  className="h-8 max-w-52 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {!monthState.availableMonths.includes(monthState.currentMonth) && (
                    <option value={monthState.currentMonth}>{formatMonthLabel(monthState.currentMonth)} (current)</option>
                  )}
                  {monthState.availableMonths.map((availableMonth) => (
                    <option key={availableMonth} value={availableMonth}>{formatMonthLabel(availableMonth)}</option>
                  ))}
                  {!monthState.isAvailableMonthsLoading && !monthState.isMonthAvailable && !monthState.availableMonths.includes(monthState.month) && (
                    <option value={monthState.month}>{formatMonthLabel(monthState.month)} (selected)</option>
                  )}
                </select>
              )}

              {/* Date range badge for non-month presets */}
              {preset !== "month" && (
                <span className="whitespace-nowrap rounded-md bg-muted px-3 py-1.5 text-xs text-muted-foreground">
                  {dateRange.start} – {dateRange.end}
                </span>
              )}

              {/* ── User / Auth controls ── */}
              <UserControls />
            </div>
          </div>
        </header>

        <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4 sm:p-6 lg:p-8">
          {monthState.isFallback && monthState.fallbackFrom && (
            <div role="status" className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
              <strong>
                Showing {formatMonthLabel(monthState.month)} — {formatMonthLabel(monthState.fallbackFrom)} has not run yet.
              </strong>
              <span>{formatMonthLabel(monthState.fallbackFrom)}'s input files have not been uploaded.</span>
              <button
                type="button"
                onClick={() => monthState.setMonth(monthState.fallbackFrom!)}
                className="font-semibold underline underline-offset-2"
              >
                View {formatMonthLabel(monthState.fallbackFrom)}
              </button>
              <a
                href={`/?month=${encodeURIComponent(monthState.fallbackFrom)}`}
                className="font-semibold underline underline-offset-2"
              >
                Go to Data
              </a>
            </div>
          )}
          {monthState.invalidMonth && (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              “{monthState.invalidMonth}” is not a valid month. Showing {formatMonthLabel(monthState.month)}.
            </div>
          )}
          {monthState.isAvailableMonthsLoading
            ? <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">Loading available months…</div>
            : !monthState.isMonthAvailable
            ? <UnavailableMonthState />
            : children}
        </main>
      </div>
    </div>
    </>
  );
}

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
} from "lucide-react";
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
]);

// ─── Cross-App Nav ────────────────────────────────────────────────────────────
function CrossAppNav() {
  const path = window.location.pathname;
  const isOps = path.startsWith("/ops-dashboard");
  const isMon = path.startsWith("/monitoring");
  const tabs = [
    { label: "Ops Dashboard",         href: "/ops-dashboard/", active: isOps },
    { label: "Production Monitoring", href: "/monitoring/plant", active: isMon },
    { label: "Production Planning",   href: "/",              active: !isOps && !isMon },
  ];
  return (
    <nav className="fixed top-0 left-0 right-0 z-30 h-9 flex items-center px-4 gap-1 border-b border-sidebar-border bg-sidebar">
      <span className="text-[11px] font-bold mr-3" style={{ color: "hsl(38 90% 48%)" }}>prayag</span>
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

export function AppLayout({
  children, month, preset, customMonth, dateRange,
  setPreset, setCustomMonth, selectedCategory, setSelectedCategory,
}: AppLayoutProps) {
  const [location] = useLocation();
  const isPlantPage = PLANT_PATHS.has(location);

  const { data: bundleRaw } = useGetPlantBundle(
    { month },
    { query: { queryKey: getGetPlantBundleQueryKey({ month }), enabled: isPlantPage } }
  ) as { data: unknown };
  const bundle = bundleRaw as PlantBundle | undefined;
  const categoryOptions: string[] = bundle?.categories?.map((c) => c.category) ?? [];

  const plantNavItems = [
    { href: "/plant",                  label: "Control Board",    icon: Factory           },
    { href: "/plant/velocity",         label: "Velocity",         icon: TrendingUp        },
    { href: "/plant/attainment",       label: "Attainment",       icon: Layers            },
    { href: "/plant/warnings",         label: "Warnings",         icon: ShieldAlert       },
    { href: "/plant/recommendations",  label: "Recommendations",  icon: ListChecks        },
    { href: "/plant/trend",            label: "Trend",            icon: BarChart2         },
    { href: "/plant/config",           label: "Config",           icon: SlidersHorizontal },
    { href: "/plant/reports",          label: "Reports",          icon: FileText          },
  ];

  const machineNavItems = [
    { href: "/",              label: "Dashboard",    icon: LayoutDashboard },
    { href: "/velocity",      label: "Velocity",     icon: Activity        },
    { href: "/warnings",      label: "Warnings",     icon: AlertTriangle   },
    { href: "/actions",       label: "Actions",      icon: CheckSquare     },
    { href: "/quality",       label: "Quality",      icon: ActivitySquare  },
    { href: "/backlog",       label: "Backlog",      icon: PackageMinus    },
    { href: "/ai-analytics",  label: "AI Analytics", icon: Sparkles        },
    { href: "/settings",      label: "Settings",     icon: Settings        },
  ];

  function navLink(item: { href: string; label: string; icon: React.ElementType }) {
    const active = location === item.href;
    return (
      <Link key={item.href} href={item.href} className={cn(
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
    <div className="flex min-h-screen bg-background text-foreground pt-9">
      {/* Sidebar */}
      <div className="w-64 flex-shrink-0 bg-sidebar border-r border-sidebar-border flex flex-col">
        <div className="p-6 border-b border-sidebar-border">
          <div className="flex items-center gap-3 font-bold text-sidebar-primary tracking-tight uppercase text-xl">
            <div className="w-4 h-4 bg-sidebar-primary"></div>
            PTMT Mon
          </div>
        </div>
        <div className="flex-1 overflow-y-auto py-4 space-y-4">
          <div className="px-3">
            {sectionLabel("Plant Level", Factory)}
            <nav className="space-y-1">{plantNavItems.map(navLink)}</nav>
          </div>
          <div className="px-3">
            {sectionLabel("Machine Level", Cpu)}
            <nav className="space-y-1">{machineNavItems.map(navLink)}</nav>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b border-border bg-card shrink-0 sticky top-0 z-10 flex items-center justify-between px-8">
          <h1 className="font-semibold text-lg">Production Performance &amp; Monitoring</h1>

          <div className="flex items-center gap-3">
            {/* Type (category) filter — only on plant pages */}
            {isPlantPage && categoryOptions.length > 0 && (
              <Select
                value={selectedCategory ?? "__all__"}
                onValueChange={(v) => setSelectedCategory(v === "__all__" ? null : v)}
              >
                <SelectTrigger className="w-44 h-8 text-sm">
                  <Tag className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
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
              <SelectTrigger className="w-44 h-8 text-sm">
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
              <input
                type="month"
                value={customMonth}
                onChange={(e) => setCustomMonth(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            )}

            {/* Date range badge for non-month presets */}
            {preset !== "month" && (
              <span className="text-xs text-muted-foreground bg-muted px-3 py-1.5 rounded-md whitespace-nowrap">
                {dateRange.start} – {dateRange.end}
              </span>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-auto p-8">{children}</main>
      </div>
    </div>
    </>
  );
}

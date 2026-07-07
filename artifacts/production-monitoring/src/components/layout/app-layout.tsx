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
  CalendarDays,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DatePreset, DateRange } from "@/hooks/use-date-filter";

interface AppLayoutProps {
  children: React.ReactNode;
  month: string;
  preset: DatePreset;
  customMonth: string;
  dateRange: DateRange;
  setPreset: (p: DatePreset) => void;
  setCustomMonth: (m: string) => void;
}

const PRESETS: { key: DatePreset; label: string }[] = [
  { key: "7d",    label: "7D"    },
  { key: "15d",   label: "15D"   },
  { key: "30d",   label: "30D"   },
  { key: "mtd",   label: "MTD"   },
  { key: "month", label: "Month" },
];

export function AppLayout({ children, preset, customMonth, dateRange, setPreset, setCustomMonth }: AppLayoutProps) {
  const [location] = useLocation();

  const plantNavItems = [
    { href: "/plant",                  label: "Control Board",    icon: Factory        },
    { href: "/plant/velocity",         label: "Velocity",         icon: TrendingUp     },
    { href: "/plant/attainment",       label: "Attainment",       icon: Layers         },
    { href: "/plant/warnings",         label: "Warnings",         icon: ShieldAlert    },
    { href: "/plant/recommendations",  label: "Recommendations",  icon: ListChecks     },
    { href: "/plant/trend",            label: "Trend",            icon: BarChart2      },
    { href: "/plant/config",           label: "Config",           icon: SlidersHorizontal },
    { href: "/plant/reports",          label: "Reports",          icon: FileText       },
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

  const rangeLabel = preset === "month"
    ? dateRange.month
    : `${dateRange.start} → ${dateRange.end}`;

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Sidebar */}
      <div className="w-64 flex-shrink-0 bg-sidebar border-r border-sidebar-border flex flex-col">
        <div className="p-6 border-b border-sidebar-border">
          <div className="flex items-center gap-3 font-bold text-sidebar-primary tracking-tight uppercase text-xl">
            <div className="w-4 h-4 bg-sidebar-primary"></div>
            PTMT Mon
          </div>
        </div>
        <div className="flex-1 overflow-y-auto py-4 space-y-4">
          {/* Plant Level */}
          <div className="px-3">
            {sectionLabel("Plant Level", Factory)}
            <nav className="space-y-1">
              {plantNavItems.map(navLink)}
            </nav>
          </div>

          {/* Machine Level */}
          <div className="px-3">
            {sectionLabel("Machine Level", Cpu)}
            <nav className="space-y-1">
              {machineNavItems.map(navLink)}
            </nav>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-auto border-b border-border bg-card shrink-0 sticky top-0 z-10">
          <div className="flex items-center justify-between px-8 h-16">
            <h1 className="font-semibold text-lg">Production Performance &amp; Monitoring</h1>
            <div className="flex items-center gap-2">
              {/* Preset buttons */}
              <div className="flex items-center rounded-md border border-input overflow-hidden divide-x divide-input">
                {PRESETS.map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setPreset(key)}
                    className={cn(
                      "px-3 py-1.5 text-xs font-medium transition-colors",
                      preset === key
                        ? "bg-primary text-primary-foreground"
                        : "bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {/* Month picker — only shown when preset is "month" */}
              {preset === "month" && (
                <input
                  type="month"
                  value={customMonth}
                  onChange={(e) => setCustomMonth(e.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              )}
              {/* Range indicator for non-month presets */}
              {preset !== "month" && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted px-3 py-1.5 rounded-md">
                  <CalendarDays className="h-3.5 w-3.5" />
                  <span>{rangeLabel}</span>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-8">
          {children}
        </main>
      </div>
    </div>
  );
}

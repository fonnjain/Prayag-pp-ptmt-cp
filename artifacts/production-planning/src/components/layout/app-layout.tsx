import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import {
  UploadCloud,
  LayoutGrid,
  History,
  Download,
  Wrench,
  ChevronRight,
  RefreshCw,
} from "lucide-react";

export const CATEGORIES = [
  "Cocks Standard",
  "Cocks Premium",
  "Faucets & Jetsprays & Shower",
  "Accessorise",
  "Cistern & Seat Cover",
  "Cabinet",
  "Ball Cock",
];

export function categorySlug(name: string): string {
  return encodeURIComponent(name.toLowerCase().replace(/\s+/g, "-"));
}

type NavItem = { href: string; label: string; icon?: React.ReactNode };

const OVERVIEW_LINKS: NavItem[] = [
  { href: "/", label: "Data", icon: <UploadCloud size={15} /> },
  { href: "/summary", label: "Summary", icon: <LayoutGrid size={15} /> },
];

const ACTION_LINKS: NavItem[] = [
  { href: "/runs", label: "Plan Runs", icon: <History size={15} /> },
  { href: "/corrective", label: "Corrective Plan", icon: <RefreshCw size={15} /> },
  { href: "/export", label: "Export", icon: <Download size={15} /> },
];

function SidebarGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70 select-none">
        {label}
      </p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function SidebarLink({ href, label, icon }: NavItem) {
  const [location] = useLocation();
  const isActive = location === href;

  return (
    <Link href={href}>
      <span
        className={cn(
          "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm cursor-pointer transition-colors",
          isActive
            ? "bg-primary text-primary-foreground font-medium"
            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        )}
      >
        {icon && <span className="shrink-0 opacity-70">{icon}</span>}
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

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <CrossAppNav />
      <div className="flex min-h-screen bg-background pt-9">
      <aside className="fixed top-9 left-0 bottom-0 z-20 flex w-56 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="px-5 pt-5 pb-4 border-b border-sidebar-border">
          <div className="text-[22px] font-bold tracking-tight leading-none" style={{ color: "hsl(38 90% 48%)" }}>
            prayag
          </div>
          <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            PTMT Production
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-5">
          <SidebarGroup label="Overview">
            {OVERVIEW_LINKS.map((l) => (
              <SidebarLink key={l.href} {...l} />
            ))}
          </SidebarGroup>

          <SidebarGroup label="Categories">
            {CATEGORIES.map((c) => (
              <SidebarLink
                key={c}
                href={`/category/${categorySlug(c)}`}
                label={c}
                icon={<Wrench size={13} />}
              />
            ))}
          </SidebarGroup>

          <SidebarGroup label="Actions">
            {ACTION_LINKS.map((l) => (
              <SidebarLink key={l.href} {...l} />
            ))}
          </SidebarGroup>
        </nav>

        <div className="px-4 py-3 border-t border-sidebar-border">
          <p className="text-[10px] text-muted-foreground/60 select-none">PTMT Daily Planning</p>
        </div>
      </aside>

      <main className="ml-56 flex-1 min-h-screen">
        <div className="max-w-5xl mx-auto px-6 py-6">{children}</div>
      </main>
    </div>
    </>
  );
}

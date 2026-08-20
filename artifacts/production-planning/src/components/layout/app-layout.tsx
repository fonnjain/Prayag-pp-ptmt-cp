import { useState } from "react";
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
  LogOut,
  Users,
  KeyRound,
} from "lucide-react";
import { useSegment, type Segment } from "@/contexts/segment-context";
import { useListBufferCategories, type BufferCategory } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/auth-context";
import { ChangePasswordDialog } from "@/components/change-password-dialog";

import { categorySlug } from "@/lib/category-slug";

type NavItem = { href: string; label: string; icon?: React.ReactNode };

const OVERVIEW_LINKS: NavItem[] = [
  { href: "/", label: "Data", icon: <UploadCloud size={15} /> },
  { href: "/summary", label: "Summary", icon: <LayoutGrid size={15} /> },
];

const PTMT_ACTION_LINKS: NavItem[] = [
  { href: "/runs", label: "Plan Runs", icon: <History size={15} /> },
  { href: "/corrective", label: "Corrective Plan", icon: <RefreshCw size={15} /> },
  { href: "/export", label: "Export", icon: <Download size={15} /> },
];

const PLUMBING_ACTION_LINKS: NavItem[] = [
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
  const isActive = location === href || (href !== "/" && location.startsWith(href));

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

function SegmentToggle() {
  const { segment, setSegment } = useSegment();
  const [, navigate] = useLocation();

  const handleSwitch = (s: Segment) => {
    if (s === segment) return;
    setSegment(s);
    navigate("/summary");
  };

  return (
    <div className="flex rounded-md overflow-hidden border border-sidebar-border text-[11px] font-semibold select-none">
      <button
        onClick={() => handleSwitch("PTMT")}
        className={cn(
          "flex-1 py-1.5 text-center transition-colors",
          segment === "PTMT"
            ? "bg-amber-500 text-white"
            : "text-muted-foreground hover:bg-sidebar-accent",
        )}
      >
        PTMT
      </button>
      <button
        onClick={() => handleSwitch("Plumbing")}
        className={cn(
          "flex-1 py-1.5 text-center transition-colors",
          segment === "Plumbing"
            ? "bg-blue-600 text-white"
            : "text-muted-foreground hover:bg-sidebar-accent",
        )}
      >
        Plumbing
      </button>
    </div>
  );
}

// ─── Sidebar user section ─────────────────────────────────────────────────────
function SidebarUserSection() {
  const { user, logout } = useAuth();
  const [showChangePwd, setShowChangePwd] = useState(false);

  if (!user) return null;

  return (
    <>
      <div className="border-t border-sidebar-border px-3 py-3 space-y-1.5">
        {/* Admin: user management link */}
        {user.role === "admin" && (
          <Link href="/admin/users">
            <span className="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-sidebar-accent cursor-pointer transition-colors">
              <Users size={13} /> User Management
            </span>
          </Link>
        )}

        {/* Must-change-password warning */}
        {user.mustChangePassword && (
          <button
            onClick={() => setShowChangePwd(true)}
            className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-amber-600 hover:bg-amber-500/10 cursor-pointer transition-colors"
          >
            <KeyRound size={12} /> ⚠ Change password
          </button>
        )}

        {/* User email */}
        <div className="px-2">
          <p className="text-[11px] text-muted-foreground truncate" title={user.email}>{user.email}</p>
          <p className="text-[10px] text-muted-foreground/50 capitalize">{user.role}</p>
        </div>

        {/* Actions row */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowChangePwd(true)}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors"
            title="Change password"
          >
            <KeyRound size={11} /> Change password
          </button>
          <div className="flex-1" />
          <button
            onClick={() => void logout()}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors"
            title="Sign out"
          >
            <LogOut size={11} /> Sign out
          </button>
        </div>
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
  const { segment } = useSegment();
  const { data: catData } = useListBufferCategories({ segment } as any);
  const categories = (catData as unknown as BufferCategory[] | undefined) ?? [];
  const actionLinks = segment === "Plumbing" ? PLUMBING_ACTION_LINKS : PTMT_ACTION_LINKS;
  const accentColor = segment === "Plumbing" ? "hsl(221 83% 53%)" : "hsl(38 90% 48%)";

  return (
    <>
      <CrossAppNav />
      <div className="flex min-h-screen bg-background pt-9">
        <aside className="fixed top-9 left-0 bottom-0 z-20 flex w-56 flex-col border-r border-sidebar-border bg-sidebar">
          <div className="px-4 pt-4 pb-3 border-b border-sidebar-border space-y-2.5">
            <div>
              <div className="text-[22px] font-bold tracking-tight leading-none" style={{ color: accentColor }}>
                prayag
              </div>
              <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                {segment} Production
              </div>
            </div>
            <SegmentToggle />
          </div>

          <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-5">
            <SidebarGroup label="Overview">
              {OVERVIEW_LINKS.map((l) => (
                <SidebarLink key={l.href} {...l} />
              ))}
            </SidebarGroup>

            <SidebarGroup label="Categories">
              {categories.length === 0 ? (
                <p className="px-3 text-xs text-muted-foreground/60 italic">Loading…</p>
              ) : (
                categories.map((c) => (
                  <SidebarLink
                    key={c.name}
                    href={`/category/${categorySlug(c.name)}`}
                    label={c.name}
                    icon={<Wrench size={13} />}
                  />
                ))
              )}
            </SidebarGroup>

            <SidebarGroup label="Actions">
              {actionLinks.map((l) => (
                <SidebarLink key={l.href} {...l} />
              ))}
            </SidebarGroup>
          </nav>

          {/* ── User / Auth controls ── */}
          <SidebarUserSection />
        </aside>

        <main className="ml-56 flex-1 min-h-screen">
          <div className="max-w-5xl mx-auto px-6 py-6">{children}</div>
        </main>
      </div>
    </>
  );
}

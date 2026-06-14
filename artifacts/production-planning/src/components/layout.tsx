import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useData } from "@/lib/data-provider";
import { formatDate } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, FileSpreadsheet, Database, FileText, Settings, History, LogOut, Menu, X, Lock } from "lucide-react";

export function Layout({ children }: { children: React.ReactNode }) {
  const { division, setDivision, planMonth, setPlanMonth, role, user, logout, divisionHasData } = useData();
  const [location, setLocation] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Gate on whether the division has ANY pulled data — not the selected month —
  // because a pull loads full history and changing the month just re-runs the engine.
  const hasData = divisionHasData;

  const handleLogout = async () => {
    setMobileMenuOpen(false);
    await logout();
    setLocation("/login");
  };

  // Sequence: Data → Plan → Reports. Dashboard always available and unchanged.
  // Everything that consumes pulled data is locked until a pull exists for the
  // current division/month.
  const navItems = [
    { label: "Dashboard", href: "/", icon: LayoutDashboard, roles: ["admin", "planner", "viewer"], requiresData: false },
    { label: "Data", href: "/data", icon: Database, roles: ["admin", "planner"], requiresData: false },
    { label: "Plan", href: "/plan", icon: FileSpreadsheet, roles: ["admin", "planner", "viewer"], requiresData: true },
    { label: "Reports", href: "/reports", icon: FileText, roles: ["admin", "planner", "viewer"], requiresData: true },
    { label: "Settings", href: "/settings", icon: Settings, roles: ["admin"], requiresData: true },
    { label: "Legacy Import", href: "/legacy", icon: History, roles: ["admin"], requiresData: true },
  ];

  return (
    <div className="min-h-screen bg-muted/30 flex flex-col md:flex-row">
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between p-4 bg-card border-b">
        <div className="flex items-center gap-3">
          <div className="font-bold text-lg text-primary">Prayag PP</div>
          <span className="text-xs text-muted-foreground">{formatDate(new Date())}</span>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
          {mobileMenuOpen ? <X /> : <Menu />}
        </Button>
      </div>

      {/* Sidebar */}
      <aside className={`${mobileMenuOpen ? 'flex' : 'hidden'} md:flex flex-col w-full md:w-64 bg-card border-r flex-shrink-0 z-50`}>
        <div className="hidden md:flex h-16 items-center px-6 border-b font-bold text-xl text-primary">
          Prayag Planning
        </div>

        <div className="p-4 space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Division</label>
            <Select value={division} onValueChange={(v: any) => setDivision(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PTMT">PTMT</SelectItem>
                <SelectItem value="CP">CP</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Plan Month</label>
            <Select value={planMonth} onValueChange={setPlanMonth}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2026-04">Apr 2026</SelectItem>
                <SelectItem value="2026-05">May 2026</SelectItem>
                <SelectItem value="2026-06">Jun 2026</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
          {navItems.filter(item => item.roles.includes(role)).map(item => {
            const isActive = location === item.href;
            const locked = item.requiresData && !hasData;
            if (locked) {
              return (
                <div
                  key={item.href}
                  title="Pull data first to unlock"
                  className="flex items-center gap-3 px-3 py-2 rounded-md text-muted-foreground/50 cursor-not-allowed select-none"
                >
                  <item.icon className="h-4 w-4" />
                  <span className="flex-1">{item.label}</span>
                  <Lock className="h-3.5 w-3.5" />
                </div>
              );
            }
            return (
              <Link key={item.href} href={item.href}>
                <div className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors cursor-pointer ${isActive ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`} onClick={() => setMobileMenuOpen(false)}>
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t space-y-3">
          <div className="space-y-0.5">
            <div className="text-sm font-medium truncate">{user?.name ?? user?.email ?? "Signed in"}</div>
            <div className="text-xs text-muted-foreground capitalize">{role}</div>
          </div>
          <Button variant="ghost" className="w-full justify-start gap-2 h-8 text-muted-foreground hover:text-foreground" onClick={handleLogout}>
            <LogOut className="h-4 w-4" /> Sign Out
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="hidden md:flex h-16 items-center justify-end px-8 border-b bg-card/50 flex-shrink-0">
          <span className="text-sm text-muted-foreground">Today: <span className="font-medium text-foreground">{formatDate(new Date())}</span></span>
        </div>
        <div className="flex-1 p-4 md:p-8 overflow-y-auto">
          <div className="max-w-7xl mx-auto space-y-6">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}

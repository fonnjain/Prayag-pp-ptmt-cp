import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useData } from "@/lib/data-provider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, FileSpreadsheet, Database, FileText, Settings, History, LogOut, Menu, X } from "lucide-react";

export function Layout({ children }: { children: React.ReactNode }) {
  const { division, setDivision, planMonth, setPlanMonth, role, setRole } = useData();
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems = [
    { label: "Dashboard", href: "/", icon: LayoutDashboard, roles: ["admin", "planner", "viewer"] },
    { label: "Plan", href: "/plan", icon: FileSpreadsheet, roles: ["admin", "planner", "viewer"] },
    { label: "Data", href: "/data", icon: Database, roles: ["admin", "planner"] },
    { label: "Reports", href: "/reports", icon: FileText, roles: ["admin", "planner", "viewer"] },
    { label: "Settings", href: "/settings", icon: Settings, roles: ["admin"] },
    { label: "Legacy Import", href: "/legacy", icon: History, roles: ["admin"] },
  ];

  return (
    <div className="min-h-screen bg-muted/30 flex flex-col md:flex-row">
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between p-4 bg-card border-b">
        <div className="font-bold text-lg text-primary">Prayag PP</div>
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
                <SelectItem value="2024-02">Feb 2024</SelectItem>
                <SelectItem value="2024-03">Mar 2024</SelectItem>
                <SelectItem value="2024-04">Apr 2024</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
          {navItems.filter(item => item.roles.includes(role)).map(item => {
            const isActive = location === item.href;
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

        <div className="p-4 border-t space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Demo Role</label>
            <Select value={role} onValueChange={(v: any) => setRole(v)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="planner">Planner</SelectItem>
                <SelectItem value="viewer">Viewer</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Link href="/login">
            <Button variant="ghost" className="w-full justify-start gap-2 h-8 text-muted-foreground hover:text-foreground" onClick={() => setMobileMenuOpen(false)}>
              <LogOut className="h-4 w-4" /> Sign Out
            </Button>
          </Link>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="flex-1 p-4 md:p-8 overflow-y-auto">
          <div className="max-w-7xl mx-auto space-y-6">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}

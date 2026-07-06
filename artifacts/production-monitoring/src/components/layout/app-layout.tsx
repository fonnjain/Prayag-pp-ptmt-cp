import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  Activity, 
  AlertTriangle, 
  CheckSquare, 
  ActivitySquare,
  PackageMinus,
  Settings
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

export function AppLayout({ children, month, setMonth }: { children: React.ReactNode, month: string, setMonth: (m: string) => void }) {
  const [location] = useLocation();

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/velocity", label: "Velocity", icon: Activity },
    { href: "/warnings", label: "Warnings", icon: AlertTriangle },
    { href: "/actions", label: "Actions", icon: CheckSquare },
    { href: "/quality", label: "Quality", icon: ActivitySquare },
    { href: "/backlog", label: "Backlog", icon: PackageMinus },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

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
        <div className="flex-1 overflow-y-auto py-4">
          <nav className="space-y-1 px-3">
            {navItems.map((item) => {
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
            })}
          </nav>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b border-border flex items-center justify-between px-8 bg-card shrink-0 sticky top-0 z-10">
          <h1 className="font-semibold text-lg">Production Performance & Monitoring</h1>
          <div className="flex items-center gap-4">
            <div className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Month</div>
            <Input 
              type="month" 
              value={month} 
              onChange={(e) => setMonth(e.target.value)} 
              className="w-40 font-mono text-sm bg-background"
            />
          </div>
        </header>
        <main className="flex-1 overflow-auto p-8">
          {children}
        </main>
      </div>
    </div>
  );
}

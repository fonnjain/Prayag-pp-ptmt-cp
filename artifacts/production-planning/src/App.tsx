import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SegmentProvider } from "@/contexts/segment-context";
import { AuthProvider, useAuth } from "@/contexts/auth-context";
import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/login";
import AdminUsersPage from "@/pages/admin-users";
import DataPage from "@/pages/data";
import SummaryPage from "@/pages/summary";
import CategoryPage from "@/pages/category";
import ExportPage from "@/pages/export";
import RunsPage from "@/pages/runs";
import CorrectivePage from "@/pages/corrective";

const queryClient = new QueryClient();

function Router() {
  const { user } = useAuth();
  return (
    <Switch>
      <Route path="/" component={DataPage} />
      <Route path="/summary" component={SummaryPage} />
      <Route path="/category/:slug" component={CategoryPage} />
      <Route path="/runs" component={RunsPage} />
      <Route path="/export" component={ExportPage} />
      <Route path="/corrective" component={CorrectivePage} />
      {/* Admin-only: user management */}
      <Route path="/admin/users">
        {user?.role === "admin"
          ? <AdminUsersPage />
          : <div className="p-8 text-center text-muted-foreground text-sm">Access denied.</div>
        }
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-sm text-muted-foreground animate-pulse">Loading…</div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return <>{children}</>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SegmentProvider>
          <TooltipProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <AuthGate>
                <Router />
              </AuthGate>
            </WouterRouter>
            <Toaster />
          </TooltipProvider>
        </SegmentProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;

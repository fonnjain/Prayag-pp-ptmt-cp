import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SegmentProvider } from "@/contexts/segment-context";
import { MonthProvider } from "@workspace/month-filter";
import { useListAvailableMonths, type AvailableMonthsResponse } from "@workspace/api-client-react";
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
import ProductsPage from "@/pages/products";
import AlertsPage from "@/pages/alerts";
import { ActivityTracker } from "@/lib/activity-tracker";

const queryClient = new QueryClient();

function Router() {
  const { user } = useAuth();
  return (
    <Switch>
      <Route path="/" component={DataPage} />
      <Route path="/data" component={DataPage} />
      <Route path="/summary" component={SummaryPage} />
      <Route path="/products" component={ProductsPage} />
      <Route path="/alerts" component={AlertsPage} />
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

  return <><ActivityTracker app="production-planning" />{children}</>;
}

function AuthenticatedApp() {
  const { data: availableMonthsRaw, isLoading: availableMonthsLoading } = useListAvailableMonths({
    query: { staleTime: 5 * 60 * 1000 },
  } as any);
  const availableMonths = (availableMonthsRaw as unknown as AvailableMonthsResponse | undefined)?.months ?? [];

  return (
    <MonthProvider availableMonths={availableMonths} availableMonthsLoading={availableMonthsLoading}>
      <Router />
    </MonthProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SegmentProvider>
          <TooltipProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <AuthGate>
                <AuthenticatedApp />
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

import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { DataProvider, useData } from "@/lib/data-provider";
import { Role } from "@/lib/types";
import { Layout } from "@/components/layout";

import Dashboard from "@/pages/dashboard";
import Plan from "@/pages/plan";
import DataPage from "@/pages/data";
import Reports from "@/pages/reports";
import Settings from "@/pages/settings";
import Legacy from "@/pages/legacy";
import Login from "@/pages/login";

const queryClient = new QueryClient();

function RoleGuard({ allow, children }: { allow: Role[]; children: React.ReactNode }) {
  const { role } = useData();
  if (!allow.includes(role)) {
    return <Redirect to="/" />;
  }
  return <>{children}</>;
}

function ProtectedRoutes() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/plan" component={Plan} />
        <Route path="/data">
          <RoleGuard allow={["admin", "planner"]}>
            <DataPage />
          </RoleGuard>
        </Route>
        <Route path="/reports" component={Reports} />
        <Route path="/settings">
          <RoleGuard allow={["admin"]}>
            <Settings />
          </RoleGuard>
        </Route>
        <Route path="/legacy">
          <RoleGuard allow={["admin"]}>
            <Legacy />
          </RoleGuard>
        </Route>
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function AuthGate() {
  const { meLoading, isAuthed } = useData();
  if (meLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (!isAuthed) {
    return <Redirect to="/login" />;
  }
  return <ProtectedRoutes />;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route component={AuthGate} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <DataProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
        </DataProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout/app-layout";
import { useMonth } from "@/hooks/use-month";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

// Placeholder components for pages
function Dashboard() { return <div className="text-2xl font-bold font-sans">Dashboard View</div>; }
function Velocity() { return <div className="text-2xl font-bold font-sans">Velocity View</div>; }
function Warnings() { return <div className="text-2xl font-bold font-sans">Warnings View</div>; }
function Actions() { return <div className="text-2xl font-bold font-sans">Actions View</div>; }
function Quality() { return <div className="text-2xl font-bold font-sans">Quality View</div>; }
function Backlog() { return <div className="text-2xl font-bold font-sans">Backlog View</div>; }
function Settings() { return <div className="text-2xl font-bold font-sans">Settings View</div>; }

function Router({ month, setMonth }: { month: string, setMonth: (m: string) => void }) {
  return (
    <AppLayout month={month} setMonth={setMonth}>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/velocity" component={Velocity} />
        <Route path="/warnings" component={Warnings} />
        <Route path="/actions" component={Actions} />
        <Route path="/quality" component={Quality} />
        <Route path="/backlog" component={Backlog} />
        <Route path="/settings" component={Settings} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function App() {
  const { month, setMonth } = useMonth();

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router month={month} setMonth={setMonth} />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SegmentProvider } from "@/contexts/segment-context";
import NotFound from "@/pages/not-found";
import DataPage from "@/pages/data";
import SummaryPage from "@/pages/summary";
import CategoryPage from "@/pages/category";
import ExportPage from "@/pages/export";
import RunsPage from "@/pages/runs";
import CorrectivePage from "@/pages/corrective";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={DataPage} />
      <Route path="/summary" component={SummaryPage} />
      <Route path="/category/:slug" component={CategoryPage} />
      <Route path="/runs" component={RunsPage} />
      <Route path="/export" component={ExportPage} />
      <Route path="/corrective" component={CorrectivePage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SegmentProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </SegmentProvider>
    </QueryClientProvider>
  );
}

export default App;

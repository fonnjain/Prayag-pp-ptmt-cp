import { useState } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout/app-layout";
import { useDateFilter } from "@/hooks/use-date-filter";
import NotFound from "@/pages/not-found";

import Dashboard from "@/pages/dashboard";
import Velocity from "@/pages/velocity";
import Warnings from "@/pages/warnings";
import Actions from "@/pages/actions";
import Quality from "@/pages/quality";
import Backlog from "@/pages/backlog";
import Settings from "@/pages/settings";
import AiAnalytics from "@/pages/ai-analytics";

import PlantDashboard from "@/pages/plant/dashboard";
import PlantVelocity from "@/pages/plant/velocity";
import PlantAttainment from "@/pages/plant/attainment";
import PlantWarnings from "@/pages/plant/plant-warnings";
import PlantRecommendations from "@/pages/plant/recommendations";
import PlantTrend from "@/pages/plant/trend";
import PlantConfig from "@/pages/plant/plant-config";
import PlantReports from "@/pages/plant/reports";
import PlantCategories from "@/pages/plant/categories";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function Router({ month, preset, customMonth, dateRange, setPreset, setCustomMonth, selectedCategory, setSelectedCategory }: {
  month: string;
  preset: import("@/hooks/use-date-filter").DatePreset;
  customMonth: string;
  dateRange: import("@/hooks/use-date-filter").DateRange;
  setPreset: (p: import("@/hooks/use-date-filter").DatePreset) => void;
  setCustomMonth: (m: string) => void;
  selectedCategory: string | null;
  setSelectedCategory: (c: string | null) => void;
}) {
  return (
    <AppLayout
      month={month}
      preset={preset}
      customMonth={customMonth}
      dateRange={dateRange}
      setPreset={setPreset}
      setCustomMonth={setCustomMonth}
      selectedCategory={selectedCategory}
      setSelectedCategory={setSelectedCategory}
    >
      <Switch>
        <Route path="/">
          <Dashboard month={month} />
        </Route>
        <Route path="/velocity">
          <Velocity month={month} />
        </Route>
        <Route path="/warnings">
          <Warnings month={month} />
        </Route>
        <Route path="/actions">
          <Actions month={month} />
        </Route>
        <Route path="/quality">
          <Quality month={month} />
        </Route>
        <Route path="/backlog">
          <Backlog month={month} />
        </Route>
        <Route path="/settings">
          <Settings month={month} />
        </Route>
        <Route path="/ai-analytics">
          <AiAnalytics month={month} />
        </Route>
        <Route path="/plant">
          <PlantDashboard month={month} selectedCategory={selectedCategory} />
        </Route>
        <Route path="/plant/velocity">
          <PlantVelocity month={month} />
        </Route>
        <Route path="/plant/attainment">
          <PlantAttainment month={month} selectedCategory={selectedCategory} />
        </Route>
        <Route path="/plant/warnings">
          <PlantWarnings month={month} />
        </Route>
        <Route path="/plant/recommendations">
          <PlantRecommendations month={month} />
        </Route>
        <Route path="/plant/trend">
          <PlantTrend month={month} />
        </Route>
        <Route path="/plant/config">
          <PlantConfig month={month} />
        </Route>
        <Route path="/plant/reports">
          <PlantReports month={month} />
        </Route>
        <Route path="/plant/categories">
          <PlantCategories month={month} selectedCategory={selectedCategory} />
        </Route>
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function App() {
  const { month, preset, customMonth, dateRange, setPreset, setCustomMonth } = useDateFilter();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router
            month={month}
            preset={preset}
            customMonth={customMonth}
            dateRange={dateRange}
            setPreset={setPreset}
            setCustomMonth={setCustomMonth}
            selectedCategory={selectedCategory}
            setSelectedCategory={setSelectedCategory}
          />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ExternalLink } from "lucide-react";

interface CategoryRow {
  name: string;
  expected: number;
  actual: number;
  pass: boolean;
}

interface PlumbingValidateResponse {
  month: string;
  allPass: boolean;
  passCount: number;
  failCount: number;
  checks: CategoryRow[];
  categoryTotals?: Record<string, number>;
}

const CATEGORY_ORDER = [
  "CPVC Pipe", "CPVC Fitting", "CPVC Solvent",
  "UPVC Pipe", "UPVC Fitting", "UPVC Solvent",
  "SWR Pipe",  "SWR Fitting",  "SWR Solvent",
  "AGRI Pipe", "AGRI Fitting", "AGRI Solvent",
];

function fmtN(n: number) {
  return n.toLocaleString("en-IN");
}

export default function PlumbingMonitoring({ month }: { month: string }) {
  const [result, setResult] = useState<PlumbingValidateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/plan/validate?month=${encodeURIComponent(month)}&segment=Plumbing`);
      if (!res.ok) {
        const b = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(b.error ?? `HTTP ${res.status}`);
      }
      setResult(await res.json() as PlumbingValidateResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const totals = result?.categoryTotals ?? {};
  const grandTotal = CATEGORY_ORDER.reduce((s, c) => s + (totals[c] ?? 0), 0);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">

      {/* Missing live feed banner */}
      <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
        <div>
          <strong>Live machine actuals not yet connected</strong> — this view shows <em>plan targets only</em> (Production
          Required per category for {month}). Wire the Daily Production PLUMBING live feed to enable
          plan-vs-actual tracking, velocity, and attainment for Plumbing.
        </div>
      </div>

      {/* Plan targets */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">Plumbing plan targets — {month}</CardTitle>
          <div className="flex items-center gap-2">
            {result && (
              <Badge variant={result.allPass ? "default" : "destructive"} className="text-xs">
                {result.allPass ? `✓ ${result.passCount}/12 checks pass` : `✗ ${result.failCount} check(s) fail`}
              </Badge>
            )}
            <Button size="sm" variant="outline" onClick={load} disabled={loading}>
              {loading ? "Loading…" : result ? "Refresh" : "Load plan data"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="text-sm text-red-600 mb-3 px-3 py-2 rounded-md bg-red-50 border border-red-200">
              {error}
            </div>
          )}

          {!result && !loading && (
            <p className="text-sm text-muted-foreground">
              Click "Load plan data" to compute Production Required from the uploaded Plumbing FG Stock file
              and live Google Sheets data.
            </p>
          )}

          {result && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="text-left py-2 font-medium">Category</th>
                    <th className="text-right py-2 font-medium">Target (pcs)</th>
                    <th className="text-right py-2 font-medium">Formula</th>
                    <th className="text-center py-2 font-medium">Check</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {CATEGORY_ORDER.map((cat) => {
                    const actual = totals[cat] ?? 0;
                    const check = result.checks.find((c) => c.name.startsWith(cat));
                    const pass = check?.pass ?? true;
                    const isSWRAgri = cat.startsWith("SWR") || cat.startsWith("AGRI");
                    return (
                      <tr key={cat} className={cat.includes("Solvent") ? "bg-muted/30" : ""}>
                        <td className="py-2 font-medium">{cat}</td>
                        <td className={`py-2 text-right font-mono tabular-nums ${!pass ? "text-red-600" : ""}`}>
                          {fmtN(actual)}
                        </td>
                        <td className="py-2 text-right text-xs text-muted-foreground">
                          {isSWRAgri ? "Stock+Pend−Buf+PendLM" : "(Buf−Stock)+PendLM+Pend"}
                        </td>
                        <td className="py-2 text-center text-xs">
                          {pass ? <span className="text-green-600">✓</span> : <span className="text-red-600">✗</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t font-semibold">
                    <td className="py-2">Grand Total</td>
                    <td className="py-2 text-right font-mono tabular-nums">{fmtN(grandTotal)}</td>
                    <td />
                    <td className="py-2 text-center text-xs text-muted-foreground">≈1,922,309</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Formula reference card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Formula reference</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2 text-muted-foreground">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-md border p-3">
              <p className="font-semibold text-foreground mb-1">CPVC / UPVC (standard)</p>
              <p className="font-mono text-xs">max((Buffer − Stock) + PendLM + Pending, 0)</p>
              <p className="text-xs mt-1">Produces more when stock is below the buffer target.</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="font-semibold text-foreground mb-1">SWR / AGRI (swragri)</p>
              <p className="font-mono text-xs">max((Stock + Pending) − Buffer + PendLM, 0)</p>
              <p className="text-xs mt-1">Only positive-valued items contribute to the category sum.</p>
            </div>
          </div>
          <p className="text-xs">
            KG = pieces × weight/pcs from BOM sheet (id 1R7k5O6w4qaT74G-5X2VXBtD7-Fg3uByvIw3-TeViMmA).
            July 2026 target ≈ 391,404 kg. ~3% of items may have no BOM weight — flagged in the plan export.
          </p>
        </CardContent>
      </Card>

      {/* Link to planning app */}
      <div className="text-sm text-muted-foreground flex items-center gap-2">
        <ExternalLink className="h-3.5 w-3.5" />
        <span>Full Plumbing plan (item-level, weekly release, export) is in the</span>
        <a href="/" className="text-primary underline underline-offset-2">Production Planning app</a>.
      </div>
    </div>
  );
}

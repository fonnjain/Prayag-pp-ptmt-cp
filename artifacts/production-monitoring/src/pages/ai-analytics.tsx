import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sparkles, Download, Send, Loader2, History, Factory, AlertCircle, DatabaseZap, TrendingUp } from "lucide-react";
import { toast } from "@/hooks/use-toast";

type Depth = "standard" | "deep";

interface AnalysisResult {
  executive_summary: string;
  key_findings: { finding: string; evidence: string; scope: string }[];
  root_cause_hypotheses: { hypothesis: string; supporting_signal: string; confidence: "high" | "med" | "low" }[];
  risks: { risk: string; severity: "Critical" | "High" | "Medium"; basis: string }[];
  recommendations: { action: string; rationale: string; quantified_impact: string; priority: number; effort: "low" | "med" | "high"; scope: string }[];
  watch_items: string[];
}

interface PlantAnalysisResult {
  executive_summary: string;
  pp_verdict: {
    max_pp: { attainment_pct: number | null; projected_attainment_pct: number | null; rag: "green" | "amber" | "red" | null; verdict: string };
    min_pp: { projected_attainment_pct: number | null; rag: "green" | "amber" | "red" | null; verdict: string };
  };
  key_findings: { finding: string; evidence: string; scope: string }[];
  root_cause_hypotheses: { hypothesis: string; supporting_signal: string; confidence: "high" | "med" | "low" }[];
  risks: { risk: string; severity: "Critical" | "High" | "Medium"; basis: string }[];
  recommendations: { action: string; rationale: string; quantified_impact: string; priority: number; effort: "low" | "med" | "high"; scope: string }[];
  watch_items: string[];
}

interface AnalysisSummary {
  id: number;
  month: string;
  snapshotDate: string | null;
  depth: Depth;
  model: string;
  createdAt: string;
}

interface PlantTrendRow {
  id: number;
  month: string;
  snapshotDate: string | null;
  depth: Depth;
  model: string;
  createdAt: string;
  resultJson: PlantAnalysisResult | null;
}

interface ChatMessage {
  id?: number;
  role: "user" | "assistant";
  content: string;
}

async function consumeSse(
  response: Response,
  onEvent: (data: Record<string, unknown>) => void,
): Promise<void> {
  if (!response.body) throw new Error("No response stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data:")) continue;
      const jsonStr = line.slice(5).trim();
      if (!jsonStr) continue;
      try {
        onEvent(JSON.parse(jsonStr));
      } catch {
        // ignore malformed chunk
      }
    }
  }
}

function extractJsonValue(text: string, key: string): unknown {
  const keyIdx = text.indexOf(`"${key}"`);
  if (keyIdx === -1) return undefined;
  let i = keyIdx + key.length + 2;
  while (i < text.length && /[\s:]/.test(text[i])) i++;
  if (i >= text.length) return undefined;
  const firstChar = text[i];
  if (firstChar === '"') {
    let j = i + 1;
    while (j < text.length) {
      if (text[j] === '\\') { j += 2; continue; }
      if (text[j] === '"') {
        try { return JSON.parse(text.slice(i, j + 1)); } catch { return undefined; }
      }
      j++;
    }
    return undefined;
  }
  if (firstChar === '[' || firstChar === '{') {
    const close = firstChar === '[' ? ']' : '}';
    let depth = 0;
    let inString = false;
    let j = i;
    while (j < text.length) {
      const c = text[j];
      if (inString) {
        if (c === '\\') { j += 2; continue; }
        if (c === '"') inString = false;
      } else {
        if (c === '"') inString = true;
        else if (c === firstChar) depth++;
        else if (c === close) {
          depth--;
          if (depth === 0) {
            try { return JSON.parse(text.slice(i, j + 1)); } catch { return undefined; }
          }
        }
      }
      j++;
    }
    return undefined;
  }
  return undefined;
}

type Partial<T> = { [K in keyof T]?: T[K] };

function parsePartialResult(text: string): Partial<AnalysisResult> {
  const partial: Partial<AnalysisResult> = {};
  const summary = extractJsonValue(text, "executive_summary");
  if (typeof summary === "string") partial.executive_summary = summary;
  const findings = extractJsonValue(text, "key_findings");
  if (Array.isArray(findings)) partial.key_findings = findings as AnalysisResult["key_findings"];
  const hypotheses = extractJsonValue(text, "root_cause_hypotheses");
  if (Array.isArray(hypotheses)) partial.root_cause_hypotheses = hypotheses as AnalysisResult["root_cause_hypotheses"];
  const risks = extractJsonValue(text, "risks");
  if (Array.isArray(risks)) partial.risks = risks as AnalysisResult["risks"];
  const recs = extractJsonValue(text, "recommendations");
  if (Array.isArray(recs)) partial.recommendations = recs as AnalysisResult["recommendations"];
  const watch = extractJsonValue(text, "watch_items");
  if (Array.isArray(watch)) partial.watch_items = watch as string[];
  return partial;
}

function parsePartialPlantResult(text: string): Partial<PlantAnalysisResult> {
  const partial: Partial<PlantAnalysisResult> = {};
  const summary = extractJsonValue(text, "executive_summary");
  if (typeof summary === "string") partial.executive_summary = summary;
  const verdict = extractJsonValue(text, "pp_verdict");
  if (verdict && typeof verdict === "object" && !Array.isArray(verdict)) partial.pp_verdict = verdict as PlantAnalysisResult["pp_verdict"];
  const findings = extractJsonValue(text, "key_findings");
  if (Array.isArray(findings)) partial.key_findings = findings as PlantAnalysisResult["key_findings"];
  const hypotheses = extractJsonValue(text, "root_cause_hypotheses");
  if (Array.isArray(hypotheses)) partial.root_cause_hypotheses = hypotheses as PlantAnalysisResult["root_cause_hypotheses"];
  const risks = extractJsonValue(text, "risks");
  if (Array.isArray(risks)) partial.risks = risks as PlantAnalysisResult["risks"];
  const recs = extractJsonValue(text, "recommendations");
  if (Array.isArray(recs)) partial.recommendations = recs as PlantAnalysisResult["recommendations"];
  const watch = extractJsonValue(text, "watch_items");
  if (Array.isArray(watch)) partial.watch_items = watch as string[];
  return partial;
}

function SkeletonLines({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2 animate-pulse">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className={`h-3 bg-muted rounded ${i === lines - 1 ? "w-2/3" : "w-full"}`} />
      ))}
    </div>
  );
}

function severityColor(sev: string) {
  if (sev === "Critical" || sev === "critical") return "bg-red-500/10 text-red-500 border-red-500/20";
  if (sev === "High" || sev === "high") return "bg-amber-500/10 text-amber-500 border-amber-500/20";
  return "bg-yellow-500/10 text-yellow-600 border-yellow-500/20";
}

function confidenceColor(c: string) {
  if (c === "high") return "bg-emerald-500/10 text-emerald-500 border-emerald-500/20";
  if (c === "med") return "bg-amber-500/10 text-amber-500 border-amber-500/20";
  return "bg-muted text-muted-foreground border-muted";
}

function isNoDataError(err: string | null): boolean {
  return !!err && err.toLowerCase().includes("no production data found");
}

function ragColor(rag: string | null | undefined) {
  if (rag === "green") return "bg-emerald-500/10 text-emerald-600 border-emerald-500/20";
  if (rag === "amber") return "bg-amber-500/10 text-amber-600 border-amber-500/20";
  if (rag === "red") return "bg-red-500/10 text-red-500 border-red-500/20";
  return "bg-muted text-muted-foreground border-muted";
}

// ─────────────── shared result card sets ───────────────

function CommonResultCards({
  result,
  partial,
  generating,
  includeSummary = true,
}: {
  result: Partial<AnalysisResult>;
  partial: boolean;
  generating: boolean;
  includeSummary?: boolean;
}) {
  return (
    <>
      {includeSummary && (
        <Card>
          <CardHeader><CardTitle>Executive Summary</CardTitle></CardHeader>
          <CardContent>
            {result.executive_summary
              ? <p className="text-sm leading-relaxed">{result.executive_summary}</p>
              : generating ? <SkeletonLines lines={4} /> : null}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Key Findings</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {result.key_findings
            ? result.key_findings.map((f, i) => (
                <div key={i} className="border-l-2 border-primary/40 pl-3">
                  <div className="flex items-center gap-2 mb-1"><Badge variant="outline">{f.scope}</Badge></div>
                  <p className="text-sm">{f.finding}</p>
                  <p className="text-xs text-muted-foreground mt-1">Evidence: {f.evidence}</p>
                </div>
              ))
            : generating ? <SkeletonLines lines={5} /> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Root Cause Hypotheses</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {result.root_cause_hypotheses
            ? result.root_cause_hypotheses.map((h, i) => (
                <div key={i} className="flex items-start gap-3">
                  <Badge variant="outline" className={confidenceColor(h.confidence)}>{h.confidence.toUpperCase()}</Badge>
                  <div>
                    <p className="text-sm">{h.hypothesis}</p>
                    <p className="text-xs text-muted-foreground mt-1">Signal: {h.supporting_signal}</p>
                  </div>
                </div>
              ))
            : generating ? <SkeletonLines lines={4} /> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Risks</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {result.risks
            ? result.risks.map((r, i) => (
                <div key={i} className="flex items-start gap-3">
                  <Badge variant="outline" className={severityColor(r.severity)}>{r.severity}</Badge>
                  <div>
                    <p className="text-sm">{r.risk}</p>
                    <p className="text-xs text-muted-foreground mt-1">{r.basis}</p>
                  </div>
                </div>
              ))
            : generating ? <SkeletonLines lines={4} /> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recommendations</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {result.recommendations
            ? [...result.recommendations].sort((a, b) => a.priority - b.priority).map((r, i) => (
                <div key={i} className="border border-border/50 rounded-md p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium">#{r.priority} · {r.scope}</span>
                    <Badge variant="outline">{r.effort} effort</Badge>
                  </div>
                  <p className="text-sm">{r.action}</p>
                  <p className="text-xs text-muted-foreground mt-1">{r.rationale}</p>
                  <p className="text-xs text-emerald-600 mt-1">Impact: {r.quantified_impact}</p>
                </div>
              ))
            : generating ? <SkeletonLines lines={6} /> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Watch Items</CardTitle>
          <CardDescription>Data gaps or areas needing manual review</CardDescription>
        </CardHeader>
        <CardContent>
          {result.watch_items
            ? (
                <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                  {result.watch_items.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              )
            : generating ? <SkeletonLines lines={3} /> : null}
        </CardContent>
      </Card>

      {!generating && !partial && Object.keys(result).length === 0 && null}
    </>
  );
}

// ─────────────────────────── MACHINE LEVEL TAB ───────────────────────────

function MachineLevelTab({ month }: { month: string }) {
  const [depth, setDepth] = useState<Depth>("standard");
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [partialResult, setPartialResult] = useState<Partial<AnalysisResult> | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<AnalysisSummary[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [chatStreamText, setChatStreamText] = useState("");

  async function loadHistory() {
    try {
      const res = await fetch(`/api/ai/analyses?month=${encodeURIComponent(month)}`);
      if (!res.ok) return;
      const data = (await res.json()) as AnalysisSummary[];
      setHistory(data);
    } catch {
      // non-fatal
    }
  }

  useEffect(() => {
    void loadHistory();
    setResult(null);
    setPartialResult(null);
    setCurrentId(null);
    setMessages([]);
    setStreamingText("");
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  async function loadAnalysis(id: number) {
    const res = await fetch(`/api/ai/analyses/${id}`);
    if (!res.ok) return;
    const data = await res.json();
    setCurrentId(data.id);
    setResult(data.result ?? null);
    setPartialResult(null);
    setMessages(data.messages ?? []);
    setStreamingText("");
    setError(null);
  }

  async function handleGenerate() {
    setIsGenerating(true);
    setResult(null);
    setPartialResult({});
    setStreamingText("");
    setError(null);
    setMessages([]);
    setCurrentId(null);
    try {
      const res = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, depth }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string })?.error ?? `Request failed (${res.status})`);
      }
      let accumulated = "";
      await consumeSse(res, (evt) => {
        if (typeof evt.delta === "string") {
          accumulated += evt.delta;
          setStreamingText(accumulated);
          setPartialResult(parsePartialResult(accumulated));
        }
        if (evt.cached && evt.result) { setResult(evt.result as AnalysisResult); setCurrentId(Number(evt.id)); setPartialResult(null); }
        if (evt.error) setError(String(evt.error));
        if (evt.done) {
          if (evt.result) { setResult(evt.result as AnalysisResult); setPartialResult(null); }
          if (evt.id) setCurrentId(Number(evt.id));
        }
      });
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
      toast({ title: "AI analysis failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleAsk() {
    if (!currentId || !question.trim()) return;
    const q = question.trim();
    setQuestion("");
    setMessages((prev) => [...prev, { role: "user", content: q }]);
    setIsAsking(true);
    setChatStreamText("");
    try {
      const res = await fetch(`/api/ai/analyses/${currentId}/followup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string })?.error ?? `Request failed (${res.status})`);
      }
      let full = "";
      await consumeSse(res, (evt) => {
        if (typeof evt.delta === "string") { full += evt.delta; setChatStreamText(full); }
        if (evt.error) setError(String(evt.error));
      });
      setMessages((prev) => [...prev, { role: "assistant", content: full }]);
      setChatStreamText("");
    } catch (err) {
      toast({ title: "Follow-up failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setIsAsking(false);
    }
  }

  const displayResult = result ?? partialResult;
  const showCards = displayResult !== null && (isGenerating || result !== null);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Generate deep-dive analysis</CardTitle>
          <CardDescription>Send the current machine-level monitoring snapshot to Claude for qualitative interpretation and recommendations.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Select value={depth} onValueChange={(v) => setDepth(v as Depth)}>
            <SelectTrigger className="w-48" data-testid="select-depth">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="standard">Standard (Sonnet)</SelectItem>
              <SelectItem value="deep">Deep (Opus)</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={handleGenerate} disabled={isGenerating} data-testid="button-generate">
            {isGenerating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
            {isGenerating ? "Analyzing..." : "Generate Analysis"}
          </Button>
          {result && currentId && (
            <Button variant="outline" onClick={() => window.open(`/api/ai/analyses/${currentId}/export/pdf`, "_blank")} data-testid="button-export-pdf">
              <Download className="h-4 w-4 mr-2" />
              Export PDF
            </Button>
          )}
        </CardContent>
      </Card>

      {error && (
        isNoDataError(error) ? (
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <DatabaseZap className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-400">No data available for this month</p>
                  <p className="text-sm text-amber-600/80 dark:text-amber-500/80 mt-1">{error}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-red-500/30">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
                <p className="text-sm text-red-500">{error}</p>
              </div>
            </CardContent>
          </Card>
        )
      )}

      {isGenerating && !showCards && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Claude is analyzing the data packet...
            </div>
          </CardContent>
        </Card>
      )}

      {showCards && (
        <div className="space-y-6" data-testid="analysis-result">
          {isGenerating && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Claude is analyzing — results appearing as they arrive...
            </div>
          )}
          <CommonResultCards
            result={displayResult as Partial<AnalysisResult>}
            partial={result === null}
            generating={isGenerating}
          />

          {!isGenerating && result && (
            <Card>
              <CardHeader>
                <CardTitle>Ask a follow-up question</CardTitle>
                <CardDescription>Grounded in the same data packet used above.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {messages.map((m, i) => (
                  <div key={i} className={m.role === "user" ? "text-sm font-medium" : "text-sm text-muted-foreground"}>
                    <span className="mr-2">{m.role === "user" ? "You:" : "Claude:"}</span>{m.content}
                  </div>
                ))}
                {isAsking && (
                  <div className="text-sm text-muted-foreground">
                    <span className="mr-2">Claude:</span>
                    {chatStreamText || <Loader2 className="h-3 w-3 inline animate-spin" />}
                  </div>
                )}
                <div className="flex gap-2">
                  <Textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Why is utilisation low on Machine 3?" className="min-h-[44px]" data-testid="input-followup" />
                  <Button onClick={handleAsk} disabled={isAsking || !question.trim()} data-testid="button-ask"><Send className="h-4 w-4" /></Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {history.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><History className="h-4 w-4" /> History</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {history.map((h) => (
              <button key={h.id} onClick={() => loadAnalysis(h.id)}
                className={`w-full text-left text-sm px-3 py-2 rounded-md border transition-colors ${currentId === h.id ? "border-primary bg-primary/5" : "border-border/50 hover:bg-muted/30"}`}
                data-testid={`history-item-${h.id}`}>
                <div className="flex items-center justify-between">
                  <span className="font-medium">{new Date(h.createdAt).toLocaleString()}</span>
                  <Badge variant="outline">{h.depth}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">{h.model}</div>
              </button>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─────────────────────────── PLANT TREND TABLE ───────────────────────────

function ragDot(rag: string | null | undefined) {
  if (rag === "green") return <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 mr-1.5" />;
  if (rag === "amber") return <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400 mr-1.5" />;
  if (rag === "red") return <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500 mr-1.5" />;
  return <span className="inline-block w-2.5 h-2.5 rounded-full bg-muted mr-1.5" />;
}

const RAG_RANK: Record<string, number> = { green: 2, amber: 1, red: 0 };

function ragChangeArrow(
  prev: string | null | undefined,
  curr: string | null | undefined,
): { dir: "up" | "down" | "same"; label: string } | null {
  if (!prev || !curr) return null;
  const p = RAG_RANK[prev] ?? -1;
  const c = RAG_RANK[curr] ?? -1;
  if (p < 0 || c < 0) return null;
  if (c > p) return { dir: "up", label: "↑" };
  if (c < p) return { dir: "down", label: "↓" };
  return { dir: "same", label: "→" };
}

function RagChangeIndicator({ prev, curr }: { prev: string | null | undefined; curr: string | null | undefined }) {
  const arrow = ragChangeArrow(prev, curr);
  if (!arrow) return null;
  const cls =
    arrow.dir === "up"
      ? "text-emerald-600 font-bold"
      : arrow.dir === "down"
        ? "text-red-500 font-bold"
        : "text-muted-foreground";
  return (
    <span className={`ml-1.5 text-base leading-none ${cls}`} title={arrow.dir === "up" ? "Improved" : arrow.dir === "down" ? "Worsened" : "Unchanged"}>
      {arrow.label}
    </span>
  );
}

function RiskDeltaBadge({ prevCount, currCount }: { prevCount: number | null; currCount: number | null }) {
  if (prevCount === null || currCount === null) return null;
  const delta = currCount - prevCount;
  if (delta === 0) return (
    <span className="ml-1.5 text-xs text-muted-foreground" title="No change in risk count">±0</span>
  );
  const sign = delta > 0 ? "+" : "";
  const label = `${sign}${delta} risk${Math.abs(delta) === 1 ? "" : "s"}`;
  const cls = delta > 0 ? "text-red-500" : "text-emerald-600";
  return (
    <span className={`ml-1.5 text-xs font-medium ${cls}`} title={delta > 0 ? "More risks than previous month" : "Fewer risks than previous month"}>
      {label}
    </span>
  );
}

function PlantTrendTable({
  onSelectAnalysis,
}: {
  onSelectAnalysis: (id: number) => void;
}) {
  const [rows, setRows] = useState<PlantTrendRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch("/api/ai/plant-analyses?all=true")
      .then(async (res) => {
        if (!res.ok) throw new Error(`Server error ${res.status}`);
        const data = (await res.json()) as PlantTrendRow[];
        setRows(data);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load trend data");
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm py-8 justify-center">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading trend data…
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-red-500 py-4">{error}</p>;
  }

  if (rows.length === 0) {
    return (
      <div className="text-center text-muted-foreground text-sm py-12">
        No plant analyses found. Generate an analysis on the Analysis tab to start building the trend.
      </div>
    );
  }

  const sortedRows = [...rows].sort((a, b) => a.month.localeCompare(b.month));

  return (
    <div className="overflow-x-auto rounded-md border border-border/50" data-testid="plant-trend-table">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/50 bg-muted/30">
            <th className="text-left px-4 py-3 font-medium">Month</th>
            <th className="text-left px-4 py-3 font-medium">RAG – Max PP</th>
            <th className="text-left px-4 py-3 font-medium">RAG – Min PP</th>
            <th className="text-left px-4 py-3 font-medium">Key risks</th>
            <th className="text-left px-4 py-3 font-medium">Top rec scope</th>
            <th className="text-left px-4 py-3 font-medium">Generated</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, idx) => {
            const result = row.resultJson;
            const maxRag = result?.pp_verdict?.max_pp?.rag ?? null;
            const minRag = result?.pp_verdict?.min_pp?.rag ?? null;
            const riskCount = result?.risks?.length ?? null;
            const topRec = result?.recommendations
              ? [...result.recommendations].sort((a, b) => a.priority - b.priority)[0]
              : null;

            const prevRow = idx > 0 ? sortedRows[idx - 1] : null;
            const prevResult = prevRow?.resultJson ?? null;
            const prevMaxRag = prevResult?.pp_verdict?.max_pp?.rag ?? null;
            const prevMinRag = prevResult?.pp_verdict?.min_pp?.rag ?? null;
            const prevRiskCount = prevResult?.risks?.length ?? null;

            return (
              <tr
                key={row.id}
                className="border-b border-border/30 hover:bg-muted/20 transition-colors cursor-pointer"
                onClick={() => onSelectAnalysis(row.id)}
                data-testid={`trend-row-${row.id}`}
              >
                <td className="px-4 py-3 font-medium">{row.month}</td>
                <td className="px-4 py-3">
                  <span className="flex items-center flex-wrap gap-y-0.5">
                    {ragDot(maxRag)}
                    <span className={maxRag ? ragColor(maxRag).split(" ").find((c) => c.startsWith("text-")) ?? "" : "text-muted-foreground"}>
                      {maxRag ? maxRag.toUpperCase() : "—"}
                    </span>
                    <RagChangeIndicator prev={prevMaxRag} curr={maxRag} />
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="flex items-center flex-wrap gap-y-0.5">
                    {ragDot(minRag)}
                    <span className={minRag ? ragColor(minRag).split(" ").find((c) => c.startsWith("text-")) ?? "" : "text-muted-foreground"}>
                      {minRag ? minRag.toUpperCase() : "—"}
                    </span>
                    <RagChangeIndicator prev={prevMinRag} curr={minRag} />
                  </span>
                </td>
                <td className="px-4 py-3 tabular-nums">
                  <span className="flex items-center">
                    <span>{riskCount !== null && riskCount > 0 ? riskCount : "—"}</span>
                    {riskCount !== null && riskCount > 0 && (
                      <RiskDeltaBadge prevCount={prevRiskCount} currCount={riskCount} />
                    )}
                  </span>
                </td>
                <td className="px-4 py-3 max-w-[200px] truncate text-muted-foreground">
                  {topRec ? topRec.scope : "—"}
                </td>
                <td className="px-4 py-3 text-muted-foreground text-xs">
                  {new Date(row.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => { e.stopPropagation(); onSelectAnalysis(row.id); }}
                    className="text-xs"
                  >
                    View →
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────── PLANT LEVEL TAB ───────────────────────────

function PlantLevelTab({ month }: { month: string }) {
  const [depth, setDepth] = useState<Depth>("standard");
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [partialResult, setPartialResult] = useState<Partial<PlantAnalysisResult> | null>(null);
  const [result, setResult] = useState<PlantAnalysisResult | null>(null);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<AnalysisSummary[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [chatStreamText, setChatStreamText] = useState("");
  const [innerTab, setInnerTab] = useState<"analysis" | "trend">("analysis");

  async function loadHistory() {
    try {
      const res = await fetch(`/api/ai/plant-analyses?month=${encodeURIComponent(month)}`);
      if (!res.ok) return;
      const data = (await res.json()) as AnalysisSummary[];
      setHistory(data);
    } catch {
      // non-fatal
    }
  }

  useEffect(() => {
    void loadHistory();
    setResult(null);
    setPartialResult(null);
    setCurrentId(null);
    setMessages([]);
    setStreamingText("");
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  async function loadAnalysis(id: number) {
    const res = await fetch(`/api/ai/plant-analyses/${id}`);
    if (!res.ok) return;
    const data = await res.json();
    setCurrentId(data.id);
    setResult(data.result ?? null);
    setPartialResult(null);
    setMessages(data.messages ?? []);
    setStreamingText("");
    setError(null);
    setInnerTab("analysis");
  }

  async function handleGenerate() {
    setIsGenerating(true);
    setResult(null);
    setPartialResult({});
    setStreamingText("");
    setError(null);
    setMessages([]);
    setCurrentId(null);
    try {
      const res = await fetch("/api/ai/analyze-plant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, depth }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string })?.error ?? `Request failed (${res.status})`);
      }
      let accumulated = "";
      await consumeSse(res, (evt) => {
        if (typeof evt.delta === "string") {
          accumulated += evt.delta;
          setStreamingText(accumulated);
          setPartialResult(parsePartialPlantResult(accumulated));
        }
        if (evt.cached && evt.result) { setResult(evt.result as PlantAnalysisResult); setCurrentId(Number(evt.id)); setPartialResult(null); }
        if (evt.error) setError(String(evt.error));
        if (evt.done) {
          if (evt.result) { setResult(evt.result as PlantAnalysisResult); setPartialResult(null); }
          if (evt.id) setCurrentId(Number(evt.id));
        }
      });
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
      toast({ title: "Plant AI analysis failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleAsk() {
    if (!currentId || !question.trim()) return;
    const q = question.trim();
    setQuestion("");
    setMessages((prev) => [...prev, { role: "user", content: q }]);
    setIsAsking(true);
    setChatStreamText("");
    try {
      const res = await fetch(`/api/ai/plant-analyses/${currentId}/followup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string })?.error ?? `Request failed (${res.status})`);
      }
      let full = "";
      await consumeSse(res, (evt) => {
        if (typeof evt.delta === "string") { full += evt.delta; setChatStreamText(full); }
        if (evt.error) setError(String(evt.error));
      });
      setMessages((prev) => [...prev, { role: "assistant", content: full }]);
      setChatStreamText("");
    } catch (err) {
      toast({ title: "Follow-up failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setIsAsking(false);
    }
  }

  const displayResult = result ?? partialResult;
  const showCards = displayResult !== null && (isGenerating || result !== null);

  return (
    <div className="space-y-6">
      <Tabs value={innerTab} onValueChange={(v) => setInnerTab(v as "analysis" | "trend")}>
        <TabsList className="mb-4">
          <TabsTrigger value="analysis" className="flex items-center gap-2">
            <Factory className="h-4 w-4" />
            Analysis
          </TabsTrigger>
          <TabsTrigger value="trend" className="flex items-center gap-2" data-testid="plant-trend-tab">
            <TrendingUp className="h-4 w-4" />
            Trend
          </TabsTrigger>
        </TabsList>

        <TabsContent value="trend">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                Cross-month trend
              </CardTitle>
              <CardDescription>
                Latest plant AI verdict per month — click any row to load the full analysis.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PlantTrendTable onSelectAnalysis={(id) => loadAnalysis(id)} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analysis" className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Generate plant NOS analysis</CardTitle>
          <CardDescription>Send the plant-level NOS attainment packet to Claude. Covers Min PP and Max PP separately.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Select value={depth} onValueChange={(v) => setDepth(v as Depth)}>
            <SelectTrigger className="w-48" data-testid="plant-select-depth">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="standard">Standard (Sonnet)</SelectItem>
              <SelectItem value="deep">Deep (Opus)</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={handleGenerate} disabled={isGenerating} data-testid="plant-button-generate">
            {isGenerating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Factory className="h-4 w-4 mr-2" />}
            {isGenerating ? "Analyzing..." : "Generate Plant Analysis"}
          </Button>
          {result && currentId && (
            <Button variant="outline" onClick={() => window.open(`/api/ai/plant-analyses/${currentId}/export/pdf`, "_blank")} data-testid="plant-button-export-pdf">
              <Download className="h-4 w-4 mr-2" />
              Export PDF
            </Button>
          )}
        </CardContent>
      </Card>

      {error && (
        isNoDataError(error) ? (
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <DatabaseZap className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-400">No data available for this month</p>
                  <p className="text-sm text-amber-600/80 dark:text-amber-500/80 mt-1">{error}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-red-500/30">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
                <p className="text-sm text-red-500">{error}</p>
              </div>
            </CardContent>
          </Card>
        )
      )}

      {isGenerating && !showCards && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Claude is analyzing the plant NOS packet...
            </div>
          </CardContent>
        </Card>
      )}

      {showCards && (
        <div className="space-y-6" data-testid="plant-analysis-result">
          {isGenerating && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Claude is analyzing — results appearing as they arrive...
            </div>
          )}

          <Card>
            <CardHeader><CardTitle>Executive Summary</CardTitle></CardHeader>
            <CardContent>
              {displayResult.executive_summary
                ? <p className="text-sm leading-relaxed">{displayResult.executive_summary}</p>
                : isGenerating ? <SkeletonLines lines={4} /> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>PP Verdict</CardTitle>
              <CardDescription>Min PP and Max PP assessed separately against NOS attainment</CardDescription>
            </CardHeader>
            <CardContent>
              {displayResult.pp_verdict
                ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="border border-border/50 rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="font-semibold text-sm">Max PP</span>
                          <Badge variant="outline" className={ragColor(displayResult.pp_verdict.max_pp.rag)}>
                            {(displayResult.pp_verdict.max_pp.rag ?? "n/a").toUpperCase()}
                          </Badge>
                        </div>
                        <p className="text-sm mb-2">{displayResult.pp_verdict.max_pp.verdict}</p>
                        <div className="flex gap-4 text-xs text-muted-foreground">
                          {displayResult.pp_verdict.max_pp.attainment_pct !== null && (
                            <span>Attainment: <strong>{displayResult.pp_verdict.max_pp.attainment_pct}%</strong></span>
                          )}
                          {displayResult.pp_verdict.max_pp.projected_attainment_pct !== null && (
                            <span>Projected: <strong>{displayResult.pp_verdict.max_pp.projected_attainment_pct}%</strong></span>
                          )}
                        </div>
                      </div>
                      <div className="border border-border/50 rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="font-semibold text-sm">Min PP</span>
                          <Badge variant="outline" className={ragColor(displayResult.pp_verdict.min_pp.rag)}>
                            {(displayResult.pp_verdict.min_pp.rag ?? "n/a").toUpperCase()}
                          </Badge>
                        </div>
                        <p className="text-sm mb-2">{displayResult.pp_verdict.min_pp.verdict}</p>
                        <div className="flex gap-4 text-xs text-muted-foreground">
                          {displayResult.pp_verdict.min_pp.projected_attainment_pct !== null && (
                            <span>Projected: <strong>{displayResult.pp_verdict.min_pp.projected_attainment_pct}%</strong></span>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                : isGenerating ? <SkeletonLines lines={3} /> : null}
            </CardContent>
          </Card>

          <CommonResultCards
            result={displayResult as Partial<AnalysisResult>}
            partial={result === null}
            generating={isGenerating}
            includeSummary={false}
          />

          {!isGenerating && result && (
            <Card>
              <CardHeader>
                <CardTitle>Ask a follow-up question</CardTitle>
                <CardDescription>Grounded in the same plant NOS data packet used above.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {messages.map((m, i) => (
                  <div key={i} className={m.role === "user" ? "text-sm font-medium" : "text-sm text-muted-foreground"}>
                    <span className="mr-2">{m.role === "user" ? "You:" : "Claude:"}</span>{m.content}
                  </div>
                ))}
                {isAsking && (
                  <div className="text-sm text-muted-foreground">
                    <span className="mr-2">Claude:</span>
                    {chatStreamText || <Loader2 className="h-3 w-3 inline animate-spin" />}
                  </div>
                )}
                <div className="flex gap-2">
                  <Textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Which categories are most at risk of missing Min PP?" className="min-h-[44px]" data-testid="plant-input-followup" />
                  <Button onClick={handleAsk} disabled={isAsking || !question.trim()} data-testid="plant-button-ask"><Send className="h-4 w-4" /></Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {history.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><History className="h-4 w-4" /> History</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {history.map((h) => (
              <button key={h.id} onClick={() => loadAnalysis(h.id)}
                className={`w-full text-left text-sm px-3 py-2 rounded-md border transition-colors ${currentId === h.id ? "border-primary bg-primary/5" : "border-border/50 hover:bg-muted/30"}`}
                data-testid={`plant-history-item-${h.id}`}>
                <div className="flex items-center justify-between">
                  <span className="font-medium">{new Date(h.createdAt).toLocaleString()}</span>
                  <Badge variant="outline">{h.depth}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">{h.model}</div>
              </button>
            ))}
          </CardContent>
        </Card>
      )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─────────────────────────── TOP-LEVEL PAGE ───────────────────────────

export default function AiAnalytics({ month }: { month: string }) {
  return (
    <div className="space-y-6 max-w-[1200px] mx-auto pb-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2 flex items-center gap-2">
          <Sparkles className="h-7 w-7 text-primary" />
          AI Analytics
        </h1>
        <p className="text-muted-foreground">
          Claude interprets computed engine results for {month} — it never invents or recomputes numbers.
        </p>
      </header>

      <Tabs defaultValue="machine">
        <TabsList className="mb-6">
          <TabsTrigger value="machine" className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            Machine Level
          </TabsTrigger>
          <TabsTrigger value="plant" className="flex items-center gap-2">
            <Factory className="h-4 w-4" />
            Plant Level
          </TabsTrigger>
        </TabsList>

        <TabsContent value="machine">
          <MachineLevelTab month={month} />
        </TabsContent>

        <TabsContent value="plant">
          <PlantLevelTab month={month} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

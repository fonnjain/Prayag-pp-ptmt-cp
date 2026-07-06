import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Download, Send, Loader2, History } from "lucide-react";
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

interface AnalysisSummary {
  id: number;
  month: string;
  snapshotDate: string | null;
  depth: Depth;
  model: string;
  createdAt: string;
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

export default function AiAnalytics({ month }: { month: string }) {
  const [depth, setDepth] = useState<Depth>("standard");
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingText, setStreamingText] = useState("");
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
    setMessages(data.messages ?? []);
    setStreamingText("");
    setError(null);
  }

  async function handleGenerate() {
    setIsGenerating(true);
    setResult(null);
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
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      await consumeSse(res, (evt) => {
        if (typeof evt.delta === "string") {
          setStreamingText((prev) => prev + evt.delta);
        }
        if (evt.cached && evt.result) {
          setResult(evt.result as AnalysisResult);
          setCurrentId(Number(evt.id));
        }
        if (evt.error) {
          setError(String(evt.error));
        }
        if (evt.done) {
          if (evt.result) setResult(evt.result as AnalysisResult);
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
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      let full = "";
      await consumeSse(res, (evt) => {
        if (typeof evt.delta === "string") {
          full += evt.delta;
          setChatStreamText(full);
        }
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

  function handleExportPdf() {
    if (!currentId) return;
    window.open(`/api/ai/analyses/${currentId}/export/pdf`, "_blank");
  }

  return (
    <div className="space-y-6 max-w-[1200px] mx-auto pb-10">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2 flex items-center gap-2">
            <Sparkles className="h-7 w-7 text-primary" />
            AI Analytics
          </h1>
          <p className="text-muted-foreground">
            Claude interprets this month's computed engine results for {month} — it never invents or recomputes numbers.
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Generate deep-dive analysis</CardTitle>
          <CardDescription>Send the current monitoring snapshot to Claude for qualitative interpretation and recommendations.</CardDescription>
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
            <Button variant="outline" onClick={handleExportPdf} data-testid="button-export-pdf">
              <Download className="h-4 w-4 mr-2" />
              Export PDF
            </Button>
          )}
        </CardContent>
      </Card>

      {error && (
        <Card className="border-red-500/30">
          <CardContent className="pt-6 text-red-500 text-sm">{error}</CardContent>
        </Card>
      )}

      {isGenerating && !result && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-3">
              <Loader2 className="h-4 w-4 animate-spin" /> Claude is analyzing the data packet...
            </div>
            <pre className="text-xs whitespace-pre-wrap text-muted-foreground max-h-64 overflow-auto bg-muted/30 p-3 rounded">
              {streamingText || "Waiting for response..."}
            </pre>
          </CardContent>
        </Card>
      )}

      {result && (
        <div className="space-y-6" data-testid="analysis-result">
          <Card>
            <CardHeader>
              <CardTitle>Executive Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed">{result.executive_summary}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Key Findings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {result.key_findings.map((f, i) => (
                <div key={i} className="border-l-2 border-primary/40 pl-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline">{f.scope}</Badge>
                  </div>
                  <p className="text-sm">{f.finding}</p>
                  <p className="text-xs text-muted-foreground mt-1">Evidence: {f.evidence}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Root Cause Hypotheses</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {result.root_cause_hypotheses.map((h, i) => (
                <div key={i} className="flex items-start gap-3">
                  <Badge variant="outline" className={confidenceColor(h.confidence)}>{h.confidence.toUpperCase()}</Badge>
                  <div>
                    <p className="text-sm">{h.hypothesis}</p>
                    <p className="text-xs text-muted-foreground mt-1">Signal: {h.supporting_signal}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Risks</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {result.risks.map((r, i) => (
                <div key={i} className="flex items-start gap-3">
                  <Badge variant="outline" className={severityColor(r.severity)}>{r.severity}</Badge>
                  <div>
                    <p className="text-sm">{r.risk}</p>
                    <p className="text-xs text-muted-foreground mt-1">{r.basis}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recommendations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {[...result.recommendations].sort((a, b) => a.priority - b.priority).map((r, i) => (
                <div key={i} className="border border-border/50 rounded-md p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium">#{r.priority} · {r.scope}</span>
                    <Badge variant="outline">{r.effort} effort</Badge>
                  </div>
                  <p className="text-sm">{r.action}</p>
                  <p className="text-xs text-muted-foreground mt-1">{r.rationale}</p>
                  <p className="text-xs text-emerald-600 mt-1">Impact: {r.quantified_impact}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Watch Items</CardTitle>
              <CardDescription>Data gaps or areas needing manual review</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                {result.watch_items.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Ask a follow-up question</CardTitle>
              <CardDescription>Grounded in the same data packet used above.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {messages.map((m, i) => (
                <div key={i} className={m.role === "user" ? "text-sm font-medium" : "text-sm text-muted-foreground"}>
                  <span className="mr-2">{m.role === "user" ? "You:" : "Claude:"}</span>
                  {m.content}
                </div>
              ))}
              {isAsking && (
                <div className="text-sm text-muted-foreground">
                  <span className="mr-2">Claude:</span>
                  {chatStreamText || <Loader2 className="h-3 w-3 inline animate-spin" />}
                </div>
              )}
              <div className="flex gap-2">
                <Textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="e.g. Why is the Injection category behind pace?"
                  className="min-h-[44px]"
                  data-testid="input-followup"
                />
                <Button onClick={handleAsk} disabled={isAsking || !question.trim()} data-testid="button-ask">
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-4 w-4" /> History
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {history.map((h) => (
              <button
                key={h.id}
                onClick={() => loadAnalysis(h.id)}
                className={`w-full text-left text-sm px-3 py-2 rounded-md border transition-colors ${
                  currentId === h.id ? "border-primary bg-primary/5" : "border-border/50 hover:bg-muted/30"
                }`}
                data-testid={`history-item-${h.id}`}
              >
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

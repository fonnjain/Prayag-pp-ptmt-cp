import Anthropic from "@anthropic-ai/sdk";

const apiKey = process.env["ANTHROPIC_API_KEY"];
export const anthropicAvailable = Boolean(apiKey);
const client = apiKey ? new Anthropic({ apiKey }) : null;

export const MODEL_FAST = process.env["ANTHROPIC_MODEL_FAST"] || "claude-sonnet-4-6";
export const MODEL_DEEP = process.env["ANTHROPIC_MODEL_DEEP"] || "claude-opus-4-8";
const MAX_FAST = Number(process.env["MAX_TOKENS_FAST"] || "1500");
const MAX_DEEP = Number(process.env["MAX_TOKENS_DEEP"] || "4000");

export type Tier = "fast" | "deep";

export interface SelectModelArgs {
  task: "sanity" | "report";
  cadence?: string;
  board?: boolean;
}

interface ModelChoice {
  tier: Tier;
  model: string;
  maxTokens: number;
}

const DEEP: ModelChoice = { tier: "deep", model: MODEL_DEEP, maxTokens: MAX_DEEP };
const FAST: ModelChoice = { tier: "fast", model: MODEL_FAST, maxTokens: MAX_FAST };

// Single source of truth for model tiering. The sanity check is ALWAYS deep.
// Reports use deep for board packs and annual/quarterly cadences, fast otherwise.
export function selectModel(args: SelectModelArgs): ModelChoice {
  if (args.task === "sanity") return DEEP;
  const c = (args.cadence || "").toLowerCase();
  if (args.board || c.includes("annual") || c.includes("quarter")) return DEEP;
  return FAST;
}

export interface ClaudeResult {
  text: string;
  model: string;
  tier: Tier;
  downgraded: boolean;
}

export interface ClaudeCallArgs {
  system: string;
  user: string;
  tier: Tier;
  // Optional per-call output budget override. Used when a caller (e.g. the
  // advisory coverage pass) returns JSON arrays larger than the tier default,
  // which would otherwise truncate the response and produce malformed JSON.
  maxTokens?: number;
}

// Call Claude with a fallback to the other tier if the primary model errors
// (e.g. overloaded). A fallback sets downgraded=true so callers can record it.
export async function callClaude(args: ClaudeCallArgs): Promise<ClaudeResult> {
  if (!client) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }
  const order: ModelChoice[] =
    args.tier === "deep" ? [DEEP, FAST] : [FAST, DEEP];
  let lastErr: unknown;
  for (let i = 0; i < order.length; i++) {
    const choice = order[i]!;
    try {
      const resp = await client.messages.create({
        model: choice.model,
        max_tokens: args.maxTokens ?? choice.maxTokens,
        system: args.system,
        messages: [{ role: "user", content: args.user }],
      });
      const text = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      return { text, model: choice.model, tier: choice.tier, downgraded: i > 0 };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Claude call failed");
}

// Tolerant JSON extraction from a model response that may wrap JSON in prose
// or markdown fences.
export function extractJSON<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1]! : text;
  const start = candidate.indexOf("{");
  const arrStart = candidate.indexOf("[");
  const begin =
    start === -1
      ? arrStart
      : arrStart === -1
        ? start
        : Math.min(start, arrStart);
  if (begin === -1) {
    throw new Error("No JSON found in model response");
  }
  const openCh = candidate[begin];
  const closeCh = openCh === "[" ? "]" : "}";
  const end = candidate.lastIndexOf(closeCh);
  if (end === -1 || end < begin) {
    throw new Error("Malformed JSON in model response");
  }
  const slice = candidate.slice(begin, end + 1);
  try {
    return JSON.parse(slice) as T;
  } catch {
    // Tolerate a common model slip: trailing commas before a closing } or ].
    try {
      return JSON.parse(slice.replace(/,\s*([}\]])/g, "$1")) as T;
    } catch {
      // Last resort: the response was truncated mid-structure (hit the output
      // token cap). Salvage by cutting back to the last complete top-level
      // element and closing any still-open arrays/objects.
      return JSON.parse(closeTruncatedJSON(candidate.slice(begin))) as T;
    }
  }
}

// Best-effort repair of JSON truncated mid-stream: walk the text tracking the
// bracket/brace stack (ignoring string contents), drop any dangling partial
// element after the last completed one, then append the missing closers.
function closeTruncatedJSON(text: string): string {
  const stack: string[] = [];
  let inStr = false;
  let escaped = false;
  let lastSafe = -1; // index (exclusive) just after the last balanced top-level-ish element
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
    } else if (ch === "{" || ch === "[") {
      stack.push(ch);
    } else if (ch === "}" || ch === "]") {
      stack.pop();
      // A closed element at array/object depth 1 is a safe truncation point.
      if (stack.length === 1) lastSafe = i + 1;
    } else if (ch === "," && stack.length === 1) {
      lastSafe = i; // safe to cut at a separator inside the outer container
    }
  }
  let out = lastSafe > 0 ? text.slice(0, lastSafe) : text;
  // Recompute the open stack for the trimmed output and close it.
  const closers: string[] = [];
  let s = false;
  let esc = false;
  for (let i = 0; i < out.length; i++) {
    const ch = out[i]!;
    if (s) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') s = false;
      continue;
    }
    if (ch === '"') s = true;
    else if (ch === "{") closers.push("}");
    else if (ch === "[") closers.push("]");
    else if (ch === "}" || ch === "]") closers.pop();
  }
  out = out.replace(/,\s*$/, "");
  while (closers.length) out += closers.pop();
  return out;
}

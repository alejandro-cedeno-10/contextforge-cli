import type { GraphNode } from "./builder.js";

export interface EnrichmentEntry {
  summary: string;
  tags: string[];
  complexity: "low" | "medium" | "high";
}

export interface EnrichmentResult {
  entries: Record<string, EnrichmentEntry>;
  apiCalls: number;
  symbolsProcessed: number;
}

export interface EnrichmentOptions {
  apiKey: string;
  model?: string;
  maxSymbols?: number;
  batchSize?: number;
  fetchImpl?: typeof globalThis.fetch;
}

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_MAX_SYMBOLS = 100;
const DEFAULT_BATCH_SIZE = 12;

const SYSTEM_PROMPT = `You enrich code-graph symbols with concise metadata.

Input: a JSON array of symbols, each with id, name, kind, lang, exported, file path.

Output: a JSON object with a single field "entries", an array of objects matching the input by id. Each entry has:
- "summary": one sentence (max 100 chars), present tense, what the symbol does. No restating its name.
- "tags": 1-3 short lowercase tags from this set: api, util, model, service, parser, validator, cli, render, schema, cache, builder, network, fs, hash, scan, graph, spec, manifest, test.
- "complexity": "low" | "medium" | "high" inferred from kind alone (interfaces=low, simple functions=low, classes=medium, builders/services=high).

Return ONLY the JSON object. No prose, no markdown fences.`;

export function selectEnrichmentTargets(
  nodes: readonly GraphNode[],
  maxSymbols: number
): GraphNode[] {
  const eligible = nodes.filter(
    (n) =>
      n.type === "symbol" &&
      n.exported === true &&
      (n.kind === "function_declaration" ||
        n.kind === "class_declaration" ||
        n.kind === "interface_declaration" ||
        n.kind === "type_alias_declaration" ||
        n.kind === "function_definition" ||
        n.kind === "class_definition")
  );
  // Prefer classes/interfaces first, then types, then functions — order so that
  // when we hit `maxSymbols` we have the most architecturally meaningful items.
  const priority: Record<string, number> = {
    class_declaration: 0,
    class_definition: 0,
    interface_declaration: 1,
    type_alias_declaration: 2,
    function_declaration: 3,
    function_definition: 3
  };
  const sorted = [...eligible].sort((a, b) => {
    const pa = priority[a.kind ?? ""] ?? 9;
    const pb = priority[b.kind ?? ""] ?? 9;
    if (pa !== pb) return pa - pb;
    return a.id < b.id ? -1 : 1;
  });
  return sorted.slice(0, maxSymbols);
}

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
}

interface ParsedBatch {
  entries: Array<{
    id: string;
    summary?: string;
    tags?: string[];
    complexity?: string;
  }>;
}

function parseBatchResponse(raw: string): ParsedBatch | null {
  // Anthropic may wrap content even when asked not to. Try to extract a
  // JSON object from the text.
  const trimmed = raw.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as ParsedBatch;
  } catch {
    return null;
  }
}

function normaliseEntry(raw: {
  summary?: string;
  tags?: string[];
  complexity?: string;
}): EnrichmentEntry {
  const summary = (raw.summary ?? "").slice(0, 200).trim();
  const tags = Array.isArray(raw.tags)
    ? raw.tags
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.toLowerCase().trim())
        .filter(Boolean)
        .slice(0, 3)
    : [];
  const complexity =
    raw.complexity === "low" ||
    raw.complexity === "medium" ||
    raw.complexity === "high"
      ? raw.complexity
      : "low";
  return { summary, tags, complexity };
}

export async function enrichGraphSymbols(
  nodes: readonly GraphNode[],
  options: EnrichmentOptions
): Promise<EnrichmentResult> {
  if (!options.apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required for --enrich.");
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is unavailable; Node 18+ is required.");
  }

  const model = options.model ?? DEFAULT_MODEL;
  const maxSymbols = options.maxSymbols ?? DEFAULT_MAX_SYMBOLS;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;

  const targets = selectEnrichmentTargets(nodes, maxSymbols);
  const entries: Record<string, EnrichmentEntry> = {};
  let apiCalls = 0;

  for (let i = 0; i < targets.length; i += batchSize) {
    const batch = targets.slice(i, i + batchSize);
    const payload = batch.map((n) => ({
      id: n.id,
      name: n.label,
      kind: n.kind,
      lang: n.lang,
      exported: n.exported,
      path: n.path
    }));

    const body = {
      model,
      max_tokens: 1024,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" }
        }
      ],
      messages: [
        {
          role: "user",
          content: JSON.stringify(payload)
        }
      ]
    };

    const response = await fetchImpl(ANTHROPIC_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": options.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(body)
    });
    apiCalls++;

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(
        `Anthropic API error (${response.status}): ${errText.slice(0, 300)}`
      );
    }
    const data = (await response.json()) as AnthropicResponse;
    const text =
      data.content
        ?.filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("") ?? "";

    const parsed = parseBatchResponse(text);
    if (!parsed?.entries) continue;

    for (const item of parsed.entries) {
      if (!item.id) continue;
      entries[item.id] = normaliseEntry(item);
    }
  }

  return {
    entries,
    apiCalls,
    symbolsProcessed: targets.length
  };
}

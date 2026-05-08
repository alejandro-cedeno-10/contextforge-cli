import { promises as fs } from "node:fs";
import path from "node:path";

import type {
  CallSite,
  HeritageRelation,
  ImportStatement,
  ParserCapture,
  ParserLanguage,
  ReferenceSite
} from "../parser/treeSitter.js";
import { PARSER_VERSION } from "../parser/treeSitter.js";
import { SCHEMA_VERSIONS } from "../schema/versions.js";

export interface FileParseFragment {
  language: ParserLanguage | null;
  captures: ParserCapture[];
  imports: ImportStatement[];
  heritage: HeritageRelation[];
  calls: CallSite[];
  references: ReferenceSite[];
}

export interface FileGraphFragment {
  hash: string;
  fragment: FileParseFragment;
}

export interface GraphCache {
  schemaVersion: string;
  parserVersion: string;
  entries: Record<string, FileGraphFragment>;
}

export const GRAPH_CACHE_FILE = ".contextforge/graph.cache.json";

export function emptyCache(): GraphCache {
  return {
    schemaVersion: SCHEMA_VERSIONS.graph,
    parserVersion: PARSER_VERSION,
    entries: {}
  };
}

function isCompatible(cache: GraphCache): boolean {
  return (
    cache.schemaVersion === SCHEMA_VERSIONS.graph &&
    cache.parserVersion === PARSER_VERSION
  );
}

export async function loadCache(root: string): Promise<GraphCache | null> {
  const filePath = path.join(root, GRAPH_CACHE_FILE);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
  let parsed: GraphCache;
  try {
    parsed = JSON.parse(raw) as GraphCache;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  if (!isCompatible(parsed)) return null;
  if (!parsed.entries || typeof parsed.entries !== "object") return null;
  return parsed;
}

export async function saveCache(
  root: string,
  cache: GraphCache
): Promise<void> {
  const filePath = path.join(root, GRAPH_CACHE_FILE);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

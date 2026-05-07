import { promises as fs } from "node:fs";
import path from "node:path";

export type ParserLanguage =
  | "typescript"
  | "tsx"
  | "javascript"
  | "jsx"
  | "python"
  | "go"
  | "rust"
  | "java";

export type FallbackReason =
  | "unsupported_language"
  | "grammar_unavailable"
  | "parse_failed";

export interface ParserCapture {
  type: string;
  name: string;
  line: number;
}

export interface ImportStatement {
  source: string;
  line: number;
}

export interface ParseFileResult {
  ok: boolean;
  language: ParserLanguage | null;
  ast: Record<string, unknown> | null;
  captures: ParserCapture[];
  imports: ImportStatement[];
  fallbackReason?: FallbackReason;
}

export interface ParserEngine {
  loadGrammar(language: ParserLanguage): Promise<void>;
  parse(
    source: string,
    language: ParserLanguage
  ): Promise<Record<string, unknown>>;
  capture(
    ast: Record<string, unknown>,
    language: ParserLanguage
  ): ParserCapture[];
}

export interface ParseFileOptions {
  language?: ParserLanguage;
  engine?: ParserEngine | null;
}

const EXTENSION_LANGUAGE_MAP: Readonly<Record<string, ParserLanguage>> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "jsx",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java"
};

export function detectLanguageFromPath(
  filePath: string
): ParserLanguage | null {
  const extension = path.extname(filePath).toLowerCase();
  return EXTENSION_LANGUAGE_MAP[extension] ?? null;
}

const JS_LIKE: ReadonlySet<ParserLanguage> = new Set([
  "typescript",
  "tsx",
  "javascript",
  "jsx"
]);

function heuristicCaptures(
  source: string,
  language: ParserLanguage
): ParserCapture[] {
  const captures: ParserCapture[] = [];
  const lines = source.split(/\r?\n/);

  lines.forEach((line, index) => {
    const lineNum = index + 1;

    if (JS_LIKE.has(language)) {
      const fn = line.match(
        /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*[(<]/
      );
      if (fn) {
        captures.push({
          type: "function_declaration",
          name: fn[1] ?? "anonymous",
          line: lineNum
        });
        return;
      }

      const cls = line.match(
        /^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)\s*[<{(]/
      );
      if (cls) {
        captures.push({
          type: "class_declaration",
          name: cls[1]!,
          line: lineNum
        });
        return;
      }

      const iface = line.match(
        /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)\s*[<{]/
      );
      if (iface) {
        captures.push({
          type: "interface_declaration",
          name: iface[1]!,
          line: lineNum
        });
        return;
      }

      const typeAlias = line.match(
        /^\s*export\s+type\s+([A-Za-z_$][\w$]*)\s*[<=]/
      );
      if (typeAlias) {
        captures.push({
          type: "type_alias_declaration",
          name: typeAlias[1]!,
          line: lineNum
        });
        return;
      }

      const constExport = line.match(
        /^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[=:]/
      );
      if (constExport) {
        captures.push({
          type: "variable_declaration",
          name: constExport[1]!,
          line: lineNum
        });
        return;
      }

      const enumDecl = line.match(
        /^\s*(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)\s*\{/
      );
      if (enumDecl) {
        captures.push({
          type: "enum_declaration",
          name: enumDecl[1]!,
          line: lineNum
        });
        return;
      }
    }

    if (language === "python") {
      const klass = line.match(/^\s*class\s+([A-Za-z_][\w]*)\b/);
      if (klass) {
        captures.push({
          type: "class_definition",
          name: klass[1] ?? "Anonymous",
          line: lineNum
        });
        return;
      }

      const fn = line.match(/^\s*def\s+([A-Za-z_][\w]*)\s*\(/);
      if (fn) {
        captures.push({
          type: "function_definition",
          name: fn[1]!,
          line: lineNum
        });
        return;
      }
    }

    if (language === "go") {
      const fn = line.match(
        /^\s*func\s+(?:\([^)]+\)\s+)?([A-Za-z_][\w]*)\s*\(/
      );
      if (fn) {
        captures.push({
          type: "function_declaration",
          name: fn[1]!,
          line: lineNum
        });
        return;
      }

      const typeDef = line.match(
        /^\s*type\s+([A-Za-z_][\w]*)\s+(?:struct|interface)\b/
      );
      if (typeDef) {
        captures.push({
          type: "type_declaration",
          name: typeDef[1]!,
          line: lineNum
        });
        return;
      }
    }

    if (language === "rust") {
      const fn = line.match(
        /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)\s*[<(]/
      );
      if (fn) {
        captures.push({ type: "function_item", name: fn[1]!, line: lineNum });
        return;
      }

      const structEnum = line.match(
        /^\s*(?:pub\s+)?(?:struct|enum)\s+([A-Za-z_][\w]*)\b/
      );
      if (structEnum) {
        captures.push({
          type: "struct_item",
          name: structEnum[1]!,
          line: lineNum
        });
        return;
      }
    }

    if (language === "java") {
      const cls = line.match(
        /^\s*(?:public\s+|private\s+|protected\s+)?(?:abstract\s+|final\s+)?class\s+([A-Za-z_][\w]*)\b/
      );
      if (cls) {
        captures.push({
          type: "class_declaration",
          name: cls[1]!,
          line: lineNum
        });
        return;
      }

      const method = line.match(
        /^\s*(?:public|private|protected)\s+(?:static\s+)?(?:\w+\s+)+([A-Za-z_][\w]*)\s*\(/
      );
      if (method) {
        captures.push({
          type: "method_declaration",
          name: method[1]!,
          line: lineNum
        });
      }
    }
  });

  return captures;
}

function extractHeuristicImports(
  source: string,
  language: ParserLanguage
): ImportStatement[] {
  const imports: ImportStatement[] = [];
  const lines = source.split(/\r?\n/);

  if (JS_LIKE.has(language)) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;

      // Single-line: import ... from 'src'
      const single = line.match(
        /^\s*import\s+(?:type\s+)?[^'"]*\s+from\s+['"]([^'"]+)['"]/
      );
      if (single?.[1]) {
        imports.push({ source: single[1], line: lineNum });
        continue;
      }

      // Side-effect: import 'src'
      const sideEffect = line.match(/^\s*import\s+['"]([^'"]+)['"]/);
      if (sideEffect?.[1]) {
        imports.push({ source: sideEffect[1], line: lineNum });
        continue;
      }

      // End of multi-line import: } from 'src'
      const multiEnd = line.match(/^\s*\}?\s*from\s+['"]([^'"]+)['"]/);
      if (multiEnd?.[1]) {
        imports.push({ source: multiEnd[1], line: lineNum });
      }
    }
  }

  if (language === "python") {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;

      const fromImport = line.match(/^\s*from\s+([\w.]+)\s+import\b/);
      if (fromImport?.[1]) {
        imports.push({ source: fromImport[1], line: lineNum });
        continue;
      }

      const plainImport = line.match(/^\s*import\s+([\w.]+)/);
      if (plainImport?.[1]) {
        imports.push({ source: plainImport[1], line: lineNum });
      }
    }
  }

  if (language === "go") {
    let inImportBlock = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;

      if (/^\s*import\s+\(/.test(line)) {
        inImportBlock = true;
        continue;
      }
      if (inImportBlock && /^\s*\)/.test(line)) {
        inImportBlock = false;
        continue;
      }

      if (inImportBlock) {
        const src = line.match(/^\s*(?:[\w]+\s+)?["']([^"']+)["']/);
        if (src?.[1]) imports.push({ source: src[1], line: lineNum });
      } else {
        const single = line.match(/^\s*import\s+["']([^"']+)["']/);
        if (single?.[1]) imports.push({ source: single[1], line: lineNum });
      }
    }
  }

  return imports;
}

export async function parseFile(
  filePath: string,
  options: ParseFileOptions = {}
): Promise<ParseFileResult> {
  const language = options.language ?? detectLanguageFromPath(filePath);

  if (!language) {
    return {
      ok: false,
      language: null,
      ast: null,
      captures: [],
      imports: [],
      fallbackReason: "unsupported_language"
    };
  }

  let source: string;
  try {
    source = await fs.readFile(filePath, "utf8");
  } catch {
    return {
      ok: false,
      language,
      ast: null,
      captures: [],
      imports: [],
      fallbackReason: "parse_failed"
    };
  }

  if (!options.engine) {
    return {
      ok: true,
      language,
      ast: {
        engine: "heuristic",
        language,
        byteLength: source.length
      },
      captures: heuristicCaptures(source, language),
      imports: extractHeuristicImports(source, language)
    };
  }

  try {
    await options.engine.loadGrammar(language);
  } catch {
    return {
      ok: false,
      language,
      ast: null,
      captures: [],
      imports: [],
      fallbackReason: "grammar_unavailable"
    };
  }

  try {
    const ast = await options.engine.parse(source, language);
    return {
      ok: true,
      language,
      ast,
      captures: options.engine.capture(ast, language),
      imports: []
    };
  } catch {
    return {
      ok: false,
      language,
      ast: null,
      captures: [],
      imports: [],
      fallbackReason: "parse_failed"
    };
  }
}

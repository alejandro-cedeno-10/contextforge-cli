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
  exported: boolean;
}

export interface ImportStatement {
  source: string;
  line: number;
}

export type HeritageKind = "extends" | "implements";

export interface HeritageRelation {
  kind: HeritageKind;
  childName: string;
  parentName: string;
  line: number;
}

export interface CallSite {
  name: string;
  line: number;
}

export interface ReferenceSite {
  name: string;
  line: number;
}

export interface ParseFileResult {
  ok: boolean;
  language: ParserLanguage | null;
  ast: Record<string, unknown> | null;
  captures: ParserCapture[];
  imports: ImportStatement[];
  heritage: HeritageRelation[];
  calls: CallSite[];
  references: ReferenceSite[];
  fallbackReason?: FallbackReason;
}

export const PARSER_VERSION = "heuristic-3";

const CALL_RESERVED = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "typeof",
  "in",
  "of",
  "throw",
  "new",
  "await",
  "yield",
  "delete",
  "void",
  "case",
  "do",
  "else",
  "function",
  "class",
  "import",
  "from",
  "as",
  "with",
  "instanceof"
]);

function stripStringsAndComments(line: string): string {
  // Replace string literals and inline comments with spaces so the call
  // regex below cannot match identifiers inside them. Multi-line block
  // comments are not handled — false positives there are accepted noise.
  let result = "";
  let i = 0;
  while (i < line.length) {
    const ch = line[i]!;
    if (ch === "/" && line[i + 1] === "/") break;
    if (ch === "/" && line[i + 1] === "*") {
      const end = line.indexOf("*/", i + 2);
      if (end === -1) break;
      result += " ".repeat(end + 2 - i);
      i = end + 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      result += " ";
      i++;
      while (i < line.length && line[i] !== quote) {
        if (line[i] === "\\" && i + 1 < line.length) {
          result += "  ";
          i += 2;
          continue;
        }
        result += " ";
        i++;
      }
      if (i < line.length) {
        result += " ";
        i++;
      }
      continue;
    }
    result += ch;
    i++;
  }
  return result;
}

function extractHeuristicReferences(
  source: string,
  language: ParserLanguage
): ReferenceSite[] {
  if (!JS_LIKE.has(language) && language !== "python") return [];
  const refs: ReferenceSite[] = [];
  const lines = source.split(/\r?\n/);
  // PascalCase only — restricts to types/classes/interfaces/enums to
  // dramatically reduce noise. Lowercase identifiers (variables, params)
  // would explode the edge count without adding signal a regex can trust.
  const refRegex = /\b([A-Z][\w$]*)\b(?!\s*\()/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Skip lines that are clearly imports or definitions — those identifiers
    // are already handled by `imports`/`heritage`/`defines`. We DO NOT skip
    // every line starting with `export` because `export const x: User = ...`
    // contains a real reference to `User`.
    if (
      /^\s*import\b/.test(line) ||
      /^\s*export\s+(?:type\s+)?\{/.test(line) ||
      /^\s*\}?\s*from\s+['"]/.test(line) ||
      /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:class|interface|type|enum|function)\s+[A-Za-z_$][\w$]*/.test(
        line
      )
    ) {
      continue;
    }

    const sanitized = stripStringsAndComments(line);
    let match: RegExpExecArray | null;
    refRegex.lastIndex = 0;
    while ((match = refRegex.exec(sanitized)) !== null) {
      const name = match[1]!;
      if (CALL_RESERVED.has(name)) continue;
      refs.push({ name, line: i + 1 });
    }
  }
  return refs;
}

function extractHeuristicCalls(
  source: string,
  language: ParserLanguage
): CallSite[] {
  if (!JS_LIKE.has(language) && language !== "python") return [];
  const calls: CallSite[] = [];
  const lines = source.split(/\r?\n/);
  const callRegex = /\b([A-Za-z_$][\w$]*)\s*\(/g;

  for (let i = 0; i < lines.length; i++) {
    const sanitized = stripStringsAndComments(lines[i]!);
    let match: RegExpExecArray | null;
    callRegex.lastIndex = 0;
    while ((match = callRegex.exec(sanitized)) !== null) {
      const name = match[1]!;
      if (CALL_RESERVED.has(name)) continue;
      // Skip definitions: `function foo(` or `class Foo(` (Python class def)
      // by checking the token immediately preceding the match.
      const before = sanitized.slice(0, match.index).trimEnd();
      const lastToken = before.split(/[\s(){};,=:<>+\-*/%!|&^?]+/).filter(Boolean).pop();
      if (
        lastToken === "function" ||
        lastToken === "class" ||
        lastToken === "def" ||
        lastToken === "interface" ||
        lastToken === "enum" ||
        lastToken === "type"
      ) {
        continue;
      }
      calls.push({ name, line: i + 1 });
    }
  }
  return calls;
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

interface HeuristicResult {
  captures: ParserCapture[];
  heritage: HeritageRelation[];
}

function splitHeritageList(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .map((part) => part.replace(/<.*$/, "").trim())
    .filter((part) => /^[A-Za-z_$][\w$.]*$/.test(part));
}

function heuristicCaptures(
  source: string,
  language: ParserLanguage
): HeuristicResult {
  const captures: ParserCapture[] = [];
  const heritage: HeritageRelation[] = [];
  const lines = source.split(/\r?\n/);

  lines.forEach((line, index) => {
    const lineNum = index + 1;

    if (JS_LIKE.has(language)) {
      const fn = line.match(
        /^\s*(export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*[(<]/
      );
      if (fn) {
        captures.push({
          type: "function_declaration",
          name: fn[2] ?? "anonymous",
          line: lineNum,
          exported: Boolean(fn[1])
        });
        return;
      }

      const cls = line.match(
        /^\s*(export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)(?:\s*<[^>]*>)?(?:\s+extends\s+([A-Za-z_$][\w$.]*(?:\s*<[^>]*>)?))?(?:\s+implements\s+([A-Za-z_$][\w$.,\s<>]*?))?\s*\{/
      );
      if (cls) {
        const childName = cls[2]!;
        captures.push({
          type: "class_declaration",
          name: childName,
          line: lineNum,
          exported: Boolean(cls[1])
        });
        if (cls[3]) {
          const parentName = cls[3].replace(/<.*$/, "").trim();
          if (parentName) {
            heritage.push({
              kind: "extends",
              childName,
              parentName,
              line: lineNum
            });
          }
        }
        if (cls[4]) {
          for (const parent of splitHeritageList(cls[4])) {
            heritage.push({
              kind: "implements",
              childName,
              parentName: parent,
              line: lineNum
            });
          }
        }
        return;
      }

      const iface = line.match(
        /^\s*(export\s+)?interface\s+([A-Za-z_$][\w$]*)(?:\s*<[^>]*>)?(?:\s+extends\s+([A-Za-z_$][\w$.,\s<>]*?))?\s*\{/
      );
      if (iface) {
        const childName = iface[2]!;
        captures.push({
          type: "interface_declaration",
          name: childName,
          line: lineNum,
          exported: Boolean(iface[1])
        });
        if (iface[3]) {
          for (const parent of splitHeritageList(iface[3])) {
            heritage.push({
              kind: "extends",
              childName,
              parentName: parent,
              line: lineNum
            });
          }
        }
        return;
      }

      const typeAlias = line.match(
        /^\s*(export\s+)?type\s+([A-Za-z_$][\w$]*)\s*[<=]/
      );
      if (typeAlias) {
        captures.push({
          type: "type_alias_declaration",
          name: typeAlias[2]!,
          line: lineNum,
          exported: Boolean(typeAlias[1])
        });
        return;
      }

      const varDecl = line.match(
        /^\s*(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[=:]/
      );
      if (varDecl) {
        captures.push({
          type: "variable_declaration",
          name: varDecl[2]!,
          line: lineNum,
          exported: Boolean(varDecl[1])
        });
        return;
      }

      const enumDecl = line.match(
        /^\s*(export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)\s*\{/
      );
      if (enumDecl) {
        captures.push({
          type: "enum_declaration",
          name: enumDecl[2]!,
          line: lineNum,
          exported: Boolean(enumDecl[1])
        });
        return;
      }
    }

    if (language === "python") {
      const klass = line.match(
        /^\s*class\s+([A-Za-z_][\w]*)\s*(?:\(([^)]*)\))?\s*:/
      );
      if (klass) {
        const childName = klass[1] ?? "Anonymous";
        captures.push({
          type: "class_definition",
          name: childName,
          line: lineNum,
          exported: !childName.startsWith("_")
        });
        if (klass[2]) {
          for (const parent of splitHeritageList(klass[2])) {
            heritage.push({
              kind: "extends",
              childName,
              parentName: parent,
              line: lineNum
            });
          }
        }
        return;
      }

      const fn = line.match(/^\s*def\s+([A-Za-z_][\w]*)\s*\(/);
      if (fn) {
        const name = fn[1]!;
        captures.push({
          type: "function_definition",
          name,
          line: lineNum,
          exported: !name.startsWith("_")
        });
        return;
      }
    }

    if (language === "go") {
      const fn = line.match(
        /^\s*func\s+(?:\([^)]+\)\s+)?([A-Za-z_][\w]*)\s*\(/
      );
      if (fn) {
        const name = fn[1]!;
        captures.push({
          type: "function_declaration",
          name,
          line: lineNum,
          exported: /^[A-Z]/.test(name)
        });
        return;
      }

      const typeDef = line.match(
        /^\s*type\s+([A-Za-z_][\w]*)\s+(?:struct|interface)\b/
      );
      if (typeDef) {
        const name = typeDef[1]!;
        captures.push({
          type: "type_declaration",
          name,
          line: lineNum,
          exported: /^[A-Z]/.test(name)
        });
        return;
      }
    }

    if (language === "rust") {
      const fn = line.match(
        /^\s*(pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)\s*[<(]/
      );
      if (fn) {
        captures.push({
          type: "function_item",
          name: fn[2]!,
          line: lineNum,
          exported: Boolean(fn[1])
        });
        return;
      }

      const structEnum = line.match(
        /^\s*(pub\s+)?(?:struct|enum)\s+([A-Za-z_][\w]*)\b/
      );
      if (structEnum) {
        captures.push({
          type: "struct_item",
          name: structEnum[2]!,
          line: lineNum,
          exported: Boolean(structEnum[1])
        });
        return;
      }
    }

    if (language === "java") {
      const cls = line.match(
        /^\s*(public\s+|private\s+|protected\s+)?(?:abstract\s+|final\s+)?class\s+([A-Za-z_][\w]*)(?:\s*<[^>]*>)?(?:\s+extends\s+([A-Za-z_][\w.]*(?:\s*<[^>]*>)?))?(?:\s+implements\s+([A-Za-z_][\w.,\s<>]*?))?\s*\{?/
      );
      if (cls) {
        const childName = cls[2]!;
        captures.push({
          type: "class_declaration",
          name: childName,
          line: lineNum,
          exported: cls[1]?.trim() === "public"
        });
        if (cls[3]) {
          const parent = cls[3].replace(/<.*$/, "").trim();
          if (parent) {
            heritage.push({
              kind: "extends",
              childName,
              parentName: parent,
              line: lineNum
            });
          }
        }
        if (cls[4]) {
          for (const parent of splitHeritageList(cls[4])) {
            heritage.push({
              kind: "implements",
              childName,
              parentName: parent,
              line: lineNum
            });
          }
        }
        return;
      }

      const method = line.match(
        /^\s*(public|private|protected)\s+(?:static\s+)?(?:\w+\s+)+([A-Za-z_][\w]*)\s*\(/
      );
      if (method) {
        captures.push({
          type: "method_declaration",
          name: method[2]!,
          line: lineNum,
          exported: method[1] === "public"
        });
      }
    }
  });

  return { captures, heritage };
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
      heritage: [],
      calls: [],
      references: [],
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
      heritage: [],
      calls: [],
      references: [],
      fallbackReason: "parse_failed"
    };
  }

  if (!options.engine) {
    const { captures, heritage } = heuristicCaptures(source, language);
    return {
      ok: true,
      language,
      ast: {
        engine: "heuristic",
        language,
        byteLength: source.length
      },
      captures,
      imports: extractHeuristicImports(source, language),
      heritage,
      calls: extractHeuristicCalls(source, language),
      references: extractHeuristicReferences(source, language)
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
      heritage: [],
      calls: [],
      references: [],
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
      imports: [],
      heritage: [],
      calls: [],
      references: []
    };
  } catch {
    return {
      ok: false,
      language,
      ast: null,
      captures: [],
      imports: [],
      heritage: [],
      calls: [],
      references: [],
      fallbackReason: "parse_failed"
    };
  }
}

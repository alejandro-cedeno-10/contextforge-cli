export interface GuardrailViolation {
  rule: string;
  detail: string;
  file?: string;
}

export interface ValidatorResult {
  passed: boolean;
  violations: GuardrailViolation[];
  ranAt: string;
}

export interface Guardrails {
  allowedFiles: string[];
  forbiddenPaths: string[];
  maxLocDelta: number;
  maxFilesChanged?: number;
}

function globToRegex(pattern: string): RegExp {
  let s = "";
  let i = 0;
  const special = new Set([
    ".",
    "+",
    "^",
    "$",
    "{",
    "}",
    "(",
    ")",
    "|",
    "[",
    "]",
    "\\"
  ]);

  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*" && i + 1 < pattern.length && pattern[i + 1] === "*") {
      if (i + 2 < pattern.length && pattern[i + 2] === "/") {
        // **/ = optional path prefix
        s += "(.*/)?";
        i += 3;
      } else {
        s += ".*";
        i += 2;
      }
    } else if (ch === "*") {
      s += "[^/]*";
      i++;
    } else if (ch === "?") {
      s += "[^/]";
      i++;
    } else if (special.has(ch)) {
      s += `\\${ch}`;
      i++;
    } else {
      s += ch;
      i++;
    }
  }
  return new RegExp(`^${s}$`);
}

function matchesGlob(filePath: string, pattern: string): boolean {
  const fp = filePath.replace(/\\/g, "/");
  const p = pattern.replace(/\\/g, "/");
  if (fp === p) return true;
  return globToRegex(p).test(fp);
}

export function validateGuardrails(
  changedFiles: string[],
  locDelta: number,
  guardrails: Guardrails
): ValidatorResult {
  const violations: GuardrailViolation[] = [];

  for (const file of changedFiles) {
    const isForbidden = guardrails.forbiddenPaths.some((p) =>
      matchesGlob(file, p)
    );
    if (isForbidden) {
      violations.push({
        rule: "forbiddenPath",
        detail: `Archivo prohibido modificado: ${file}`,
        file
      });
      continue;
    }

    if (guardrails.allowedFiles.length > 0) {
      const isAllowed = guardrails.allowedFiles.some(
        (p) => p === file || matchesGlob(file, p)
      );
      if (!isAllowed) {
        violations.push({
          rule: "outsideAllowedFiles",
          detail: `Archivo fuera de allowedFiles: ${file}`,
          file
        });
      }
    }
  }

  if (locDelta > guardrails.maxLocDelta) {
    violations.push({
      rule: "maxLocDelta",
      detail: `LOC delta ${locDelta} excede maxLocDelta ${guardrails.maxLocDelta}`
    });
  }

  if (
    guardrails.maxFilesChanged !== undefined &&
    changedFiles.length > guardrails.maxFilesChanged
  ) {
    violations.push({
      rule: "maxFilesChanged",
      detail: `${changedFiles.length} archivos modificados excede maxFilesChanged ${guardrails.maxFilesChanged}`
    });
  }

  return {
    passed: violations.length === 0,
    violations,
    ranAt: new Date().toISOString()
  };
}

export interface SpecFile {
  path: string;
  reason: string;
  mode: string;
}

export interface SDDContext {
  title: string;
  task: string;
  seeds?: string[];
  affectedFiles: SpecFile[];
  acceptanceCriteria?: string[];
  risks?: string[];
}

export function renderSDD(ctx: SDDContext): string {
  const fileList =
    ctx.affectedFiles.length > 0
      ? ctx.affectedFiles
          .map((f) => `  - \`${f.path}\` (${f.reason}, mode: ${f.mode})`)
          .join("\n")
      : "  - (ninguno seleccionado)";

  const seedList =
    (ctx.seeds ?? []).length > 0
      ? (ctx.seeds ?? []).map((s) => `  - ${s}`).join("\n")
      : "  - (ninguna semilla explicita)";

  const criteria = (
    ctx.acceptanceCriteria ?? [
      "Los cambios pasan todos los tests existentes (`pnpm test`)",
      "Los archivos modificados pertenecen al context-pack",
      "No se introducen nuevas dependencias sin aprobacion",
      "`forge implement --check` sale con codigo 0"
    ]
  )
    .map((c) => `- [ ] ${c}`)
    .join("\n");

  const risks = (
    ctx.risks ?? [
      "Cambios fuera del context-pack pueden introducir regresiones",
      "Tokens excedidos si se agregan archivos no incluidos en el pack"
    ]
  )
    .map((r) => `- ${r}`)
    .join("\n");

  return `# Spec SDD: ${ctx.title}

## Titulo
${ctx.title}

## Tarea
${ctx.task}

## Seeds
${seedList}

## Archivos afectados (context-pack)
${fileList}

## Problema
Describir el problema concreto a resolver.

## Alcance
- En alcance:
- Fuera de alcance:

## Contexto tecnico
- Artefactos base:
  - .contextforge/scan.json
  - .contextforge/graph.json
  - .contextforge/context-pack.json

## Criterios de aceptacion
${criteria}

## Riesgos
${risks}

## Plan de pruebas
- Ejecutar suite completa: \`pnpm test\`
- Verificar guardrails: \`pnpm forge implement --check\`
- Revisar ledger: \`.contextforge/token-ledger.json\`

## Tareas
- [ ] T1: Revisar archivos del context-pack
- [ ] T2: Implementar cambios minimos dentro de guardrails
- [ ] T3: Verificar criterios de aceptacion
`;
}

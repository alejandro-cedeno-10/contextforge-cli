---
title: "Verificar instalación y features — v0.3.5"
description: "Comandos para actualizar a v0.3.5 y probar todas las features: viz con agrupación, forge init pipeline, manifest por herramienta, token savings."
audience: dev
type: how-to
tags: [release, verification, v0.3.5, install]
updated: 2026-05-08
---

# Verificar instalación y features — v0.3.5

Guía paso a paso para actualizar a `v0.3.5` y confirmar que cada feature
funciona correctamente en tu repo.

## 1. Actualizar

```bash
# Global (recomendado para usar `forge` en cualquier repo)
pnpm add -g @anai-raia-alex/contextforge-cli@0.3.5

# Verificar versión
forge --version
# → 0.3.5
```

Si usás Docker para el MCP server, actualiza la imagen también:

```bash
docker pull ghcr.io/alejandro-cedeno-10/contextforge-mcp:latest
```

---

## 2. Feature: `forge init` — pipeline completo

Posiciónate en la raíz de cualquier repo y corre:

```bash
forge init
```

**Qué debería pasar (en orden):**

```
ContextForge inicializado.
Generado .contextforge/agent-context.md ...

Indexando repo...
  Escaneados N archivos → .contextforge/scan.json
  Grafo construido → .contextforge/graph.json (X nodos, Y edges)

Generando context-pack inicial...
  Context-pack → .contextforge/context-pack.json
  Token-ledger → .contextforge/token-ledger.json
  Manifest     → .contextforge/agent-manifest.json
               → .claude/agent-manifest.md
               → .cursor/rules/contextforge-active.mdc

Generando visualización...
  Escrito .contextforge/graph.html

Listo. Abre .contextforge/graph.html para ver el grafo del proyecto.
```

**Verificar artefactos generados:**

```powershell
# PowerShell
Get-ChildItem .contextforge/ | Select-Object Name, Length

# Debe listar: scan.json, graph.json, context-pack.json,
#              token-ledger.json, agent-manifest.json, graph.html
```

```bash
# bash / WSL
ls -lh .contextforge/
```

---

## 3. Feature: token savings

```powershell
Get-Content .contextforge/token-ledger.json | ConvertFrom-Json |
  Select-Object -ExpandProperty savings
```

Esperado: `savingsPct` > 80 en repos medianos/grandes. En repos muy pequeños
el ratio es menor porque hay poco que filtrar.

---

## 4. Feature: `forge viz` — grafo con agrupación

```bash
forge viz
```

Abre el HTML:

```powershell
start .contextforge/graph.html
```

**Checklist visual:**

- [ ] La página carga (no blanco, no errores en F12 → Console)
- [ ] Se ven nodos y edges en la vista "Grafo"
- [ ] El botón **"Agrupar"** aparece en la barra de filtros (junto a "Solo pack"
      y "+ Simbolos")
- [ ] Al hacer click en "Agrupar", los nodos se reorganizan en cajas por
      dominio (bordes sólidos) y sub-carpeta (bordes punteados)
- [ ] Click en una caja de dominio → colapsa mostrando `<nombre> (N)`
- [ ] Click de nuevo → expande los archivos
- [ ] Vista "Dominios" → sidebar muestra árbol con flechas expandibles por
      sub-carpeta

---

## 5. Feature: manifest por herramienta

```bash
forge context "descripción de alguna tarea tuya"
```

**Verificar que se generaron los tres archivos por herramienta:**

```bash
# Claude Code
cat .claude/agent-manifest.md | head -30

# Cursor
cat .cursor/rules/contextforge-active.mdc | head -20

# OpenCode
cat .contextforge/manifests/opencode-readme.md | head -20
```

Cada archivo debe tener contenido diferente (formato adaptado a cada
herramienta) pero basado en los mismos dominios del pack.

**Ver qué skills quedaron activas:**

```powershell
Get-Content .contextforge/agent-manifest.json | ConvertFrom-Json |
  Select-Object -ExpandProperty activeSkills |
  ForEach-Object { $_.name }
```

---

## 6. Feature: activación selectiva de skills

```bash
# Primero genera las skills base del grafo
forge skills

# Luego corre context con tareas distintas y compará los manifests
forge context "fix bug en base de datos"
cat .contextforge/agent-manifest.json | grep -A2 '"activeSkills"'

forge context "actualizar estilos CSS del dashboard"
cat .contextforge/agent-manifest.json | grep -A2 '"activeSkills"'
```

Esperado: diferentes tareas → diferentes skills activas.

---

## 7. Feature: scaffold de documentación

```bash
forge docs
```

Debe crear (o reportar `[skip]` si ya existen):

- `docs/INDEX.md`
- `docs/adr/README.md`
- `docs/architecture/module-relationships.md`
- Carpetas: `docs/tutorials/`, `docs/how-to/`, `docs/reference/`,
  `docs/explanation/`

---

## 8. Flujo SDD completo (requiere `openspec` CLI)

```bash
npm i -g @fission-ai/openspec   # si no lo tenés
openspec --version

# En tu repo
forge spec mi-feature-id
# → .contextforge/spec-input.json
# → .contextforge/spec-prompt.md  (o scaffold openspec si está en PATH)

forge implement mi-feature-id
# → .contextforge/implement-plan.json

# Después de tocar código
forge implement --check
# → valida diff vs allowedFiles del plan
```

---

## Resumen de comandos de verificación rápida

```bash
forge --version                          # → 0.3.5
forge init                               # pipeline completo
start .contextforge/graph.html           # abre viz (Windows)
open .contextforge/graph.html            # abre viz (Mac/Linux)
forge context "tarea de prueba"
forge skills
forge docs
```

export interface VizNode {
  id: string;
  type: string;
  label: string;
  path?: string;
  kind?: string;
  lang?: string;
  exported?: boolean;
}

export interface VizEdge {
  from: string;
  to: string;
  type: string;
  weight?: number;
}

export interface VizPackFile {
  path: string;
  reason: string;
  mode: string;
}

export interface VizParams {
  projectName: string;
  generatedAt: string;
  nodes: VizNode[];
  edges: VizEdge[];
  stats: Record<string, unknown>;
  packFiles: VizPackFile[];
  task?: string;
}

export function generateVizHtml(p: VizParams): string {
  const graphJson = JSON.stringify({
    nodes: p.nodes,
    edges: p.edges,
    stats: p.stats
  });
  const packJson = JSON.stringify(p.packFiles);
  const meta = JSON.stringify({
    projectName: p.projectName,
    generatedAt: p.generatedAt,
    task: p.task ?? ""
  });

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ContextForge — ${escHtml(p.projectName)}</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/cytoscape/3.30.2/cytoscape.min.js"></script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:#0d1117;color:#e6edf3;height:100vh;display:flex;flex-direction:column;overflow:hidden}

/* Header */
header{background:#161b22;border-bottom:1px solid #30363d;padding:8px 14px;display:flex;align-items:center;gap:10px;flex-shrink:0;flex-wrap:wrap}
header h1{font-size:14px;font-weight:700;color:#f0f6fc;letter-spacing:.3px;white-space:nowrap}
header h1 span{color:#58a6ff}
.view-toggle{display:flex;gap:4px;background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:3px}
.view-toggle .btn{padding:4px 12px;border-radius:4px;font-size:12px;border:none;background:transparent;color:#8b949e}
.view-toggle .btn.active{background:#21262d;color:#f0f6fc}
.badge{font-size:11px;padding:2px 8px;border-radius:10px;background:#21262d;color:#8b949e;border:1px solid #30363d;white-space:nowrap}
.task-label{font-size:11px;color:#8b949e;margin-left:auto;max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* Layout */
.layout{display:flex;flex:1;overflow:hidden}

/* Sidebar */
aside{width:272px;min-width:272px;background:#161b22;border-right:1px solid #30363d;display:flex;flex-direction:column;overflow:hidden}
.sidebar-scroll{flex:1;overflow-y:auto;padding:10px}
.sidebar-scroll::-webkit-scrollbar{width:4px}
.sidebar-scroll::-webkit-scrollbar-thumb{background:#30363d;border-radius:2px}
.section{margin-bottom:14px}
.section-title{font-size:10px;font-weight:600;color:#8b949e;text-transform:uppercase;letter-spacing:.8px;margin-bottom:7px}

/* Stats */
.stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px}
.stat{background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:7px;text-align:center}
.stat-value{font-size:17px;font-weight:700;color:#58a6ff}
.stat-label{font-size:10px;color:#8b949e;margin-top:1px}

/* Legend */
.legend-item{display:flex;align-items:center;gap:7px;padding:3px 5px;font-size:12px;cursor:pointer;border-radius:4px;transition:background .15s}
.legend-item:hover{background:#21262d}
.legend-item.dimmed{opacity:.35}
.dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.edge-line{width:18px;height:2px;flex-shrink:0;border-radius:1px}
.legend-count{margin-left:auto;font-size:10px;color:#8b949e}

/* Buttons */
.filter-row{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:7px}
.btn{font-size:11px;padding:4px 9px;border-radius:4px;border:1px solid #30363d;background:#21262d;color:#c9d1d9;cursor:pointer;transition:all .15s}
.btn:hover{background:#30363d;border-color:#58a6ff}
.btn.active{background:#1f6feb;border-color:#58a6ff;color:#fff}

/* Search */
.search-wrap{position:relative;margin-bottom:7px}
.search-wrap input{width:100%;background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:5px 8px 5px 28px;color:#e6edf3;font-size:12px;outline:none}
.search-wrap input:focus{border-color:#58a6ff}
.search-wrap .icon{position:absolute;left:8px;top:50%;transform:translateY(-50%);color:#8b949e;font-size:12px}

/* Node info panel */
.node-info{background:#0d1117;border:1px solid #30363d;border-radius:7px;padding:9px;font-size:12px}
.node-info.empty{color:#8b949e;text-align:center;padding:16px;font-style:italic;font-size:11px}
.node-path{font-family:monospace;font-size:10px;color:#58a6ff;word-break:break-all;margin-bottom:5px}
.node-summary{font-size:11px;color:#c9d1d9;line-height:1.5;margin-bottom:7px;padding:5px 7px;background:#161b22;border-radius:5px;border-left:2px solid #30363d}
.node-meta{display:flex;flex-wrap:wrap;gap:3px;margin-bottom:7px}
.tag{font-size:10px;padding:2px 5px;border-radius:4px;border:1px solid}
.tag-code{background:#0c2d6b;border-color:#1f6feb;color:#79c0ff}
.tag-test{background:#0a3622;border-color:#238636;color:#3fb950}
.tag-config{background:#21262d;border-color:#30363d;color:#8b949e}
.tag-doc{background:#3d2e00;border-color:#9e6a03;color:#e3b341}
.tag-schema{background:#2e1065;border-color:#6e40c9;color:#bc8cff}
.tag-pack{background:#3d2200;border-color:#f0883e;color:#f0883e}
.tag-domain{background:#1c2128;border-color:#484f58;color:#c9d1d9}
.connections{font-size:11px;color:#8b949e;max-height:160px;overflow-y:auto}
.connections strong{color:#c9d1d9;display:block;margin-top:5px;margin-bottom:2px;font-size:10px}
.connections a{color:#58a6ff;cursor:pointer;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:1px 0}
.connections a:hover{text-decoration:underline}

/* Tour */
.tour-bar{display:flex;align-items:center;gap:5px;background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:5px 8px}
.tour-pos{font-size:11px;color:#8b949e;flex:1;text-align:center}
.tour-btn{width:24px;height:24px;border-radius:4px;border:1px solid #30363d;background:#21262d;color:#c9d1d9;cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center}
.tour-btn:hover{background:#30363d;border-color:#58a6ff}

/* Domain list */
.domain-item{display:flex;align-items:center;gap:7px;padding:5px 7px;border-radius:6px;cursor:pointer;margin-bottom:3px;border:1px solid transparent;transition:all .15s}
.domain-item:hover{background:#21262d;border-color:#30363d}
.domain-item.selected{background:#0c2d6b;border-color:#1f6feb}
.domain-dot{width:10px;height:10px;border-radius:3px;flex-shrink:0}
.domain-name{font-size:12px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.domain-count{font-size:10px;color:#8b949e;white-space:nowrap}

/* Main */
main{flex:1;position:relative;overflow:hidden}
#cy{width:100%;height:100%;background:#0d1117}
.graph-controls{position:absolute;top:10px;right:10px;display:flex;flex-direction:column;gap:5px;z-index:10}
.ctrl-btn{width:30px;height:30px;border-radius:6px;background:#161b22;border:1px solid #30363d;color:#8b949e;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;transition:all .15s}
.ctrl-btn:hover{background:#21262d;color:#e6edf3;border-color:#58a6ff}
.toast{position:absolute;bottom:14px;right:14px;background:#161b22;border:1px solid #30363d;border-radius:7px;padding:6px 12px;font-size:11px;color:#8b949e;pointer-events:none;opacity:0;transition:opacity .3s}
.toast.show{opacity:1}

/* Domain view domain node info */
.domain-files-list{max-height:200px;overflow-y:auto;margin-top:6px}
.domain-file-item{font-size:10px;padding:2px 0;display:flex;align-items:center;gap:5px;color:#8b949e}
.domain-file-item.in-pack{color:#f0883e}

/* Compound group expand/collapse */
.domain-tree-toggle{font-size:9px;width:12px;color:#484f58;flex-shrink:0;transition:transform .15s;display:inline-block}
.domain-sub-folder .domain-sub-files{display:none;padding-left:14px}
.domain-sub-folder.open .domain-tree-toggle{transform:rotate(90deg)}
.domain-sub-folder.open .domain-sub-files{display:block}
.domain-sub-header{display:flex;align-items:center;gap:5px;padding:3px 5px;border-radius:4px;cursor:pointer;font-size:10px;color:#8b949e;margin-bottom:1px}
.domain-sub-header:hover{background:#21262d;color:#e6edf3}
.domain-sub-name{flex:1;font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.domain-tree-file{font-size:10px;padding:2px 4px;border-radius:3px;color:#8b949e;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.domain-tree-file.in-pack{color:#f0883e}
.domain-files-tree{display:none;padding:3px 0 6px 12px}
.domain-item.open + .domain-files-tree{display:block}
.domain-item .domain-tree-toggle{margin-right:2px}
</style>
</head>
<body>

<header>
  <h1><span>Context</span>Forge</h1>
  <div class="view-toggle">
    <button class="btn active" id="btn-view-graph" onclick="switchView('graph')">&#128279; Grafo</button>
    <button class="btn" id="btn-view-domain" onclick="switchView('domain')">&#9783; Dominios</button>
  </div>
  <span class="badge" id="hdr-nodes">0 nodos</span>
  <span class="badge" id="hdr-edges">0 edges</span>
  <span class="badge" id="hdr-pack">0 pack</span>
  <span class="task-label" id="hdr-task"></span>
</header>

<div class="layout">
<aside>
  <div class="sidebar-scroll">

    <!-- GRAPH SIDEBAR -->
    <div id="graph-sidebar">
      <div class="section">
        <div class="section-title">Estadisticas</div>
        <div class="stat-grid">
          <div class="stat"><div class="stat-value" id="s-files">0</div><div class="stat-label">archivos</div></div>
          <div class="stat"><div class="stat-value" id="s-symbols">0</div><div class="stat-label">simbolos</div></div>
          <div class="stat"><div class="stat-value" id="s-edges">0</div><div class="stat-label">edges</div></div>
          <div class="stat"><div class="stat-value" id="s-pack" style="color:#f0883e">0</div><div class="stat-label">en pack</div></div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Tour — context pack</div>
        <div class="tour-bar">
          <button class="tour-btn" onclick="tourPrev()" title="Anterior">&#8249;</button>
          <span class="tour-pos" id="tour-pos">Inicia el tour &#9654;</span>
          <button class="tour-btn" onclick="tourNext()" title="Siguiente">&#8250;</button>
          <button class="tour-btn" onclick="tourStop()" title="Detener" style="font-size:10px">&#10005;</button>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Leyenda — nodos</div>
        <div id="legend-nodes"></div>
      </div>

      <div class="section">
        <div class="section-title">Leyenda — edges</div>
        <div id="legend-edges"></div>
      </div>

      <div class="section">
        <div class="section-title">Filtros</div>
        <div class="filter-row">
          <button class="btn active" id="btn-pack-only" onclick="togglePackOnly()">Solo pack</button>
          <button class="btn" id="btn-symbols" onclick="toggleSymbols()">+ Simbolos</button>
          <button class="btn" id="btn-folders" onclick="toggleFolders()">+ Carpetas</button>
          <button class="btn" id="btn-groups" onclick="toggleGroups()">Agrupar</button>
        </div>
        <div class="filter-row">
          <button class="btn" onclick="fitGraph()">&#8982; Centrar</button>
          <button class="btn" onclick="resetLayout()">&#8635; Layout</button>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Buscar</div>
        <div class="search-wrap">
          <span class="icon">&#128269;</span>
          <input type="text" id="search" placeholder="Filtrar por nombre o ruta..." oninput="doSearch(this.value)">
        </div>
      </div>

      <div class="section">
        <div class="section-title">Nodo seleccionado</div>
        <div class="node-info empty" id="node-info">Haz click en un nodo para explorar</div>
      </div>
    </div>

    <!-- DOMAIN SIDEBAR -->
    <div id="domain-sidebar" style="display:none">
      <div class="section">
        <div class="section-title">Dominios del proyecto</div>
        <div id="domain-list"></div>
      </div>
      <div class="section">
        <div class="section-title">Dominio seleccionado</div>
        <div class="node-info empty" id="domain-node-info">Haz click en un dominio para ver sus archivos</div>
      </div>
    </div>

  </div>
</aside>

<main>
  <div id="cy"></div>
  <div class="graph-controls">
    <button class="ctrl-btn" title="Zoom +" onclick="cy&&cy.zoom(cy.zoom()*1.3)">+</button>
    <button class="ctrl-btn" title="Zoom -" onclick="cy&&cy.zoom(cy.zoom()*0.77)">&#8722;</button>
    <button class="ctrl-btn" title="Centrar" onclick="fitGraph()">&#9679;</button>
  </div>
  <div class="toast" id="toast"></div>
</main>
</div>

<script>
const RAW_GRAPH = ${graphJson};
const PACK_FILES = ${packJson};
const META = ${meta};

// ─── constants ───────────────────────────────────────────────────────────────

const KINDS = {
  code:    { color: '#1f6feb', border: '#58a6ff', label: 'Codigo' },
  test:    { color: '#196c2e', border: '#3fb950', label: 'Test' },
  config:  { color: '#21262d', border: '#8b949e', label: 'Config' },
  doc:     { color: '#6e4800', border: '#e3b341', label: 'Doc' },
  schema:  { color: '#3d1f8c', border: '#bc8cff', label: 'Schema' },
  unknown: { color: '#161b22', border: '#484f58', label: 'Otro' },
};

const EDGE_COLORS = {
  imports:    '#58a6ff',
  defines:    '#484f58',
  tests:      '#3fb950',
  calls:      '#f0883e',
  references: '#a5d6ff',
  contains:   '#30363d',
  extends:    '#bc8cff',
  implements: '#d2a8ff',
};

// Deterministic domain colors from name hash
function domainColor(name) {
  const PALETTE = [
    { bg: '#0c2d6b', border: '#1f6feb' },
    { bg: '#0a3622', border: '#238636' },
    { bg: '#3d1f8c', border: '#6e40c9' },
    { bg: '#3d2e00', border: '#9e6a03' },
    { bg: '#2d1500', border: '#b94900' },
    { bg: '#1a2d1a', border: '#2ea043' },
    { bg: '#1c1c3d', border: '#6b7de0' },
    { bg: '#2d1a2d', border: '#a371f7' },
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

const packSet = new Set(PACK_FILES.map(f => 'file:' + f.path));
const packMap = new Map(PACK_FILES.map(f => ['file:' + f.path, f]));

// ─── state ───────────────────────────────────────────────────────────────────

let showSymbols = false;
let showFolders = false;
let showPackOnly = true;
let currentView = 'graph';
let cy = null;
let tourIndex = -1;
let tourNodes = [];
let showGroups = false;
const collapsedGroupIds = new Set();

// ─── domain helpers ──────────────────────────────────────────────────────────

function getDomain(nodePath) {
  if (!nodePath) return 'root';
  const parts = nodePath.split('/');
  if (parts[0] === 'packages' && parts.length > 1) return 'packages/' + parts[1];
  return parts[0] || 'root';
}

function getSubFolder(filePath, domain) {
  if (!filePath || !domain) return null;
  const rest = filePath.slice(domain.length + 1);
  const parts = rest.split('/');
  if (parts.length <= 1) return null;
  return parts.slice(0, -1).join('/');
}

function buildDomainData() {
  // Group file nodes by domain
  const domainFiles = new Map();
  for (const n of RAW_GRAPH.nodes) {
    if (n.type !== 'file') continue;
    const d = getDomain(n.path);
    if (!domainFiles.has(d)) domainFiles.set(d, []);
    domainFiles.get(d).push(n);
  }

  // Build node id → domain map for quick lookup
  const nodeToFile = new Map();
  for (const n of RAW_GRAPH.nodes) nodeToFile.set(n.id, n);

  // Aggregate inter-domain edges (imports + tests only)
  const domainEdges = new Map(); // "from|||to" → {count, types}
  for (const e of RAW_GRAPH.edges) {
    if (e.type === 'defines' || e.type === 'contains') continue;
    const fn = nodeToFile.get(e.from);
    const tn = nodeToFile.get(e.to);
    if (!fn || !tn) continue;
    const fd = getDomain(fn.path);
    const td = getDomain(tn.path);
    if (fd === td) continue;
    const key = fd + '|||' + td;
    const prev = domainEdges.get(key) || { count: 0 };
    domainEdges.set(key, { count: prev.count + 1 });
  }

  return { domainFiles, domainEdges };
}

function topoSort(domains, domainEdges) {
  const inDeg = new Map(domains.map(d => [d, 0]));
  const out = new Map(domains.map(d => [d, []]));
  for (const [key] of domainEdges) {
    const [f, t] = key.split('|||');
    if (inDeg.has(t)) inDeg.set(t, inDeg.get(t) + 1);
    if (out.has(f)) out.get(f).push(t);
  }
  const queue = domains.filter(d => inDeg.get(d) === 0);
  const ranks = [];
  const seen = new Set();
  while (queue.length) {
    const tier = [...queue];
    queue.length = 0;
    ranks.push(tier);
    for (const d of tier) {
      seen.add(d);
      for (const nb of out.get(d) || []) {
        if (!seen.has(nb)) {
          inDeg.set(nb, inDeg.get(nb) - 1);
          if (inDeg.get(nb) === 0) queue.push(nb);
        }
      }
    }
  }
  // Append any cycle nodes not yet placed
  const remaining = domains.filter(d => !seen.has(d));
  if (remaining.length) ranks.push(remaining);
  return ranks;
}

function buildDomainElements() {
  const { domainFiles, domainEdges } = buildDomainData();
  const domains = [...domainFiles.keys()];
  const ranks = topoSort(domains, domainEdges);

  const DW = 220, DH = 100;
  const positions = new Map();
  for (let r = 0; r < ranks.length; r++) {
    const tier = ranks[r];
    for (let i = 0; i < tier.length; i++) {
      positions.set(tier[i], {
        x: r * DW,
        y: (i - (tier.length - 1) / 2) * DH
      });
    }
  }

  const els = [];
  for (const [domain, files] of domainFiles) {
    const pos = positions.get(domain) || { x: 0, y: 0 };
    const packCount = files.filter(n => packSet.has(n.id)).length;
    const col = domainColor(domain);
    const shortName = domain.includes('/') ? domain.split('/').pop() : domain;
    els.push({
      data: {
        id: 'domain:' + domain,
        label: shortName + '\\n' + files.length + ' archivos',
        fullPath: domain,
        fileCount: files.length,
        packCount,
        bg: col.bg,
        border: col.border,
      },
      position: pos,
      classes: ['domain-node'],
    });
  }

  for (const [key, info] of domainEdges) {
    const [f, t] = key.split('|||');
    els.push({
      data: {
        id: 'de:' + key,
        source: 'domain:' + f,
        target: 'domain:' + t,
        label: info.count + ' import' + (info.count > 1 ? 's' : ''),
        count: info.count,
      },
      classes: ['domain-edge'],
    });
  }
  return els;
}

// ─── graph view ──────────────────────────────────────────────────────────────

function buildElements() {
  const els = [];
  const visibleIds = new Set();
  const addedGroups = new Set();

  for (const n of RAW_GRAPH.nodes) {
    const inPack = packSet.has(n.id);
    if (showPackOnly && n.type === 'file' && !inPack) continue;
    if (!showSymbols && n.type === 'symbol') continue;
    if (!showFolders && n.type === 'folder') continue;

    if (showGroups && n.type === 'file' && n.path) {
      const domain = getDomain(n.path);
      const domainGrpId = 'grp:' + domain;
      if (!addedGroups.has(domainGrpId)) {
        const shortName = domain.split('/').pop() || domain;
        els.push({ data: { id: domainGrpId, label: shortName, fullLabel: shortName, domain, ntype: 'domain-group' }, classes: 'domain-group' });
        addedGroups.add(domainGrpId);
      }
      const sub = getSubFolder(n.path, domain);
      if (sub) {
        const subGrpId = 'grp:' + domain + '/' + sub;
        if (!addedGroups.has(subGrpId)) {
          const shortSub = sub.split('/').pop() || sub;
          els.push({ data: { id: subGrpId, label: shortSub, fullLabel: shortSub, ntype: 'domain-group', parent: domainGrpId }, classes: 'domain-sub-group' });
          addedGroups.add(subGrpId);
        }
      }
    }

    const pf = packMap.get(n.id);
    const nodeData = {
      id: n.id,
      label: n.label || (n.id.split('/').pop() || n.id),
      path: n.path || '',
      kind: n.kind || 'unknown',
      lang: n.lang || '',
      ntype: n.type,
      exported: n.exported,
      inPack,
      packReason: pf ? pf.reason : '',
      packMode:   pf ? pf.mode : '',
    };

    if (showGroups && n.type === 'file' && n.path) {
      const domain = getDomain(n.path);
      const sub = getSubFolder(n.path, domain);
      nodeData.parent = sub ? 'grp:' + domain + '/' + sub : 'grp:' + domain;
    }

    const classNames = [n.type, n.kind || 'unknown', inPack ? 'in-pack' : ''];
    if (n.type === 'symbol' && n.exported === false) classNames.push('unexported');
    els.push({
      data: nodeData,
      classes: classNames.filter(Boolean).join(' ').trim(),
    });
    visibleIds.add(n.id);
  }

  for (const e of RAW_GRAPH.edges) {
    if (!visibleIds.has(e.from) || !visibleIds.has(e.to)) continue;
    els.push({
      data: {
        id: e.from + '->' + e.to + ':' + e.type,
        source: e.from,
        target: e.to,
        etype: e.type,
        weight: e.weight || 1,
      },
      classes: ['edge', e.type],
    });
  }
  return els;
}

function makeGraphStyle() {
  const kindStyles = Object.entries(KINDS).map(([k, v]) => ({
    selector: 'node.' + k,
    style: { 'background-color': v.color, 'border-color': v.border }
  }));
  const edgeStyles = Object.entries(EDGE_COLORS).map(([t, c]) => ({
    selector: 'edge.' + t,
    style: { 'line-color': c, 'target-arrow-color': c }
  }));

  return [
    { selector: 'node.domain-group', style: {
      'background-color': 'rgba(22,27,34,0.85)', 'border-color': '#30363d', 'border-width': 1,
      'label': 'data(label)', 'text-valign': 'top', 'text-halign': 'center',
      'font-size': '10px', 'color': '#8b949e', 'padding': '14px',
      'text-background-color': '#161b22', 'text-background-opacity': 1, 'text-background-padding': '3px',
    }},
    { selector: 'node.domain-sub-group', style: {
      'background-color': 'rgba(13,17,23,0.6)', 'border-color': '#21262d', 'border-width': 1, 'border-style': 'dashed',
      'label': 'data(label)', 'text-valign': 'top', 'text-halign': 'center',
      'font-size': '9px', 'color': '#484f58', 'padding': '10px',
      'text-background-color': '#0d1117', 'text-background-opacity': 1, 'text-background-padding': '2px',
    }},
    { selector: 'node.domain-group.collapsed-group', style: {
      'background-color': '#21262d', 'border-color': '#388bfd', 'border-width': 2,
      'color': '#79c0ff', 'font-size': '10px', 'font-weight': 700,
    }},
    {
      selector: 'node',
      style: {
        'label': 'data(label)',
        'text-valign': 'bottom', 'text-halign': 'center',
        'font-size': '9px', 'color': '#8b949e',
        'text-margin-y': '4px', 'border-width': '2px',
        'width': '22px', 'height': '22px',
        'text-max-width': '80px', 'text-overflow-wrap': 'ellipsis',
        'transition-property': 'opacity,border-width', 'transition-duration': '0.15s',
      }
    },
    { selector: 'node.file', style: { 'shape': 'ellipse', 'width': '26px', 'height': '26px' } },
    { selector: 'node.symbol', style: {
      'shape': 'round-rectangle', 'width': '14px', 'height': '14px',
      'font-size': '8px', 'background-color': '#21262d', 'border-color': '#30363d', 'border-width': '1px',
    }},
    { selector: 'node.folder', style: {
      'shape': 'round-rectangle', 'width': '34px', 'height': '20px',
      'background-color': '#161b22', 'border-color': '#484f58', 'border-width': '1px',
      'font-size': '9px', 'font-weight': 'bold', 'color': '#c9d1d9',
    }},
    { selector: 'node.symbol.unexported', style: {
      'opacity': 0.55, 'border-style': 'dashed',
    }},
    { selector: 'node.in-pack', style: {
      'border-width': '3px', 'border-color': '#f0883e',
      'width': '30px', 'height': '30px',
      'color': '#f0f6fc', 'font-weight': 'bold', 'font-size': '10px',
    }},
    ...kindStyles,
    { selector: 'edge', style: {
      'width': 1.2, 'curve-style': 'bezier',
      'target-arrow-shape': 'triangle', 'arrow-scale': 0.7,
      'line-color': '#30363d', 'target-arrow-color': '#30363d',
      'opacity': 0.6, 'transition-property': 'opacity', 'transition-duration': '0.15s',
    }},
    ...edgeStyles,
    { selector: 'node:selected', style: {
      'border-color': '#f78166', 'border-width': '3px',
      'overlay-color': '#f78166', 'overlay-opacity': 0.08,
    }},
    { selector: '.dimmed', style: { 'opacity': 0.1 } },
    { selector: '.highlighted', style: { 'opacity': 1 } },
    { selector: '.search-match', style: {
      'border-color': '#ffe57f', 'border-width': '3px',
      'overlay-color': '#ffe57f', 'overlay-opacity': 0.15,
    }},
    { selector: '.tour-focus', style: {
      'border-color': '#ff7b72', 'border-width': '4px',
      'overlay-color': '#ff7b72', 'overlay-opacity': 0.15,
    }},
  ];
}

function makeDomainStyle() {
  return [
    {
      selector: 'node.domain-node',
      style: {
        'shape': 'round-rectangle',
        'width': '160px', 'height': '70px',
        'background-color': 'data(bg)',
        'border-color': 'data(border)',
        'border-width': '2px',
        'label': 'data(label)',
        'text-valign': 'center', 'text-halign': 'center',
        'font-size': '12px', 'font-weight': 'bold', 'color': '#f0f6fc',
        'text-wrap': 'wrap', 'text-max-width': '150px',
        'transition-property': 'border-width', 'transition-duration': '0.15s',
      }
    },
    {
      selector: 'node.domain-node:selected',
      style: { 'border-width': '3px', 'border-color': '#f0883e', 'overlay-color': '#f0883e', 'overlay-opacity': 0.1 }
    },
    {
      selector: 'edge.domain-edge',
      style: {
        'curve-style': 'bezier',
        'target-arrow-shape': 'triangle', 'arrow-scale': 0.8,
        'line-color': '#58a6ff', 'target-arrow-color': '#58a6ff',
        'width': 'mapData(count, 1, 10, 1.5, 5)',
        'label': 'data(label)',
        'font-size': '10px', 'color': '#8b949e',
        'text-rotation': 'autorotate', 'text-margin-y': '-8px',
        'opacity': 0.8,
      }
    },
  ];
}

function initCy(elements, domainView) {
  if (cy) cy.destroy();
  cy = cytoscape({
    container: document.getElementById('cy'),
    elements,
    style: domainView ? makeDomainStyle() : makeGraphStyle(),
    layout: domainView
      ? { name: 'preset' }
      : {
          name: 'cose', animate: true, animationDuration: 700, fit: true, padding: 40,
          nodeRepulsion: function() { return 14000; },
          idealEdgeLength: function() { return 90; },
          edgeElasticity: function() { return 100; },
          gravity: 80, numIter: 1200, initialTemp: 200, coolingFactor: 0.95, minTemp: 1,
        },
    wheelSensitivity: 0.3, minZoom: 0.05, maxZoom: 5,
  });

  if (domainView) {
    cy.fit(60);
    cy.on('tap', 'node', evt => showDomainNodeInfo(evt.target));
    cy.on('tap', evt => { if (evt.target === cy) clearNodeInfo('domain-node-info'); });
  } else {
    cy.on('tap', 'node', evt => {
      const node = evt.target;
      if (node.data('ntype') === 'domain-group') { toggleGroupNode(node.id()); }
      else { showNodeInfo(node); highlightNeighbors(node); }
    });
    cy.on('tap', evt => { if (evt.target === cy) { clearHighlight(); clearNodeInfo('node-info'); } });
  }
}

// ─── node summary generator ──────────────────────────────────────────────────

function generateSummary(node) {
  const d = node.data();
  if (d.ntype !== 'file') {
    const kind = d.kind || 'Simbolo';
    const file = (d.path || '').split('/').pop() || '';
    return (kind.charAt(0).toUpperCase() + kind.slice(1)) + (file ? ' definido en ' + file : '') + '.';
  }
  const allE = node.connectedEdges();
  const cnt = (etype, dir) => allE.filter(e =>
    e.data('etype') === etype && (dir === 'out' ? e.data('source') === d.id : e.data('target') === d.id)
  ).length;

  const defs = cnt('defines', 'out');
  const impsOut = cnt('imports', 'out');
  const impsIn = cnt('imports', 'in');
  const testedBy = cnt('tests', 'in');

  const parts = [];
  if (defs)     parts.push('Define ' + defs + ' símbolo' + (defs !== 1 ? 's' : ''));
  if (impsOut)  parts.push('importa ' + impsOut + ' archivo' + (impsOut !== 1 ? 's' : ''));
  if (impsIn)   parts.push('usado por ' + impsIn + ' archivo' + (impsIn !== 1 ? 's' : ''));
  if (testedBy) parts.push('cubierto por ' + testedBy + ' test' + (testedBy !== 1 ? 's' : ''));
  return parts.length
    ? parts.join('. ') + '.'
    : 'Archivo sin conexiones en la vista actual.';
}

// ─── node info panel ─────────────────────────────────────────────────────────

function showNodeInfo(node) {
  const d = node.data();
  const pf = packMap.get(d.id);
  const panel = document.getElementById('node-info');

  const kindTag  = '<span class="tag tag-' + d.kind + '">' + (d.kind || 'unknown') + '</span>';
  const langTag  = d.lang ? '<span class="tag tag-config">' + escHtml(d.lang) + '</span>' : '';
  const packTag  = pf ? '<span class="tag tag-pack">' + pf.mode + ' · ' + pf.reason + '</span>' : '';
  const summary  = generateSummary(node);

  const neighbors = node.connectedEdges();
  const incoming  = neighbors.filter(e => e.data('target') === d.id);
  const outgoing  = neighbors.filter(e => e.data('source') === d.id);

  function edgeList(edges, dirLabel) {
    if (!edges.length) return '';
    const MAX = 6;
    const items = edges.slice(0, MAX).map(e => {
      const oid = e.data('source') === d.id ? e.data('target') : e.data('source');
      const ol = (cy.getElementById(oid).data('label') || oid).split('/').pop();
      return '<a class="edge-link" data-oid="' + oid.replace(/"/g,'&quot;') + '">[' + (e.data('etype')||'') + '] ' + escHtml(ol) + '</a>';
    }).join('');
    const more = edges.length > MAX ? '<span style="color:#484f58"> +' + (edges.length - MAX) + ' más</span>' : '';
    return '<strong>' + dirLabel + ' (' + edges.length + ')</strong>' + items + more;
  }

  panel.className = 'node-info';
  panel.innerHTML =
    '<div class="node-path">' + escHtml(d.path || d.id) + '</div>' +
    '<div class="node-meta">' + kindTag + langTag + packTag + '</div>' +
    '<div class="node-summary">' + escHtml(summary) + '</div>' +
    '<div class="connections">' +
      edgeList(outgoing, '→ importa / define') +
      edgeList(incoming, '← importado por / usado en') +
    '</div>';
}

function showDomainNodeInfo(node) {
  const d = node.data();
  const { domainFiles } = buildDomainData();
  const files = domainFiles.get(d.fullPath) || [];
  const panel = document.getElementById('domain-node-info');

  // Mark selected domain item in sidebar
  document.querySelectorAll('.domain-item').forEach(el => el.classList.remove('selected'));
  const sideItem = document.querySelector('[data-domain="' + CSS.escape(d.fullPath) + '"]');
  if (sideItem) sideItem.classList.add('selected');

  const col = domainColor(d.fullPath);
  const fileRows = files.map(f => {
    const inPack = packSet.has(f.id);
    return '<div class="domain-file-item ' + (inPack ? 'in-pack' : '') + '">' +
      (inPack ? '★ ' : '▦ ') + escHtml(f.label) +
    '</div>';
  }).join('');

  panel.className = 'node-info';
  panel.innerHTML =
    '<div style="font-weight:700;font-size:12px;color:#f0f6fc;margin-bottom:4px">' + escHtml(d.fullPath) + '</div>' +
    '<div class="node-meta">' +
      '<span class="tag tag-domain">' + d.fileCount + ' archivos</span>' +
      (d.packCount ? '<span class="tag tag-pack">' + d.packCount + ' en pack</span>' : '') +
    '</div>' +
    '<div class="domain-files-list">' + fileRows + '</div>';
}

function clearNodeInfo(id) {
  const panel = document.getElementById(id);
  panel.className = 'node-info empty';
  panel.innerHTML = 'Haz click en un nodo para explorar';
}

// ─── highlight ───────────────────────────────────────────────────────────────

function highlightNeighbors(node) {
  cy.elements().addClass('dimmed').removeClass('highlighted');
  node.closedNeighborhood().removeClass('dimmed').addClass('highlighted');
}

function clearHighlight() {
  cy.elements().removeClass('dimmed highlighted');
}

// ─── filters ─────────────────────────────────────────────────────────────────

function togglePackOnly() {
  showPackOnly = !showPackOnly;
  document.getElementById('btn-pack-only').classList.toggle('active', showPackOnly);
  refresh();
}

function toggleSymbols() {
  showSymbols = !showSymbols;
  document.getElementById('btn-symbols').classList.toggle('active', showSymbols);
  refresh();
}

function toggleFolders() {
  showFolders = !showFolders;
  document.getElementById('btn-folders').classList.toggle('active', showFolders);
  refresh();
}

function toggleGroups() {
  showGroups = !showGroups;
  document.getElementById('btn-groups').classList.toggle('active', showGroups);
  collapsedGroupIds.clear();
  refresh();
}

function toggleGroupNode(nodeId) {
  if (!cy) return;
  const node = cy.getElementById(nodeId);
  if (!node.length) return;
  const children = node.children();
  if (collapsedGroupIds.has(nodeId)) {
    collapsedGroupIds.delete(nodeId);
    children.style('display', 'element');
    node.data('label', node.data('fullLabel') || node.data('label'));
    node.removeClass('collapsed-group');
  } else {
    collapsedGroupIds.add(nodeId);
    node.data('fullLabel', node.data('label'));
    const leafCount = children.reduce((s, c) =>
      c.data('ntype') === 'domain-group' ? s + c.children().length : s + 1, 0);
    children.style('display', 'none');
    node.data('label', (node.data('fullLabel') || '') + ' (' + leafCount + ')');
    node.addClass('collapsed-group');
  }
}

function refresh() {
  const els = buildElements();
  initCy(els, false);
  updateStats();
  tourNodes = PACK_FILES.map(f => 'file:' + f.path).filter(id => cy.getElementById(id).length);
}

function fitGraph() { if (cy) cy.fit(40); }

function resetLayout() {
  if (!cy || currentView === 'domain') return;
  cy.layout({
    name: 'cose', animate: true, animationDuration: 600, fit: true, padding: 40,
    nodeRepulsion: function() { return 14000; },
    idealEdgeLength: function() { return 90; },
    edgeElasticity: function() { return 100; },
    gravity: 80, numIter: 1200, initialTemp: 200, coolingFactor: 0.95, minTemp: 1,
  }).run();
}

function doSearch(q) {
  if (!cy) return;
  cy.nodes().removeClass('search-match');
  if (!q) return;
  const term = q.toLowerCase();
  cy.nodes().filter(n =>
    (n.data('label') || '').toLowerCase().includes(term) ||
    (n.data('path') || '').toLowerCase().includes(term)
  ).addClass('search-match');
}

// ─── view switching ──────────────────────────────────────────────────────────

function switchView(view) {
  currentView = view;
  document.getElementById('btn-view-graph').classList.toggle('active', view === 'graph');
  document.getElementById('btn-view-domain').classList.toggle('active', view === 'domain');
  document.getElementById('graph-sidebar').style.display = view === 'graph' ? '' : 'none';
  document.getElementById('domain-sidebar').style.display = view === 'domain' ? '' : 'none';

  if (view === 'domain') {
    const els = buildDomainElements();
    initCy(els, true);
    buildDomainSidebar();
    document.getElementById('hdr-nodes').textContent = els.filter(e => !e.data.source).length + ' dominios';
    document.getElementById('hdr-edges').textContent = els.filter(e => e.data.source).length + ' deps';
  } else {
    refresh();
  }
}

function buildDomainSidebar() {
  const { domainFiles } = buildDomainData();
  const listEl = document.getElementById('domain-list');
  listEl.innerHTML = [...domainFiles.entries()].map(([domain, files]) => {
    const col = domainColor(domain);
    const packCount = files.filter(n => packSet.has(n.id)).length;

    const subFolders = new Map();
    for (const f of files) {
      const sub = getSubFolder(f.path, domain) || '';
      if (!subFolders.has(sub)) subFolders.set(sub, []);
      subFolders.get(sub).push(f);
    }

    const treeHtml = [...subFolders.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([sub, subFiles]) => {
      const subPack = subFiles.filter(f => packSet.has(f.id)).length;
      const fileItems = subFiles.map(f => {
        const inPack = packSet.has(f.id);
        return '<span class="domain-tree-file' + (inPack ? ' in-pack' : '') + '">' +
          (inPack ? '★ ' : '· ') + escHtml(f.label) + '</span>';
      }).join('');
      if (!sub) return '<div class="domain-sub-files" style="display:block">' + fileItems + '</div>';
      return '<div class="domain-sub-folder">' +
        '<div class="domain-sub-header">' +
          '<span class="domain-tree-toggle">&#9658;</span>' +
          '<span class="domain-sub-name">' + escHtml(sub) + '</span>' +
          '<span class="domain-count">' + subFiles.length + (subPack ? ' &middot; <span style="color:#f0883e">' + subPack + '</span>' : '') + '</span>' +
        '</div>' +
        '<div class="domain-sub-files">' + fileItems + '</div>' +
      '</div>';
    }).join('');

    return '<div class="domain-item" data-domain="' + escHtml(domain) + '">' +
        '<span class="domain-tree-toggle">&#9658;</span>' +
        '<span class="domain-dot" style="background:' + col.border + '"></span>' +
        '<span class="domain-name" title="' + escHtml(domain) + '">' + escHtml(domain) + '</span>' +
        '<span class="domain-count">' + files.length + (packCount ? ' &middot; <span style="color:#f0883e">' + packCount + '</span>' : '') + '</span>' +
      '</div>' +
      '<div class="domain-files-tree">' + treeHtml + '</div>';
  }).join('');

  listEl.querySelectorAll('.domain-sub-folder').forEach(el => {
    el.querySelector('.domain-sub-header').addEventListener('click', () => el.classList.toggle('open'));
  });
}

function onDomainItemClick(domain) {
  const node = cy && cy.getElementById('domain:' + domain);
  if (node && node.length) {
    cy.animate({ center: { eles: node }, zoom: Math.max(cy.zoom(), 1.2) }, { duration: 300 });
    node.trigger('tap');
  }
}

// ─── tour ────────────────────────────────────────────────────────────────────

function tourNext() {
  if (!tourNodes.length) { showToast('No hay archivos de pack visibles'); return; }
  tourIndex = (tourIndex + 1) % tourNodes.length;
  tourStep();
}

function tourPrev() {
  if (!tourNodes.length) return;
  tourIndex = (tourIndex - 1 + tourNodes.length) % tourNodes.length;
  tourStep();
}

function tourStep() {
  cy.nodes().removeClass('tour-focus dimmed highlighted');
  const id = tourNodes[tourIndex];
  const node = cy.getElementById(id);
  if (!node.length) { tourNext(); return; }
  node.addClass('tour-focus');
  highlightNeighbors(node);
  cy.animate({ center: { eles: node }, zoom: 2.2 }, { duration: 350, complete: () => showNodeInfo(node) });
  document.getElementById('tour-pos').textContent = (tourIndex + 1) + ' / ' + tourNodes.length;
}

function tourStop() {
  tourIndex = -1;
  document.getElementById('tour-pos').textContent = 'Inicia el tour ▶';
  cy && cy.nodes().removeClass('tour-focus dimmed highlighted');
  clearNodeInfo('node-info');
  fitGraph();
}

// ─── stats & legends ─────────────────────────────────────────────────────────

function updateStats() {
  if (!cy) return;
  const files   = cy.nodes('.file').length;
  const symbols = cy.nodes('.symbol').length;
  const edges   = cy.edges().length;
  const inPack  = cy.nodes('.in-pack').length;
  document.getElementById('s-files').textContent   = files;
  document.getElementById('s-symbols').textContent = symbols;
  document.getElementById('s-edges').textContent   = edges;
  document.getElementById('s-pack').textContent    = inPack;
  document.getElementById('hdr-nodes').textContent = (files + symbols) + ' nodos';
  document.getElementById('hdr-edges').textContent = edges + ' edges';
  document.getElementById('hdr-pack').textContent  = PACK_FILES.length + ' pack';
}

function buildLegends() {
  const nodeEl = document.getElementById('legend-nodes');
  const kindHtml = Object.entries(KINDS).map(([k, v]) => {
    const count = RAW_GRAPH.nodes.filter(n => n.kind === k).length;
    if (!count) return '';
    return '<div class="legend-item"><span class="dot" style="background:' + v.color + ';border:2px solid ' + v.border + '"></span><span>' + v.label + '</span><span class="legend-count">' + count + '</span></div>';
  }).join('');

  const folderCount = RAW_GRAPH.nodes.filter(n => n.type === 'folder').length;
  const folderHtml = folderCount
    ? '<div class="legend-item"><span class="dot" style="background:#161b22;border:2px solid #484f58;border-radius:3px"></span><span>Carpeta</span><span class="legend-count">' + folderCount + '</span></div>'
    : '';

  const unexportedCount = RAW_GRAPH.nodes.filter(n => n.type === 'symbol' && n.exported === false).length;
  const unexportedHtml = unexportedCount
    ? '<div class="legend-item"><span class="dot" style="background:#21262d;border:2px dashed #30363d"></span><span>Símbolo interno</span><span class="legend-count">' + unexportedCount + '</span></div>'
    : '';

  const packHtml = PACK_FILES.length
    ? '<div class="legend-item"><span class="dot" style="background:#161b22;border:3px solid #f0883e"></span><span>En context-pack</span><span class="legend-count">' + PACK_FILES.length + '</span></div>'
    : '';

  nodeEl.innerHTML = kindHtml + folderHtml + unexportedHtml + packHtml;

  document.getElementById('legend-edges').innerHTML = Object.entries(EDGE_COLORS).map(([t, c]) => {
    const count = RAW_GRAPH.edges.filter(e => e.type === t).length;
    if (!count) return '';
    return '<div class="legend-item"><span class="edge-line" style="background:' + c + '"></span><span>' + t + '</span><span class="legend-count">' + count + '</span></div>';
  }).join('');
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── init ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function() {
  if (META.task) document.getElementById('hdr-task').textContent = META.task;
  buildLegends();
  const els = buildElements();
  initCy(els, false);
  updateStats();
  tourNodes = PACK_FILES.map(f => 'file:' + f.path).filter(id => cy.getElementById(id).length);
  document.addEventListener('click', function(ev) {
    const a = ev.target.closest('.edge-link');
    if (a && a.dataset.oid && cy) {
      const target = cy.getElementById(a.dataset.oid);
      if (target && target.length) target.trigger('tap');
      return;
    }
    const di = ev.target.closest('.domain-item');
    if (di && di.dataset.domain) {
      di.classList.toggle('open');
      onDomainItemClick(di.dataset.domain);
    }
  });
});
</script>
</body>
</html>`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface SubsetHtmlParams {
  changeId: string;
  generatedAt: string;
  task?: string;
  nodes: VizNode[];
  edges: VizEdge[];
  stats: Record<string, unknown>;
  focus: string[];
}

/**
 * Standalone HTML viewer for an OpenSpec change subgraph. Reuses the project
 * viewer (`generateVizHtml`) but seeds it with subset data and labels the
 * header so reviewers see "Change: <id>" instead of the global project name.
 *
 * Persisted alongside `graph.subset.json` inside `openspec/changes/<id>/` so
 * the change directory is fully self-describing.
 */
export function generateSubsetHtml(p: SubsetHtmlParams): string {
  // Mark focus files as "in pack" so the viewer highlights them in orange —
  // it's a natural fit for "files this change actually touches".
  const packFiles: VizPackFile[] = p.focus.map((f) => ({
    path: f,
    reason: "change focus",
    mode: "full"
  }));

  const taskLine = p.task
    ? `Change "${p.changeId}" · ${p.task}`
    : `Change "${p.changeId}" — subgrafo congelado`;

  return generateVizHtml({
    projectName: `Change: ${p.changeId}`,
    generatedAt: p.generatedAt,
    nodes: p.nodes,
    edges: p.edges,
    stats: p.stats,
    packFiles,
    task: taskLine
  });
}

import type { GraphEdge, GraphNode } from "./builder.js";

export interface ExportableGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const NODE_COLORS: Record<string, string> = {
  file: "#1f6feb",
  symbol: "#21262d",
  folder: "#484f58",
  package: "#9e6a03"
};

const EDGE_STYLES: Record<
  string,
  { color: string; style: "solid" | "dashed" | "dotted" | "bold" }
> = {
  defines: { color: "#6e7681", style: "solid" },
  imports: { color: "#58a6ff", style: "solid" },
  tests: { color: "#3fb950", style: "bold" },
  extends: { color: "#bc8cff", style: "solid" },
  implements: { color: "#d2a8ff", style: "dashed" },
  contains: { color: "#30363d", style: "dotted" },
  calls: { color: "#f0883e", style: "solid" },
  references: { color: "#a5d6ff", style: "dashed" }
};

function escapeDotString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function quote(value: string): string {
  return `"${escapeDotString(value)}"`;
}

export function exportToDot(graph: ExportableGraph): string {
  const lines: string[] = [];
  lines.push("digraph ContextForge {");
  lines.push("  rankdir=LR;");
  lines.push('  bgcolor="#0d1117";');
  lines.push('  node [fontname="Helvetica",fontsize=10,fontcolor="#e6edf3"];');
  lines.push('  edge [fontname="Helvetica",fontsize=8,fontcolor="#8b949e"];');
  lines.push("");

  for (const node of graph.nodes) {
    const fill = NODE_COLORS[node.type] ?? "#161b22";
    const shape =
      node.type === "folder"
        ? "box"
        : node.type === "symbol"
          ? "ellipse"
          : node.type === "package"
            ? "octagon"
            : "circle";
    const tooltip = node.path ?? node.label;
    const labelText = node.label;
    const attrs = [
      `label=${quote(labelText)}`,
      `shape=${shape}`,
      `style="filled"`,
      `fillcolor="${fill}"`,
      `color="#30363d"`,
      `tooltip=${quote(tooltip)}`
    ];
    if (node.type === "symbol" && node.exported === false) {
      attrs.push(`style="filled,dashed"`);
    }
    lines.push(`  ${quote(node.id)} [${attrs.join(",")}];`);
  }

  lines.push("");

  for (const edge of graph.edges) {
    const styleEntry = EDGE_STYLES[edge.type] ?? {
      color: "#8b949e",
      style: "solid" as const
    };
    const attrs = [
      `label=${quote(edge.type)}`,
      `color="${styleEntry.color}"`,
      `style="${styleEntry.style}"`,
      `penwidth=${(edge.weight ?? 1).toFixed(1)}`
    ];
    lines.push(
      `  ${quote(edge.from)} -> ${quote(edge.to)} [${attrs.join(",")}];`
    );
  }

  lines.push("}");
  return lines.join("\n") + "\n";
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function exportToGraphML(graph: ExportableGraph): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://graphml.graphdrawing.org/xmlns http://graphml.graphdrawing.org/xmlns/1.1/graphml.xsd">'
  );

  // Node attributes
  lines.push(
    '  <key id="d_label" for="node" attr.name="label" attr.type="string"/>'
  );
  lines.push(
    '  <key id="d_type" for="node" attr.name="type" attr.type="string"/>'
  );
  lines.push(
    '  <key id="d_path" for="node" attr.name="path" attr.type="string"/>'
  );
  lines.push(
    '  <key id="d_kind" for="node" attr.name="kind" attr.type="string"/>'
  );
  lines.push(
    '  <key id="d_lang" for="node" attr.name="lang" attr.type="string"/>'
  );
  lines.push(
    '  <key id="d_exported" for="node" attr.name="exported" attr.type="boolean"/>'
  );

  // Edge attributes
  lines.push(
    '  <key id="d_etype" for="edge" attr.name="type" attr.type="string"/>'
  );
  lines.push(
    '  <key id="d_weight" for="edge" attr.name="weight" attr.type="double"/>'
  );

  lines.push('  <graph id="G" edgedefault="directed">');

  for (const node of graph.nodes) {
    lines.push(`    <node id="${escapeXml(node.id)}">`);
    lines.push(`      <data key="d_label">${escapeXml(node.label)}</data>`);
    lines.push(`      <data key="d_type">${escapeXml(node.type)}</data>`);
    if (node.path) {
      lines.push(`      <data key="d_path">${escapeXml(node.path)}</data>`);
    }
    if (node.kind) {
      lines.push(`      <data key="d_kind">${escapeXml(node.kind)}</data>`);
    }
    if (node.lang) {
      lines.push(`      <data key="d_lang">${escapeXml(node.lang)}</data>`);
    }
    if (node.exported !== undefined) {
      lines.push(
        `      <data key="d_exported">${node.exported ? "true" : "false"}</data>`
      );
    }
    lines.push(`    </node>`);
  }

  let edgeIndex = 0;
  for (const edge of graph.edges) {
    lines.push(
      `    <edge id="e${edgeIndex++}" source="${escapeXml(edge.from)}" target="${escapeXml(edge.to)}">`
    );
    lines.push(`      <data key="d_etype">${escapeXml(edge.type)}</data>`);
    if (edge.weight !== undefined) {
      lines.push(`      <data key="d_weight">${edge.weight}</data>`);
    }
    lines.push(`    </edge>`);
  }

  lines.push("  </graph>");
  lines.push("</graphml>");
  return lines.join("\n") + "\n";
}

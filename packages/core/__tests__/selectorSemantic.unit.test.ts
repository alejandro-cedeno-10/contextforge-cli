import { describe, expect, it } from "vitest";

import type { GraphEdge, GraphNode } from "../src/graph/builder.js";
import type { ScanFile } from "../src/scanner.js";
import { selectContext } from "../src/selector/index.js";

function fileNode(p: string): GraphNode {
  return {
    id: `file:${p}`,
    type: "file",
    label: p.split("/").pop() ?? p,
    path: p,
    kind: "code"
  };
}

function domainNode(slug: string): GraphNode {
  return { id: `domain:${slug}`, type: "domain", label: slug };
}

function importsEdge(from: string, to: string): GraphEdge {
  return { from: `file:${from}`, to: `file:${to}`, type: "imports" };
}

function belongsTo(file: string, domain: string): GraphEdge {
  return {
    from: `file:${file}`,
    to: `domain:${domain}`,
    type: "belongs_to_domain"
  };
}

function scanFile(p: string, size = 400): ScanFile {
  return {
    path: p,
    ext: "." + (p.split(".").pop() ?? "ts"),
    size,
    hash: "0".repeat(64),
    kind: "code"
  };
}

describe("selectContext — semantic boost", () => {
  it("does not boost when task is absent", () => {
    const nodes: GraphNode[] = [
      fileNode("src/auth/login.ts"),
      fileNode("src/billing/invoice.ts"),
      domainNode("auth"),
      domainNode("billing")
    ];
    const edges: GraphEdge[] = [
      belongsTo("src/auth/login.ts", "auth"),
      belongsTo("src/billing/invoice.ts", "billing"),
      importsEdge("src/auth/login.ts", "src/billing/invoice.ts")
    ];
    const result = selectContext({
      nodes,
      edges,
      scanFiles: [
        scanFile("src/auth/login.ts"),
        scanFile("src/billing/invoice.ts")
      ]
    });
    expect(result.semanticBoostedDomains).toEqual([]);
  });

  it("boosts files in domains whose label matches a task keyword", () => {
    const nodes: GraphNode[] = [
      fileNode("src/auth/login.ts"),
      fileNode("src/billing/invoice.ts"),
      fileNode("src/orders/cart.ts"),
      domainNode("auth"),
      domainNode("billing"),
      domainNode("orders")
    ];
    const edges: GraphEdge[] = [
      belongsTo("src/auth/login.ts", "auth"),
      belongsTo("src/billing/invoice.ts", "billing"),
      belongsTo("src/orders/cart.ts", "orders"),
      // Connect them so PageRank gives them comparable base scores.
      importsEdge("src/auth/login.ts", "src/billing/invoice.ts"),
      importsEdge("src/billing/invoice.ts", "src/orders/cart.ts")
    ];
    const result = selectContext({
      nodes,
      edges,
      scanFiles: [
        scanFile("src/auth/login.ts"),
        scanFile("src/billing/invoice.ts"),
        scanFile("src/orders/cart.ts")
      ],
      task: "fix billing invoice rounding bug"
    });
    expect(result.semanticBoostedDomains).toEqual(["domain:billing"]);
    // billing file should rank first thanks to the boost.
    expect(result.files[0]!.path).toBe("src/billing/invoice.ts");
  });

  it("ignores stopwords when extracting keywords", () => {
    const nodes: GraphNode[] = [
      fileNode("src/auth/login.ts"),
      domainNode("auth"),
      domainNode("the") // would match a stopword if we did naive matching
    ];
    const edges: GraphEdge[] = [belongsTo("src/auth/login.ts", "auth")];
    const result = selectContext({
      nodes,
      edges,
      scanFiles: [scanFile("src/auth/login.ts")],
      task: "fix the bug"
    });
    expect(result.semanticBoostedDomains).toEqual([]);
  });
});

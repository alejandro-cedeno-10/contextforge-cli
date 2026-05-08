import { describe, expect, it } from "vitest";

import { generateSubsetHtml } from "../src/htmlTemplate";

describe("generateSubsetHtml", () => {
  it("produces a self-contained HTML page with the change id in the title", () => {
    const html = generateSubsetHtml({
      changeId: "fix-token-race",
      generatedAt: "2026-05-08T00:00:00Z",
      task: "Bug fix",
      nodes: [
        { id: "file:src/a.ts", type: "file", label: "a.ts", path: "src/a.ts" }
      ],
      edges: [],
      stats: { nodesTotal: 1, edgesTotal: 0 },
      focus: ["src/a.ts"]
    });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Change: fix-token-race");
    expect(html).toContain("cytoscape");
    // The focus file becomes a "pack" entry so the viewer highlights it.
    expect(html).toContain('"src/a.ts"');
    expect(html).toContain("change focus");
  });

  it("falls back to a default task line when none is provided", () => {
    const html = generateSubsetHtml({
      changeId: "x",
      generatedAt: "2026-05-08T00:00:00Z",
      nodes: [],
      edges: [],
      stats: {},
      focus: []
    });
    // The task gets HTML-escaped (quotes → &quot;) inside the META block.
    expect(html).toContain("subgrafo congelado");
    expect(html).toContain("Change: x");
  });

  it("escapes HTML in the change id (defensive)", () => {
    const html = generateSubsetHtml({
      changeId: "<script>",
      generatedAt: "2026-05-08T00:00:00Z",
      nodes: [],
      edges: [],
      stats: {},
      focus: []
    });
    expect(html).toContain("Change: &lt;script&gt;");
    expect(html).not.toContain("<title>ContextForge — <script></title>");
  });
});

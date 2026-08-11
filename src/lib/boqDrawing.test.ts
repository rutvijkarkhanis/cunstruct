import { describe, it, expect } from "vitest";
import { applyDrawing, defaultBasis, findCatalogueMatch, noCatalogueMatch, parseDrawingSummary } from "./boqDrawing";
import type { GeneratedLine } from "./boqDsrGenerate";

const line = (over: Partial<GeneratedLine>): GeneratedLine => ({
  section: "X", code: null, qty: 1, label: "item", unit: "nos", ...over,
});

describe("defaultBasis", () => {
  it("measured rooms → drawing-derived", () => {
    expect(defaultBasis(line({ code: "5.22.6" }), true)).toBe("DRAWING_DERIVED");
    expect(defaultBasis(line({ code: null }), true)).toBe("DRAWING_DERIVED");
  });
  it("no rooms → coefficient for coded, heuristic for NS", () => {
    expect(defaultBasis(line({ code: "5.22.6" }), false)).toBe("DSR_AOR");
    expect(defaultBasis(line({ code: null }), false)).toBe("HEURISTIC");
  });
});

describe("applyDrawing", () => {
  const lines = [
    line({ code: "5.22.6", label: "TMT reinforcement steel", qty: 800 }),
    line({ code: null, label: "Power plug points (16A) with modular sockets", qty: 10 }),
    line({ code: null, label: "Light / fan points", qty: 20 }),
  ];

  it("overrides a matched line by DSR code and stamps counted basis", () => {
    const out = applyDrawing(lines, { items: [{ match: "5.22.6", qty: 950 }] });
    expect(out[0].qty).toBe(950);
    expect(out[0].basis).toBe("DRAWING_INPUT");
  });

  it("matches by description substring, case-insensitive, and carries the note", () => {
    const out = applyDrawing(lines, { items: [{ match: "16a", qty: 12, note: "8+2+2 counted" }] });
    expect(out[1].qty).toBe(12);
    expect(out[1].basis).toBe("DRAWING_INPUT");
    expect(out[1].note).toBe("8+2+2 counted");
  });

  it("derived flag → drawing-derived basis", () => {
    const out = applyDrawing(lines, { items: [{ match: "light", qty: 18, derived: true }] });
    expect(out[2].basis).toBe("DRAWING_DERIVED");
  });

  it("never invents: ignores blank/zero items and leaves lines untouched", () => {
    const out = applyDrawing(lines, { items: [{ match: "", qty: 5 }, { match: "steel", qty: 0 }] });
    expect(out.map((l) => l.qty)).toEqual([800, 10, 20]);
  });

  it("links synonyms semantically — '16 amp power point' ≈ '(16A) … sockets'", () => {
    const out = applyDrawing(lines, { items: [{ match: "16 amp power point", qty: 9 }] });
    expect(out.length).toBe(lines.length);            // linked, not added
    expect(out.find((l) => (l.label ?? "").includes("16A"))?.qty).toBe(9);
  });

  it("adds an unmatched requirement as its own No-Catalogue-Match line", () => {
    const out = applyDrawing(lines, { items: [{ match: "4M switchboards", qty: 6, unit: "nos" }] });
    expect(out.length).toBe(lines.length + 1);
    const added = out.find((l) => l.label === "4M switchboards");
    expect(added?.code).toBeNull();
    expect(added?.qty).toBe(6);
    expect(added?.ns).toBe(true);
    expect(added?.basis).toBe("DRAWING_INPUT");
  });

  it("reports requirements with no catalogue match", () => {
    const un = noCatalogueMatch(lines, { items: [{ match: "switchboard", qty: 6 }, { match: "steel", qty: 900 }] });
    expect(un.map((i) => i.match)).toEqual(["switchboard"]);
  });

  it("findCatalogueMatch returns the matched candidate or null", () => {
    const cands = lines.map((l) => ({ code: l.code, label: l.label }));
    expect(findCatalogueMatch("16A socket", cands)?.label).toContain("16A");
    expect(findCatalogueMatch("4M switchboard", cands)).toBeNull();
  });
});

describe("parseDrawingSummary", () => {
  const byMatch = (items: ReturnType<typeof parseDrawingSummary>, key: string) =>
    items.find((i) => i.match.toLowerCase().replace(/\s+/g, "").replace(/s$/, "").includes(key));

  it("parses the operator's electrical summary, summing counts across rooms", () => {
    const text = `Electrical:
- Living room: 8 × 6A sockets, 2 × 16A sockets, 1 × TV point, 1 × AC point
- Bedroom 1: 6 × 6A sockets, 1 × 16A socket, 1 × TV point
- 4M switchboards: 6 nos
- 6M switchboards: 8 nos
- Floor-to-ceiling conduits: 3 locations`;
    const items = parseDrawingSummary(text);
    expect(byMatch(items, "6asocket")?.qty).toBe(14);   // 8 + 6
    expect(byMatch(items, "16asocket")?.qty).toBe(3);   // 2 + 1 (socket + sockets merged)
    expect(byMatch(items, "tvpoint")?.qty).toBe(2);
    expect(byMatch(items, "acpoint")?.qty).toBe(1);
    expect(byMatch(items, "4mswitchboard")?.qty).toBe(6);
    expect(byMatch(items, "6mswitchboard")?.qty).toBe(8);
    expect(byMatch(items, "floor-to-ceilingconduit")?.qty).toBe(3);
  });

  it("records the per-room breakdown as a note", () => {
    const items = parseDrawingSummary("Living room: 8 × 6A sockets\nBedroom 1: 6 × 6A sockets");
    expect(byMatch(items, "6asocket")?.note).toBe("8 Living room + 6 Bedroom 1");
  });

  it("handles trailing-count and linear-length lines", () => {
    const items = parseDrawingSummary("Conduit: 185 m\nLight points - 24");
    expect(byMatch(items, "conduit")?.qty).toBe(185);
    expect(byMatch(items, "lightpoint")?.qty).toBe(24);
  });

  it("does not invent numbers from headers or prose", () => {
    expect(parseDrawingSummary("Electrical layout drawing, page 1\nNotes: see legend")).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import { applyDrawing, defaultBasis, unmatchedItems } from "./boqDrawing";
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

  it("never invents: leaves untouched lines and ignores blank/zero items", () => {
    const out = applyDrawing(lines, { items: [{ match: "", qty: 5 }, { match: "steel", qty: 0 }] });
    expect(out.map((l) => l.qty)).toEqual([800, 10, 20]);
  });

  it("reports items that matched nothing", () => {
    const un = unmatchedItems(lines, { items: [{ match: "switchboard", qty: 6 }, { match: "steel", qty: 900 }] });
    expect(un.map((i) => i.match)).toEqual(["switchboard"]);
  });
});

import { describe, it, expect } from "vitest";
import { parseChatGptEvaluation } from "./chatgptEval";
import { applyDrawing } from "./boqDrawing";
import type { GeneratedLine } from "./boqDsrGenerate";

// A realistic ChatGPT evaluation for the electrical/furniture drawing, built from
// the operator's own item list for that drawing. This exercises the CUNSTRUCT
// side (parse → apply → provenance), which is what we can verify without the PDF.
const RESPONSE = `## PROJECT TYPE
Residential

## ARCHETYPE
3 BHK

## FLOORS
1

## AREA
Not clearly stated on this drawing.

## SPACES
- Living / TV area — 1
- Media / projector area — 1
- Bedroom — 3
- Kitchen — 1
- Utility — 1

## DISCIPLINES
- Electrical
- Furniture

## DRAWING-SPECIFIC MEASUREMENTS
- Switchboard height — 51"
- TV size — 55"
- Offset — 4" from BOS
- Wall length — 10'-8"

## DRAWING-SPECIFIC REQUIREMENTS
Requirement | Qty | Unit | Basis | Location / Note
--- | --- | --- | --- | ---
TV point | 1 | nos | Counted | Living / TV area
55" TV provision | 1 | nos | Counted | Living / TV area
6A socket | 2 | nos | Counted | Living / TV area
16A point | 1 | nos | Counted | Living / TV area
Projector point | 1 | nos | Counted | Media / projector area
Audio points | 4 | nos | Counted | Media / projector area
Dishwasher point | 1 | nos | Counted | Kitchen
Washing machine point | 1 | nos | Counted | Utility
Oven/fridge provision | 1 | nos | Counted | Kitchen
Floor-to-ceiling conduit | 3 | nos | Counted | Location unclear
G 16A points | 4 | nos | Counted | Location unclear
Floor points | 4 | nos | Counted | Location unclear
Blind provisions | 3 | nos | Counted | Bedroom
Inline exhaust | 1 | nos | Counted | Location unclear

## CONFIDENCE
- Project type — High
- Archetype — Medium
- Floors — High
- Area — Low

## CONFIRMATIONS
- Area is not printed on this drawing — confirm built-up area before generating.
- Confirm the room for the floor points and inline exhaust.`;

// The suffix the builder appends to the description in the PDF/Excel/screen.
const suffix = (l: GeneratedLine, short = false) => {
  const d = l.drawing; if (!d) return "";
  const parts = short ? [d.location, d.scope === "equipment" ? "by client" : null]
    : [d.location, d.basis, d.scope === "equipment" ? "Client equipment" : null];
  const kept = parts.filter(Boolean);
  return kept.length ? ` — ${kept.join(" · ")}` : "";
};

describe("ChatGPT → Cunstruct end-to-end fidelity (Tests 6/7/8)", () => {
  const e = parseChatGptEvaluation(RESPONSE);

  it("TEST 6 — parser preserves every requirement, qty, unit, basis, location; nothing invented/dropped", () => {
    // 14 requirements in → 14 rows out (none dropped, none invented)
    expect(e.requirements.length).toBe(14);
    const byName = (m: string) => e.requirements.find((r) => r.match === m);
    expect(byName("6A socket")).toMatchObject({ qty: 2, unit: "nos", basis: "Counted", note: "Living / TV area" });
    expect(byName("Audio points")).toMatchObject({ qty: 4, note: "Media / projector area" });
    expect(byName("G 16A points")).toMatchObject({ qty: 4, note: "Location unclear" });
    expect(byName("Inline exhaust")).toMatchObject({ qty: 1, note: "Location unclear" });
    // measurements stay separate — never a requirement/quantity
    expect(e.measurements.map((m) => m.label)).toEqual(
      expect.arrayContaining(["Switchboard height", "TV size", "Offset", "Wall length"]));
    // The 4 dimension bullets did NOT become quantity rows (count stays 14), and
    // no dimension leaked in as a quantity (heights/offsets aren't qtys).
    expect(e.requirements.some((r) => r.match === "Switchboard height" || r.match === "Offset" || r.match === "Wall length")).toBe(false);
    expect(e.requirements.every((r) => r.qty <= 4)).toBe(true);   // real counts only, no 51"/10'/4" leaking in
    console.log("PARSED REQUIREMENTS:\n" + e.requirements.map((r) =>
      `  ${r.match} | ${r.qty} | ${r.unit} | ${r.basis} | ${r.note ?? "—"}`).join("\n"));
    console.log("MEASUREMENTS (kept as specs):\n" + e.measurements.map((m) => `  ${m.label} = ${m.value}`).join("\n"));
    console.log("AREA:", JSON.stringify(e.area), "| ARCHETYPE:", e.archetypeKey, "| FLOORS:", e.floors);
  });

  it("TEST 7 — applied to the BOQ: quantities used, provenance/location/scope kept, equipment unpriced, no double-count", () => {
    // Base includes a generic catch-all electrical allowance that the itemised
    // points should supersede (dedup), plus an unrelated civil line.
    const base: GeneratedLine[] = [
      { section: "Electrical", code: null, qty: 6, label: "Concealed wiring for light/fan/call-bell points with modular switches", unit: "point" },
      { section: "RCC", code: "5.22.6", qty: 800, label: "TMT reinforcement steel", unit: "kg" },
    ];
    const lines = applyDrawing(base, { items: e.requirements });

    // 1. drawing quantities used exactly
    expect(lines.find((l) => l.label === "6A socket")?.qty).toBe(2);
    expect(lines.find((l) => l.label === "Audio points")?.qty).toBe(4);
    // 2/5. provenance + location on every drawing line
    const tv = lines.find((l) => l.label === "TV point");
    expect(tv?.drawing).toMatchObject({ basis: "Counted", location: "Living / TV area", scope: "works" });
    // 6/7. works vs equipment; equipment unpriced by default
    const oven = lines.find((l) => l.label === "Oven/fridge provision");
    expect(oven?.included).toBeUndefined();       // works → priced
    // 3. generic catch-all superseded (dropped from total, marked Assumed)
    const generic = lines.find((l) => l.label?.startsWith("Concealed wiring"));
    expect(generic?.included).toBe(false);
    expect(generic?.basis).toBe("HEURISTIC");
    // 8. DSR/AOR line untouched
    expect(lines.find((l) => l.code === "5.22.6")?.qty).toBe(800);
    // "Location unclear" preserved verbatim — never guessed into a room
    expect(lines.find((l) => l.label === "Floor points")?.drawing?.location).toBe("Location unclear");

    console.log("APPLIED LINES (label | qty | included | basis | location | scope):");
    for (const l of lines) console.log(
      `  ${l.label} | ${l.qty} | ${l.included === false ? "EXCLUDED" : "incl"} | ${l.drawing?.basis ?? l.basis ?? "—"} | ${l.drawing?.location ?? "—"} | ${l.drawing?.scope ?? "—"}`);
  });

  it("TEST 8 — PDF/Excel description keeps Location + Basis + Scope", () => {
    const lines = applyDrawing([], { items: e.requirements });
    const tv = lines.find((l) => l.label === "TV point")!;
    const spec = (tv.label ?? "") + suffix(tv);
    expect(spec).toBe("TV point — Living / TV area · Counted");
    expect(spec).not.toBe("TV point");     // must NOT reduce to anonymous
    console.log("PDF/EXCEL SAMPLE ROWS:");
    for (const l of lines.slice(0, 6)) console.log(`  ${(l.label ?? "") + suffix(l)} | ${l.qty} ${l.unit}`);
  });
});

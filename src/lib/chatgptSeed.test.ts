import { describe, it, expect } from "vitest";
import { parseChatGptEvaluation, carrySeed } from "./chatgptEval";
import { archetypeSpec, ARCHETYPES } from "./archetypes";
import { generateForDiscipline } from "./disciplines";
import { applyDrawing } from "./boqDrawing";
import type { Spec } from "./boqSpec";

// A counted ChatGPT response (Scope column) — the flow that was failing.
const COUNTED = `## PROJECT TYPE
Residential
## ARCHETYPE
3 BHK
## DRAWING-SPECIFIC REQUIREMENTS
Requirement | Qty | Unit | Basis | Location / Note | Scope
--- | --- | --- | --- | --- | ---
TV point | 1 | nos | Counted | Living / TV area | Works
6A socket | 8 | nos | Counted | Bedroom 1 | Works
16A point | 4 | nos | Counted | Kitchen | Works
AC point | 3 | nos | Counted | Various | Works
Audio point | 4 | nos | Counted | Media area | Works
Exhaust point | 2 | nos | Counted | Bathrooms | Works
Switchboard | 6 | nos | Counted | Location unclear | Works
Floor point | 4 | nos | Counted | Location unclear | Works
Floor-to-ceiling conduit | 3 | nos | Counted | Location unclear | Works
Dishwasher point | 1 | nos | Counted | Kitchen | Works
Washing machine point | 1 | nos | Counted | Utility | Works
Projector point | 1 | nos | Counted | Media area | Works
Blind provision | 3 | nos | Counted | Bedrooms | Works
55" TV | 1 | nos | Counted | Living / TV area | Equipment`;

const seededSpec = (): Spec => {
  const e = parseChatGptEvaluation(COUNTED);
  const base = archetypeSpec(ARCHETYPES.find((a) => a.key === e.archetypeKey)!) as unknown as Record<string, unknown>;
  base._drawing = { items: e.requirements };
  return base as unknown as Spec;
};

describe("ChatGPT seed → BOQ generation contract (the 'No items yet' bug)", () => {
  it("parses 14 counted requirements", () => {
    expect(parseChatGptEvaluation(COUNTED).requirements.length).toBe(14);
  });

  it("every parsed requirement becomes a BOQ line (none lost at generation)", () => {
    const spec = seededSpec();
    const lines = generateForDiscipline("civil", spec, { area_sqft: 1500, floors: 1 });
    for (const label of ["TV point", "6A socket", "AC point", "Switchboard", "Floor point", "55\" TV"]) {
      const l = lines.find((x) => x.label === label);
      expect(l, `${label} missing from BOQ`).toBeTruthy();
    }
    // exact quantities preserved
    expect(lines.find((l) => l.label === "6A socket")?.qty).toBe(8);
    expect(lines.find((l) => l.label === "AC point")?.qty).toBe(3);
  });

  it("'new item (no match)' rows remain valid BOQ lines", () => {
    const lines = applyDrawing([], { items: parseChatGptEvaluation(COUNTED).requirements });
    const acp = lines.find((l) => l.label === "AC point");
    expect(acp?.code).toBeNull();          // no catalogue match
    expect(acp?.qty).toBe(3);              // still a valid, priceable line
    expect(acp?.included).toBeUndefined(); // works → priced
  });

  it("client-equipment rows are retained (added, unpriced by default)", () => {
    const lines = applyDrawing([], { items: parseChatGptEvaluation(COUNTED).requirements });
    const tv = lines.find((l) => l.label === "55\" TV");
    expect(tv).toBeTruthy();               // retained, not removed
    expect(tv?.included).toBe(false);      // excluded from works pricing
    expect(tv?.drawing?.scope).toBe("equipment");
  });

  it("mixed works + equipment: all lines present", () => {
    const lines = applyDrawing([], { items: parseChatGptEvaluation(COUNTED).requirements });
    const drawingLines = lines.filter((l) => l.drawing);
    expect(drawingLines.length).toBe(14);  // 13 works + 1 equipment, none dropped
  });

  it("0 requirements → no drawing lines, heuristics still generate", () => {
    const spec = archetypeSpec(ARCHETYPES.find((a) => a.key === "3bhk")!);
    const lines = generateForDiscipline("civil", spec, { area_sqft: 1500, floors: 1 });
    expect(lines.length).toBeGreaterThan(0);              // engine still produces a BOQ
    expect(lines.filter((l) => l.drawing).length).toBe(0);
  });

  it("1 requirement → generation includes it", () => {
    const e = parseChatGptEvaluation("## DRAWING-SPECIFIC REQUIREMENTS\nAC point | 8 | nos | Counted | Various | Works");
    const lines = applyDrawing([], { items: e.requirements });
    expect(lines.find((l) => l.label === "AC point")?.qty).toBe(8);
  });

  it("REGRESSION: changing archetype after ChatGPT keeps the seeded requirements", () => {
    const seeded = seededSpec();                          // from ChatGPT (3 BHK)
    // operator taps a different archetype tile → base rebuilt, seed must survive
    const villa = carrySeed(archetypeSpec(ARCHETYPES.find((a) => a.key === "villa")!) as unknown as Record<string, unknown>,
                            seeded as unknown as Record<string, unknown>) as unknown as Spec;
    const items = ((villa as unknown as Record<string, unknown>)._drawing as { items: unknown[] } | undefined)?.items;
    expect(items?.length).toBe(14);                       // NOT dropped by the archetype change
    const lines = generateForDiscipline("civil", villa, { area_sqft: 2500, floors: 2 });
    expect(lines.filter((l) => l.drawing).length).toBe(14);
  });
});

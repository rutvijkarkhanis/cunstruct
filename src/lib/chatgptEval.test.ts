import { describe, it, expect } from "vitest";
import { buildChatGptPrompt, parseChatGptEvaluation } from "./chatgptEval";
import { applyDrawing } from "./boqDrawing";

const STRUCTURED = `## PROJECT TYPE
Residential

## ARCHETYPE
3 BHK

## FLOORS
1

## AREA
Built-up area — 1,850 sqft

## SPACES
- Living — 1
- Kitchen — 1
- Bedroom — 3
- Bathroom — 3

## DISCIPLINES
- Electrical
- Furniture

## DRAWING-SPECIFIC MEASUREMENTS
- Switchboard height — 51"
- TV size — 55"

## DRAWING-SPECIFIC REQUIREMENTS
Requirement | Qty | Unit | Basis | Location / Note
--- | --- | --- | --- | ---
TV point | 1 | nos | Counted | Living / TV area
6A socket | 4 | nos | Counted | Bedroom 1
55" TV | 1 | nos | Counted | Living / TV area

## CONFIDENCE
- Project type — High
- Archetype — High
- Floors — High
- Area — Medium

## CONFIRMATIONS
- Confirm whether the study is intended as a bedroom.`;

describe("buildChatGptPrompt", () => {
  it("produces a self-contained prompt that forbids inventing quantities", () => {
    const p = buildChatGptPrompt();
    expect(p).toContain("DO NOT invent quantities");
    expect(p).toContain("Requirement | Qty | Unit | Basis | Location / Note");
    expect(p).toContain("PROJECT TYPE");
  });
});

describe("parseChatGptEvaluation — structured response", () => {
  const e = parseChatGptEvaluation(STRUCTURED);
  it("reads the project assessment", () => {
    expect(e.ok).toBe(true);
    expect(e.projectType).toBe("Residential");
    expect(e.archetype).toBe("3 BHK");
    expect(e.archetypeKey).toBe("3bhk");
    expect(e.floors).toBe(1);
    expect(e.area).toEqual({ value: 1850, type: "built-up", raw: expect.stringContaining("1,850") });
  });
  it("reads spaces, disciplines, measurements, confidence, confirmations", () => {
    expect(e.spaces).toContainEqual({ name: "Bedroom", qty: 3 });
    expect(e.disciplines).toContain("Electrical");
    expect(e.measurements).toContainEqual({ label: "TV size", value: '55"' });
    expect(e.confidence["area"]).toBe("Medium");
    expect(e.confirmations[0]).toContain("study");
  });
  it("maps requirements into drawing-summary rows with basis + location", () => {
    const tv = e.requirements.find((r) => r.match === "TV point");
    expect(tv).toMatchObject({ qty: 1, unit: "nos", basis: "Counted", note: "Living / TV area" });
    const socket = e.requirements.find((r) => r.match === "6A socket");
    expect(socket).toMatchObject({ qty: 4, note: "Bedroom 1" });
  });
  it("requirements flow into the existing Drawing Summary engine", () => {
    const lines = applyDrawing([], { items: e.requirements });
    const tv = lines.find((l) => l.label === "TV point");
    expect(tv?.qty).toBe(1);
    expect(tv?.drawing).toMatchObject({ basis: "Counted", location: "Living / TV area", scope: "works" });
    // 55" TV auto-classifies as client equipment, not priced by default
    expect(lines.find((l) => l.label === '55" TV')?.included).toBe(false);
  });
});

describe("parseChatGptEvaluation — resilience", () => {
  it("missing area stays null (never invented)", () => {
    expect(parseChatGptEvaluation("## AREA\nNot provided in the drawing.").area).toBeNull();
  });
  it("ambiguous archetype takes the primary (earliest) candidate", () => {
    const e = parseChatGptEvaluation("## ARCHETYPE\nLikely 3 BHK, but could be 2 BHK.");
    expect(e.archetype).toBe("3 BHK");
    expect(e.archetypeKey).toBe("3bhk");
  });
  it("parses markdown tables with leading/trailing pipes", () => {
    const e = parseChatGptEvaluation("## DRAWING-SPECIFIC REQUIREMENTS\n| Requirement | Qty | Unit | Basis | Location |\n|---|---|---|---|---|\n| Audio point | 4 | nos | Counted | Media area |");
    expect(e.requirements[0]).toMatchObject({ match: "Audio point", qty: 4, note: "Media area" });
  });
  it("parses prose requirements (no table) via the existing summary parser", () => {
    const e = parseChatGptEvaluation("## DRAWING-SPECIFIC REQUIREMENTS\nLiving room has 2 6A sockets and one TV point.");
    expect(e.requirements.find((r) => /6a/i.test(r.match))?.qty).toBe(2);
    expect(e.requirements.find((r) => /tv/i.test(r.match))?.qty).toBe(1);
  });
  it("preserves Derived basis from the evaluation", () => {
    const e = parseChatGptEvaluation("## DRAWING-SPECIFIC REQUIREMENTS\nWall plaster | 120 | sqft | Derived | Bedroom 1");
    expect(e.requirements[0]).toMatchObject({ match: "Wall plaster", qty: 120, unit: "sqft", basis: "Derived" });
  });
  it("returns ok=false for an unstructured response", () => {
    expect(parseChatGptEvaluation("Sorry, I can't open that image.").ok).toBe(false);
  });
});

// The exact response a real operator pasted — inline "Field: value", alternative
// section names (KEY DRAWING INFORMATION, IMPORTANT DIMENSIONS), negated disciplines.
const REAL = `PROJECT ASSESSMENT

Project Type: Residential
Archetype: 4 BHK Apartment
Floors/Levels: 1 represented level
Area: Not stated on drawing. Do not assume.

SPACES
- Living / family living area — 1
- Dining area — 1
- Kitchen — 1
- Bedrooms — 4
- Bathrooms / toilets — 4 identifiable
- Entrance / foyer — 1
- Staircase — 1
- Storage / wardrobe areas — multiple

DISCIPLINES
- Architectural
- Furniture / Interior
- Electrical
- Plumbing / Sanitary — partial
- HVAC — partial
- Civil — limited
- Fire — not identified

KEY DRAWING INFORMATION
- 55" TV indicated
- 6A electrical points shown
- 16A electrical points shown
- Multiple AC provisions shown
- Inline exhaust provisions shown

IMPORTANT DIMENSIONS
- Switchboard heights: 10.5", 21", 24", 30", 42", 45", 48", 51", 72"
- TV size: 55"
- BOS offset: 4"

BOQ GENERATION RULES
- Do not invent quantities where symbols are ambiguous.`;

describe("parseChatGptEvaluation — real operator response (regression for lost fields)", () => {
  const e = parseChatGptEvaluation(REAL);
  it("captures inline Field: value (previously lost → shown as '—')", () => {
    expect(e.projectType).toBe("Residential");
    expect(e.archetype).toBe("4 BHK");
    expect(e.archetypeKey).toBe("villa");
    expect(e.floors).toBe(1);
    expect(e.area).toBeNull();                 // "Not stated" → never invented
    expect(e.ok).toBe(true);
  });
  it("captures spaces without inventing the ones with no count", () => {
    expect(e.spaces).toContainEqual({ name: "Bedrooms", qty: 4 });
    expect(e.spaces.some((s) => /storage/i.test(s.name))).toBe(false);   // "multiple" → no number → skipped
  });
  it("excludes a discipline explicitly marked not identified", () => {
    expect(e.disciplines).toContain("Electrical");
    expect(e.disciplines).not.toContain("Fire");    // "Fire — not identified"
  });
  it("routes IMPORTANT DIMENSIONS to measurements, not requirements", () => {
    expect(e.measurements.map((m) => m.label)).toEqual(expect.arrayContaining(["Switchboard heights", "TV size", "BOS offset"]));
    expect(e.requirements.length).toBe(0);          // no counted table → no invented quantities
  });
  it("surfaces KEY DRAWING INFORMATION as an un-counted reminder", () => {
    expect(e.keyInfo.some((k) => /6A electrical points/i.test(k))).toBe(true);
    expect(e.keyInfo.some((k) => /AC provisions/i.test(k))).toBe(true);
  });
});

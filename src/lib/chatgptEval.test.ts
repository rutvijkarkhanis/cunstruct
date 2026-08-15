import { describe, it, expect } from "vitest";
import { buildChatGptPrompt, disciplineForBoq, parseChatGptEvaluation, roomsFromSpaces, specFromEvaluation } from "./chatgptEval";
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
  it("carries the source-boundary rule and the not-assessable / conservative principles", () => {
    const p = buildChatGptPrompt();
    expect(p).toContain("Source boundary");
    expect(p).toMatch(/ONLY use the drawing supplied/i);
    expect(p).toContain("Not assessable from supplied drawing");
    expect(p).toContain("UNKNOWN IS BETTER THAN INVENTED");
    expect(p).toContain("Requirement | Qty | Unit | Basis | Location / Note | Scope");
  });
  it("mentions external documents only to forbid them, never to instruct consulting them", () => {
    const p = buildChatGptPrompt();
    expect(p).toMatch(/Do not reference[^]*architectural schedules/i);        // prohibition present
    expect(p).toMatch(/Never ask me to check a schedule, CAD file/i);          // confirmation-section prohibition
    expect(p).not.toContain("against the architectural schedule");            // the BAD pattern is absent
    expect(p).not.toContain("Verify against the plumbing drawing");
  });
  it("keeps specifications out of the quantity field and dimensions out of quantities", () => {
    const p = buildChatGptPrompt();
    expect(p).toMatch(/Do not put a specification .*into the quantity field/i);
    expect(p).toMatch(/dimension .*is a measurement, never a quantity/i);
  });
  it("asks for the identified-vs-not-assessable discipline split and the category checklist", () => {
    const p = buildChatGptPrompt();
    expect(p).toContain("Identified in drawing:");
    expect(p).toContain("Not assessable:");
    expect(p).toContain("AC points");
    expect(p).toContain("switchboards");
    expect(p).toContain("None seen");
  });
});

describe("parseChatGptEvaluation — Scope column + none-seen", () => {
  const e = parseChatGptEvaluation(`## DRAWING-SPECIFIC REQUIREMENTS
Requirement | Qty | Unit | Basis | Location / Note | Scope
--- | --- | --- | --- | --- | ---
TV point | 1 | nos | Counted | Living / TV area | Works
55" TV | 1 | nos | Counted | Living / TV area | Equipment
Sprinkler | none seen | | | | Works`);
  it("reads Works/Equipment scope and preserves location", () => {
    expect(e.requirements.find((r) => r.match === "TV point")).toMatchObject({ qty: 1, note: "Living / TV area", equipment: false });
    expect(e.requirements.find((r) => r.match === '55" TV')?.equipment).toBe(true);
  });
  it("skips a 'none seen' row (no invented quantity)", () => {
    expect(e.requirements.some((r) => /sprinkler/i.test(r.match))).toBe(false);
    expect(e.requirements.length).toBe(2);
  });
  it("Equipment scope flows through to an unpriced BOQ line", () => {
    const lines = applyDrawing([], { items: e.requirements });
    expect(lines.find((l) => l.label === '55" TV')?.included).toBe(false);
    expect(lines.find((l) => l.label === "TV point")?.included).toBeUndefined();
  });
});

describe("Refinement — not-assessable, measurement/requirement separation, discipline prefill", () => {
  it("a 'Not assessable' row never becomes a drawing quantity (kept separate)", () => {
    const e = parseChatGptEvaluation(`## DRAWING-SPECIFIC REQUIREMENTS
Requirement | Qty | Unit | Basis | Location / Note | Scope
--- | --- | --- | --- | --- | ---
TV point | 1 | nos | Counted | Living | Works
Floor trap |  |  | Not assessable | plumbing symbols not legible | Works
Water point | 4 | nos | Not assessable | not legible | Works`);
    expect(e.requirements.map((r) => r.match)).toEqual(["TV point"]);           // only the counted one
    expect(e.notAssessable).toEqual(expect.arrayContaining(["Floor trap", "Water point"]));
    // even a numbered 'Not assessable' row must not enter the priced BOQ
    const lines = applyDrawing([], { items: e.requirements });
    expect(lines.some((l) => /water point|floor trap/i.test(l.label ?? ""))).toBe(false);
  });

  it("'16A' is a specification, not a quantity", () => {
    const e = parseChatGptEvaluation(`## DRAWING-SPECIFIC REQUIREMENTS
16A socket | 6 | nos | Counted | Kitchen | Works`);
    const s = e.requirements.find((r) => /16A socket/i.test(r.match));
    expect(s?.qty).toBe(6);                 // qty is 6, not 16
    expect(s?.match).toBe("16A socket");    // the 16A stays in the requirement text
  });

  it("a dimension line ('4\" from BOS') stays a measurement, never a requirement quantity", () => {
    const e = parseChatGptEvaluation(`## DRAWING-SPECIFIC MEASUREMENTS
- Geyser point offset — 4" from BOS
- AC point specification — 16A, on ceiling
## DRAWING-SPECIFIC REQUIREMENTS
Geyser electrical point | 1 | nos | Counted | Bathroom | Works`);
    expect(e.measurements.map((m) => m.label)).toEqual(expect.arrayContaining(["Geyser point offset", "AC point specification"]));
    expect(e.requirements.some((r) => /4"|BOS|specification/i.test(r.match))).toBe(false);   // no spec/dimension became a requirement
    expect(e.requirements.find((r) => /geyser/i.test(r.match))?.qty).toBe(1);                 // the point itself is a requirement
  });

  it("disciplines: identified prefill; 'not assessable' / negated excluded; operator-mappable", () => {
    const e = parseChatGptEvaluation(`## DISCIPLINES
Identified in drawing:
- Electrical
- Furniture
- Architectural
Not assessable:
- Fire
- Plumbing`);
    expect(e.disciplines).toEqual(expect.arrayContaining(["Electrical", "Architectural", "Furniture"]));
    expect(e.disciplines).not.toContain("Fire");
    expect(e.disciplines).not.toContain("Plumbing");
    expect(disciplineForBoq(e.disciplines)).toBe("civil");    // Architectural → civil BOQ base
    expect(disciplineForBoq(["Electrical"])).toBe("electrical");
  });

  it("'no fire symbols identified' does not preselect Fire", () => {
    const e = parseChatGptEvaluation("## DISCIPLINES\n- Electrical\n- Fire: no fire-system symbols clearly identified");
    expect(e.disciplines).toContain("Electrical");
    expect(e.disciplines).not.toContain("Fire");
  });

  it("missing area stays Not provided", () => {
    expect(parseChatGptEvaluation("## AREA\nNot provided").area).toBeNull();
  });
});

describe("roomsFromSpaces — drawing spaces drive room counts (no template invention)", () => {
  it("maps identified spaces onto room-count fields, summing matches", () => {
    const r = roomsFromSpaces([
      { name: "Master Bedroom", qty: 1 }, { name: "Bedroom", qty: 2 },
      { name: "Bathroom / toilet", qty: 3 }, { name: "Kitchen", qty: 1 },
      { name: "Living", qty: 1 }, { name: "Dining", qty: 1 },
      { name: "Balcony", qty: 2 }, { name: "Utility", qty: 1 }, { name: "Study", qty: 1 },
    ]);
    expect(r).toEqual({ bedrooms: 3, bathrooms: 3, kitchens: 1, living: 2, balconies: 2, utility: 1, pooja: 1 });
  });
  it("does not count circulation spaces (foyer / staircase) as priced rooms", () => {
    const r = roomsFromSpaces([{ name: "Entrance / foyer", qty: 1 }, { name: "Staircase", qty: 1 }, { name: "Bedroom", qty: 2 }]);
    expect(r).toEqual({ bedrooms: 2 });
  });
  it("leaves a room type the drawing never names ABSENT (never defaulted)", () => {
    const r = roomsFromSpaces([{ name: "Bedroom", qty: 1 }]);
    expect(r.bathrooms).toBeUndefined();
    expect(r.kitchens).toBeUndefined();
  });
});

describe("specFromEvaluation — drawing is source of truth, no generic room defaults", () => {
  // An "Apartment" eval: previously seeded the apartment_floor template (6 beds /
  // 6 baths / 3 kitchens / 3 flats). Now the drawing's own spaces must win.
  const APARTMENT = `## PROJECT TYPE
Residential
## ARCHETYPE
Apartment
## BOQ ALLOCATION
Floor 1
## FLOOR SCOPE
First Floor / Floor 1 private apartment
## SPACES
- Master Bedroom — 1
- Bedroom — 1
- Bathroom — 2
- Kitchen — 1
- Living / dining — 1
- Balcony — 1
## DRAWING-SPECIFIC REQUIREMENTS
Requirement | Qty | Unit | Basis | Location / Note | Scope | Status
--- | --- | --- | --- | --- | --- | ---
WC | 4 | nos | Counted | Private bathrooms | Works | Quantified
Wardrobe |  |  | Not assessable | Master Bedroom | Works | Identified — Needs detail
Study unit |  |  | Not assessable | Study | Works | Identified — Needs detail`;

  const e = parseChatGptEvaluation(APARTMENT);
  const spec = specFromEvaluation(e);

  it("captures the floor allocation and scope (not the building floor count)", () => {
    expect(e.boqAllocation).toBe("Floor 1");
    expect(e.floor).toBe(1);
    expect(e.floorScope).toContain("private apartment");
    expect(spec._boq_allocation).toBe("Floor 1");
    expect(spec._floors).toBe(1);
  });

  it("room counts come from the drawing spaces, NOT the apartment template (6/6/3)", () => {
    expect(spec.bedrooms).toBe(2);
    expect(spec.bathrooms).toBe(2);
    expect(spec.kitchens).toBe(1);
    expect(spec.living).toBe(1);
    expect(spec.balconies).toBe(1);
    // never the generic apartment_floor 6/6/3/3
    expect(spec.bedrooms).not.toBe(6);
    expect(spec.bathrooms).not.toBe(6);
  });

  it("does not fabricate flats-per-floor from a multi-unit template", () => {
    expect(Number(spec.flats_per_floor)).not.toBe(3);   // 1 (single-owner floor), never the apartment default 3
  });

  it("leaves a room the drawing never establishes blank (no silent 2)", () => {
    const solo = specFromEvaluation(parseChatGptEvaluation("## SPACES\n- Bedroom — 1"));
    expect(solo.bathrooms).toBeUndefined();
    expect(solo.kitchens).toBeUndefined();
  });

  it("ALL requirements flow into the Drawing section — quantified + needs-detail", () => {
    const items = (spec._drawing as { items: unknown[] }).items;
    expect(items.length).toBe(3);          // WC (quantified) + Wardrobe + Study unit (needs detail)
    expect(e.requirements.length).toBe(1); // only WC is priced
    expect(e.needsDetail.length).toBe(2);  // the two identified-but-unquantified items retained
  });

  it("marks the source and keeps spaces/scope for downstream editing", () => {
    expect(spec._source).toBe("chatgpt");
    expect(spec._floor_scope).toContain("private apartment");
    expect((spec._spaces as unknown[]).length).toBeGreaterThan(0);
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

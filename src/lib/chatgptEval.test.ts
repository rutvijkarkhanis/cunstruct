import { describe, it, expect } from "vitest";
import { boqBucketOf, buildChatGptPrompt, disciplineForBoq, extractJson, itemBelongsToBoq, parseChatGptEvaluation, roomsFromSpaces, specFromEvaluation } from "./chatgptEval";
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

describe("buildChatGptPrompt — strict JSON contract", () => {
  it("demands one strict JSON object and forbids markdown / fences / prose", () => {
    const p = buildChatGptPrompt();
    expect(p).toMatch(/Return ONLY one valid JSON object/i);
    expect(p).toMatch(/No markdown/i);
    expect(p).toMatch(/No code fences|No `{3}json/i);
    expect(p).toMatch(/No explanatory text before or after/i);
  });
  it("embeds the exact schema keys the parser expects", () => {
    const p = buildChatGptPrompt();
    for (const key of ["project_type", "archetype", "floor", "boq_allocation", "floor_scope",
      "area", "area_type", "spaces", "disciplines", "measurements", "requirements",
      "category_summary", "confidence", "confirmations"]) {
      expect(p, `schema missing key ${key}`).toContain(`"${key}"`);
    }
    // the JSON template must actually be valid JSON once the "a | b | null" hint
    // strings are treated as plain strings
    expect(p).toContain('"identified"');
    expect(p).toContain('"status": "Identified — Needs detail"');
  });
  it("carries the source-boundary rule and the conservative principles", () => {
    const p = buildChatGptPrompt();
    expect(p).toContain("Source boundary");
    expect(p).toMatch(/ONLY use the drawing supplied/i);
    expect(p).toContain("UNKNOWN IS BETTER THAN INVENTED");
    expect(p).toMatch(/"qty" is a number or null/i);   // spec/dimension never in qty
  });
  it("mentions external documents only to forbid them, never to instruct consulting them", () => {
    const p = buildChatGptPrompt();
    expect(p).toMatch(/Do not reference[^]*architectural schedules/i);        // prohibition present
    expect(p).toMatch(/Never ask me to obtain or check another document/i);   // no external-doc chase
    expect(p).not.toContain("against the architectural schedule");            // the BAD pattern is absent
    expect(p).not.toContain("Verify against the plumbing drawing");
  });
  it("instructs visual counting and COUNTABLE ≠ MEASURABLE", () => {
    const p = buildChatGptPrompt();
    expect(p).toMatch(/COUNT WHAT YOU CAN SEE/i);
    expect(p).toMatch(/Visually inspect/i);
    expect(p).toMatch(/OCR/i);
    expect(p).toMatch(/COUNTABLE ≠ MEASURABLE/);
    expect(p).toMatch(/Counting workflow/i);
    expect(p).toMatch(/Running length not established/i);       // the countable-not-measurable example
    expect(p).toMatch(/Do NOT.*collapse.*generic "electrical point"/i);
    expect(p).toMatch(/Common Area/);                           // allocation guidance
  });
  it("maximises counting: unknown spec/model/material never blocks a count (COUNTABLE ≠ FULLY SPECIFIED)", () => {
    const p = buildChatGptPrompt();
    expect(p).toMatch(/COUNTABLE ≠ FULLY SPECIFIED/);
    // an unknown specification / model / material must NOT force qty null
    expect(p).toMatch(/model.*specification.*material|specification.*material/i);
    expect(p).toMatch(/4 WCs/);                                 // the WC worked example
    expect(p).toMatch(/3 wardrobes/);                           // the wardrobe worked example
    // a numeric count must never be paired with a "Not assessable" basis (else it is discarded)
    expect(p).toMatch(/BASIS MUST MATCH THE COUNT/);
    expect(p).toMatch(/Never pair a real count with a "Not assessable" basis/);
  });
  it("makes a per-category count decision across the full Floor-1 audit list", () => {
    const p = buildChatGptPrompt();
    expect(p).toMatch(/COUNT DECISION/);
    // representative categories the operator asked to audit — all must be named
    for (const cat of [
      "5A/6A sockets", "15A/16A sockets", "distribution board", "ceiling fans",
      "tube lights", "AC points", "TV / plasma points", "calling bell", "geyser points",
      "tower / wall fans", "exhaust", "conduits",
      "WC", "wash basin", "CP fittings", "floor drain / floor trap", "kitchen sink",
      "washing-machine provision", "refrigerator provision",
      "internal walls / partitions", "windows", "ventilators", "green pocket",
      "flooring", "wall finishes", "false ceiling",
      "wardrobes", "walk-in closets", "dress units", "mirror units", "study units",
      "kitchen platform", "kitchen island", "wet-kitchen storage", "feature walls",
      "consoles / fixed storage", "media-room screen / projection provision",
    ]) expect(p, `audit category missing from prompt: ${cat}`).toContain(cat);
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

describe("COUNTABLE ≠ MEASURABLE + combined-floor allocation", () => {
  // A Floor 1 evaluation that also identifies a common-area lift. Countable items
  // carry a status of "Identified — Needs detail" ONLY because a dimension is
  // missing — they must still be Quantified. Genuinely blank ones stay needs-detail.
  const FLOOR1 = `{
    "project_type": "Residential", "archetype": "Apartment",
    "floor": 1, "boq_allocation": "Floor 1", "floor_scope": "First Floor / Floor 1 private apartment",
    "area": null, "area_type": null,
    "spaces": [
      { "name": "Master Bedroom", "qty": 1 }, { "name": "Bedroom", "qty": 3 },
      { "name": "Bathroom", "qty": 4 }, { "name": "Kitchen", "qty": 1 }, { "name": "Living / dining", "qty": 1 }
    ],
    "disciplines": { "identified": ["Architectural", "Electrical", "Plumbing"], "not_assessable": ["Fire"] },
    "measurements": [{ "name": "Room dimension", "value": "10'-8\\" x 12'-4\\"", "location": "Master Bedroom" }],
    "requirements": [
      { "allocation": "Floor 1", "requirement": "6A socket", "qty": 24, "unit": "nos", "basis": "Counted", "location": "Various", "scope": "Works", "status": "Quantified" },
      { "allocation": "Floor 1", "requirement": "WC", "qty": 4, "unit": "nos", "basis": "Counted", "location": "Bathrooms", "scope": "Works", "status": "Quantified" },
      { "allocation": "Floor 1", "requirement": "Wardrobe", "qty": 5, "unit": "nos", "basis": "Visually counted from drawing", "location": "Bedrooms", "note": "", "scope": "Works", "status": "Identified — Needs detail" },
      { "allocation": "Floor 1", "requirement": "Feature wall", "qty": 1, "unit": "nos", "basis": "Visually counted from drawing", "location": "Living", "note": "", "scope": "Works", "status": "Identified — Needs detail" },
      { "allocation": "Floor 1", "requirement": "Kitchen island", "qty": 1, "unit": "nos", "basis": "Counted", "location": "Kitchen", "scope": "Works", "status": "Quantified" },
      { "allocation": "Floor 1", "requirement": "Skirting run", "qty": null, "unit": null, "basis": "Not assessable", "location": "unclear", "scope": "Works", "status": "Identified — Needs detail" },
      { "allocation": "Floor 1", "requirement": "55\\" TV", "qty": 1, "unit": "nos", "basis": "Counted", "location": "Living", "scope": "Equipment", "status": "Quantified" },
      { "allocation": "Common Area", "requirement": "Lift", "qty": 1, "unit": "nos", "basis": "Counted", "location": "Core", "scope": "Works", "status": "Quantified" }
    ],
    "confidence": { "archetype": "High", "floor": "High" }, "confirmations": []
  }`;
  const e = parseChatGptEvaluation(FLOOR1);

  it("a countable item tagged 'Needs detail' for a missing DIMENSION is Quantified (COUNTABLE ≠ MEASURABLE)", () => {
    const wardrobe = e.requirements.find((r) => r.match === "Wardrobe");
    expect(wardrobe, "Wardrobe should be a quantified requirement, not needs-detail").toMatchObject({ qty: 5, unit: "nos" });
    expect(e.needsDetail.some((r) => r.match === "Wardrobe")).toBe(false);
    const feature = e.requirements.find((r) => r.match === "Feature wall");
    expect(feature).toMatchObject({ qty: 1 });
    const island = e.requirements.find((r) => r.match === "Kitchen island");
    expect(island).toMatchObject({ qty: 1 });
  });
  it("visible electrical/plumbing symbols are quantified", () => {
    expect(e.requirements.find((r) => r.match === "6A socket")?.qty).toBe(24);
    expect(e.requirements.find((r) => r.match === "WC")?.qty).toBe(4);
  });
  it("a genuinely uncountable item (qty null) remains needs-detail — never invented", () => {
    expect(e.needsDetail.map((r) => r.match)).toContain("Skirting run");
    expect(e.requirements.some((r) => r.match === "Skirting run")).toBe(false);
  });
  it("Equipment vs Works survives parsing", () => {
    expect(e.requirements.find((r) => r.match === '55" TV')?.equipment).toBe(true);
    expect(e.requirements.find((r) => r.match === "6A socket")?.equipment).toBe(false);
  });
  it("allocation is preserved on every row", () => {
    expect(e.requirements.every((r) => r.allocation === "Floor 1" || r.allocation === "Common Area")).toBe(true);
    expect(e.requirements.find((r) => r.match === "Lift")?.allocation).toBe("Common Area");
  });
  it("no dimension/spec leaks into qty — dimensions stay in measurements", () => {
    expect(e.measurements.find((m) => m.label === "Room dimension")?.value).toContain("10'-8");
    expect(e.requirements.every((r) => Number.isFinite(r.qty))).toBe(true);   // every priced qty is a plain number
    expect(e.requirements.some((r) => /["']|x /.test(String(r.qty)))).toBe(false);
  });

  it("specFromEvaluation: Common Area is NOT priced into the Floor 1 BOQ", () => {
    const spec = specFromEvaluation(e);
    const rows = (spec._drawing as { items: { match: string; allocation?: string }[] }).items;
    expect(rows.some((r) => r.match === "Lift")).toBe(false);              // common-area excluded
    expect(rows.some((r) => r.match === "Wardrobe")).toBe(true);           // floor-1 kept
    expect(rows.every((r) => r.allocation !== "Common Area")).toBe(true);
  });
  it("specFromEvaluation: room counts come from spaces, floor/allocation preserved", () => {
    const spec = specFromEvaluation(e);
    expect(spec.bedrooms).toBe(4);        // Master(1) + Bedroom(3)
    expect(spec.bathrooms).toBe(4);
    expect(spec.bedrooms).not.toBe(6);    // never the apartment template default
    expect(spec._floors).toBe(1);
    expect(spec._boq_allocation).toBe("Floor 1");
  });
  it("all Floor-1 requirements (quantified + needs-detail) survive into DrawingItem rows", () => {
    const spec = specFromEvaluation(e);
    const rows = (spec._drawing as { items: { match: string }[] }).items;
    // 6 quantified Floor-1 (6A, WC, Wardrobe, Feature wall, Kitchen island, 55" TV) + 1 needs-detail (Skirting) = 7
    expect(rows.length).toBe(7);
    for (const m of ["6A socket", "WC", "Wardrobe", "Feature wall", "Kitchen island", "Skirting run", '55" TV'])
      expect(rows.some((r) => r.match === m), `${m} missing from DrawingItem rows`).toBe(true);
  });

  it("boqBucketOf / itemBelongsToBoq: floor bucket excludes common + other floors, keeps unallocated", () => {
    expect(boqBucketOf({ boqAllocation: "Floor 1", floor: 1 })).toBe("Floor 1");
    expect(boqBucketOf({ boqAllocation: undefined, floor: 2 })).toBe("Floor 2");
    expect(itemBelongsToBoq("Floor 1", "Floor 1")).toBe(true);
    expect(itemBelongsToBoq("floor1", "Floor 1")).toBe(true);       // loose match
    expect(itemBelongsToBoq("Common Area", "Floor 1")).toBe(false);
    expect(itemBelongsToBoq("Floor 2", "Floor 1")).toBe(false);
    expect(itemBelongsToBoq(undefined, "Floor 1")).toBe(true);      // unallocated belongs
    expect(itemBelongsToBoq("Common Area", undefined)).toBe(true);  // no bucket → keep all
  });
});

describe("markdown fallback: countable item with needs-detail status is still quantified", () => {
  it("qty present + 'Identified — Needs detail' status → quantified (count wins)", () => {
    const e = parseChatGptEvaluation(`## DRAWING-SPECIFIC REQUIREMENTS
Requirement | Qty | Unit | Basis | Location / Note | Scope | Status
--- | --- | --- | --- | --- | --- | ---
Wardrobe | 5 | nos | Counted | Bedrooms | Works | Identified — Needs detail`);
    expect(e.requirements.find((r) => r.match === "Wardrobe")).toMatchObject({ qty: 5 });
    expect(e.needsDetail.some((r) => r.match === "Wardrobe")).toBe(false);
  });
});

describe("strict JSON contract (primary format)", () => {
  const JSON_EVAL = `{
    "project_type": "Residential",
    "archetype": "Apartment",
    "floor": 1,
    "boq_allocation": "Floor 1",
    "floor_scope": "First Floor / Floor 1 private apartment",
    "area": null,
    "area_type": null,
    "spaces": [
      { "name": "Master Bedroom", "qty": 1, "basis": "Counted", "note": "" },
      { "name": "Bedroom", "qty": 1, "basis": "Counted", "note": "" },
      { "name": "Bathroom", "qty": 2, "basis": "Counted", "note": "" },
      { "name": "Kitchen", "qty": 1, "basis": "Counted", "note": "" },
      { "name": "Living / dining", "qty": 1, "basis": "Counted", "note": "" },
      { "name": "Balcony", "qty": 1, "basis": "Counted", "note": "" }
    ],
    "disciplines": { "identified": ["Architectural", "Electrical", "Plumbing"], "not_assessable": ["Fire"] },
    "measurements": [
      { "name": "Room dimension", "value": "10'-8\\" x 12'-4\\"", "location": "Master Bedroom" }
    ],
    "requirements": [
      { "allocation": "Floor 1", "requirement": "WC", "qty": 4, "unit": "nos", "basis": "Counted", "location": "Private bathrooms", "note": "", "scope": "Works", "status": "Quantified" },
      { "allocation": "Floor 1", "requirement": "Wash basin", "qty": 3, "unit": "nos", "basis": "Counted", "location": "Bathrooms", "note": "", "scope": "Works", "status": "Quantified" },
      { "allocation": "Floor 1", "requirement": "Wardrobe", "qty": null, "unit": null, "basis": "Not assessable", "location": "Master Bedroom", "note": "", "scope": "Works", "status": "Identified — Needs detail" },
      { "allocation": "Floor 1", "requirement": "TV unit", "qty": null, "unit": null, "basis": "Not assessable", "location": "Living", "note": "", "scope": "Works", "status": "Identified — Needs detail" },
      { "allocation": "Floor 1", "requirement": "Floor trap", "qty": null, "unit": null, "basis": "Not assessable", "location": "not legible", "note": "", "scope": "Works", "status": "Not assessable" }
    ],
    "category_summary": {
      "electrical": { "status": "Identified", "items": ["6A points shown"] },
      "fire": { "status": "Not assessable", "items": [] }
    },
    "confidence": { "project_type": "High", "archetype": "High", "floor": "High", "area": "Low", "major_spaces": "High" },
    "confirmations": ["Confirm the door schedule count."]
  }`;
  const e = parseChatGptEvaluation(JSON_EVAL);

  it("reads the headline fields (archetype Apartment, floor 1, allocation) — the previously-broken ones", () => {
    expect(e.ok).toBe(true);
    expect(e.projectType).toBe("Residential");
    expect(e.archetype).toBe("Apartment");
    expect(e.archetypeKey).toBe("apartment_floor");
    expect(e.floor).toBe(1);
    expect(e.boqAllocation).toBe("Floor 1");
    expect(e.floorScope).toBe("First Floor / Floor 1 private apartment");
    expect(e.area).toBeNull();
  });
  it("preserves spaces, disciplines, measurements, confidence, confirmations", () => {
    expect(e.spaces).toContainEqual({ name: "Master Bedroom", qty: 1 });
    expect(e.disciplines).toEqual(["Architectural", "Electrical", "Plumbing"]);
    expect(e.disciplines).not.toContain("Fire");
    expect(e.measurements[0]).toMatchObject({ label: "Room dimension", note: "Master Bedroom" });
    expect(e.confidence["archetype"]).toBe("High");
    expect(e.confidence["floors"]).toBe("High");          // aliased for the UI
    expect(e.confirmations).toEqual(["Confirm the door schedule count."]);
    expect(e.keyInfo).toContain("6A points shown");
  });
  it("splits requirements into quantified / needs-detail / not-assessable, keeping allocation", () => {
    expect(e.requirements.map((r) => r.match).sort()).toEqual(["WC", "Wash basin"]);
    expect(e.requirements.find((r) => r.match === "WC")).toMatchObject({ qty: 4, unit: "nos", allocation: "Floor 1" });
    expect(e.needsDetail.map((r) => r.match).sort()).toEqual(["TV unit", "Wardrobe"]);
    expect(e.needsDetail.every((r) => r.allocation === "Floor 1")).toBe(true);
    expect(e.notAssessable).toEqual(["Floor trap"]);
  });
  it("specFromEvaluation drives room counts from the drawing spaces, not the template", () => {
    const spec = specFromEvaluation(e);
    expect(spec.bedrooms).toBe(2);
    expect(spec.bathrooms).toBe(2);
    expect(spec.kitchens).toBe(1);
    expect(spec.living).toBe(1);
    expect(spec.balconies).toBe(1);
    expect(spec.bedrooms).not.toBe(6);
    expect(spec._floors).toBe(1);
    expect(spec._boq_allocation).toBe("Floor 1");
    const items = (spec._drawing as { items: unknown[] }).items;
    expect(items.length).toBe(4);   // 2 quantified + 2 needs-detail flow into the Drawing section
  });

  it("tolerates ```json fences and stray prose around the object", () => {
    const wrapped = "Here is the assessment:\n\n```json\n{ \"archetype\": \"Apartment\", \"floor\": 2, \"requirements\": [] }\n```\nLet me know if you need changes.";
    const w = parseChatGptEvaluation(wrapped);
    expect(w.archetype).toBe("Apartment");
    expect(w.floor).toBe(2);
    expect(w.ok).toBe(true);
  });
  it("reads a numeric area with area_type", () => {
    const a = parseChatGptEvaluation('{ "archetype": "3 BHK", "area": 1850, "area_type": "carpet" }');
    expect(a.area).toEqual({ value: 1850, type: "carpet", raw: "1850" });
    expect(a.archetypeKey).toBe("3bhk");
  });
  it("falls back to the markdown parser when the response is not JSON", () => {
    const md = parseChatGptEvaluation("## PROJECT TYPE\nResidential\n## ARCHETYPE\n3 BHK");
    expect(md.projectType).toBe("Residential");
    expect(md.archetypeKey).toBe("3bhk");
  });
  it("extractJson returns null for non-JSON text", () => {
    expect(extractJson("Sorry, I can't read that drawing.")).toBeNull();
  });
});

describe("parser robustness — header-aware table, dividers, echoed instructions", () => {
  // The failing real-world case: an Allocation column shifts every value one cell
  // left under a positional parser, so all rows collapse to a single "Floor 1".
  const WITH_ALLOCATION = `## BOQ ALLOCATION
Floor 1
## FLOOR SCOPE
First Floor / Floor 1 private apartment
## DRAWING-SPECIFIC REQUIREMENTS
| Allocation | Requirement | Qty | Unit | Basis | Location | Scope | Status |
|---|---|---|---|---|---|---|---|
| Floor 1 | WC | 4 | nos | Counted | Private bathrooms | Works | Quantified |
| Floor 1 | Wardrobe |  |  | Not assessable | Master Bedroom | Works | Identified — Needs detail |
| Floor 1 | Study unit |  |  | Not assessable | Study | Works | Identified — Needs detail |
| Floor 1 | Wash basin | 3 | nos | Counted | Bathrooms | Works | Quantified |`;
  const e = parseChatGptEvaluation(WITH_ALLOCATION);
  it("maps columns by header name so an Allocation column doesn't break every row", () => {
    expect(e.requirements.map((r) => r.match).sort()).toEqual(["WC", "Wash basin"]);
    expect(e.requirements.find((r) => r.match === "WC")).toMatchObject({ qty: 4, unit: "nos", basis: "Counted", note: "Private bathrooms", allocation: "Floor 1" });
    expect(e.needsDetail.map((r) => r.match).sort()).toEqual(["Study unit", "Wardrobe"]);
  });
  it("captures the allocation on each row and at eval level", () => {
    expect(e.boqAllocation).toBe("Floor 1");
    expect(e.floor).toBe(1);
    expect(e.requirements.every((r) => r.allocation === "Floor 1")).toBe(true);
    expect(e.needsDetail.every((r) => r.allocation === "Floor 1")).toBe(true);
  });

  it("still parses the classic headerless req|qty|unit|basis layout", () => {
    const c = parseChatGptEvaluation("## DRAWING-SPECIFIC REQUIREMENTS\n16A socket | 6 | nos | Counted | Kitchen | Works");
    expect(c.requirements[0]).toMatchObject({ match: "16A socket", qty: 6, note: "Kitchen" });
  });

  it("does not leak echoed instruction blocks (FINAL VALIDATION / ==== dividers) into fields", () => {
    const withMeta = `==================================================
BOQ ALLOCATION
==================================================
Floor 1

==================================================
FINAL VALIDATION
==================================================
Before returning the assessment, verify:
1. Project type comes from the drawing
2. Do not invent quantities
3. Requirements reflect the drawing only

## CONFIRMATIONS
- Confirm the door count.`;
    const m = parseChatGptEvaluation(withMeta);
    expect(m.boqAllocation).toBe("Floor 1");                                  // not "====" or "Basis ="
    expect(m.confirmations).toEqual(["Confirm the door count."]);            // validation text not appended
    expect(m.confirmations.some((c) => /final validation|before returning|comes from the drawing/i.test(c))).toBe(false);
  });

  it("archetype = Apartment is read as Apartment (not 1 BHK)", () => {
    const a = parseChatGptEvaluation("## ARCHETYPE\nApartment");
    expect(a.archetype).toBe("Apartment");
    expect(a.archetypeKey).toBe("apartment_floor");
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

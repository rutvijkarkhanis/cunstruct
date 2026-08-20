import { describe, it, expect } from "vitest";
import { eligibleScopes, allocationFloors, withinAllocation, isWholeProjectBoq, type BoqScope } from "./boqAllocation";
import { generateForDiscipline } from "./disciplines";
import { parseChatGptEvaluation, specFromEvaluation, itemBelongsToBoq } from "./chatgptEval";
import { defaultSpec, type Spec } from "./boqSpec";
import type { GeneratedLine } from "./boqDsrGenerate";

// The generalised BOQ allocation model: a BOQ contains only the scope its
// allocation is responsible for. Catalogue items declare a scope layer; the
// allocation declares which layers it owns; eligibility falls out of the two —
// no per-item exclusions, no hardcoded project tree.

const alloc = (a: string, s?: string): Spec => ({ _boq_allocation: a, _floor_scope: s ?? "" } as Spec);
const scopes = (spec: Spec) => [...eligibleScopes(spec)].sort();

describe("eligibleScopes — allocation → owned scope layers", () => {
  it("a whole-project BOQ (no allocation) owns every layer", () => {
    expect(isWholeProjectBoq(defaultSpec())).toBe(true);
    expect(scopes(defaultSpec())).toEqual(["building", "common", "site", "structure", "substructure", "unit"]);
  });
  it("a private-apartment floor BOQ owns only unit fit-out", () => {
    expect(scopes(alloc("Floor 1", "First Floor / Floor 1 private apartment"))).toEqual(["unit"]);
  });
  it("a bare floor BOQ owns that floor's structure plus its unit work", () => {
    expect(scopes(alloc("Floor 2"))).toEqual(["structure", "unit"]);
  });
  it("a common / shared BOQ owns the project-wide shared layers", () => {
    expect(scopes(alloc("Common Area"))).toEqual(["building", "common", "site", "substructure"]);
  });
  it("a dedicated Foundation or Site BOQ owns just that layer", () => {
    expect(scopes(alloc("Foundation"))).toEqual(["substructure"]);
    expect(scopes(alloc("Site & Infrastructure"))).toEqual(["site"]);
  });
});

describe("allocationFloors — a per-floor BOQ is one floor of work", () => {
  it("collapses whole-building scaling to a single floor for a unit/floor BOQ", () => {
    expect(allocationFloors(alloc("Floor 1", "private apartment"), 4)).toBe(1);
    expect(allocationFloors(alloc("Floor 2"), 4)).toBe(1);
  });
  it("keeps the real floor count for whole-project and shared BOQs", () => {
    expect(allocationFloors(defaultSpec(), 4)).toBe(4);
    expect(allocationFloors(alloc("Common Area"), 4)).toBe(4);
  });
});

describe("withinAllocation — keep only lines this BOQ owns", () => {
  const lines: GeneratedLine[] = [
    { section: "RCC", code: "5.3", qty: 40, label: "RCC", unit: "cum", scope: "structure" },
    { section: "Earthwork", code: "2.8.1", qty: 10, label: "Excavation", unit: "cum", scope: "substructure" },
    { section: "Water", code: null, qty: 1, label: "Underground water sump", unit: "nos", scope: "building" },
    { section: "Sanitary", code: "17.2.1", qty: 4, label: "WC", unit: "each", scope: "unit" },
    { section: "External", code: "6.4.2", qty: 5, label: "Compound wall", unit: "cum", scope: "site" },
  ];
  it("a private-apartment BOQ keeps unit work, drops structure/substructure/site/building", () => {
    const out = withinAllocation(lines, alloc("Floor 1", "private apartment"));
    expect(out.map((l) => l.label)).toEqual(["WC"]);
  });
  it("a whole-project BOQ keeps everything", () => {
    expect(withinAllocation(lines, defaultSpec())).toHaveLength(5);
  });
  it("a bare-floor BOQ keeps structure + unit, still drops substructure/site/building", () => {
    expect(withinAllocation(lines, alloc("Floor 2")).map((l) => l.label).sort()).toEqual(["RCC", "WC"]);
  });
  it("never fabricates or mutates a quantity", () => {
    const out = withinAllocation(lines, alloc("Floor 1", "private apartment"));
    expect(out[0].qty).toBe(4);
  });
});

// ---- Case A: multi-floor apartment ----------------------------------------
describe("Case A — multi-floor apartment: Common + Floor 1..4 BOQs", () => {
  const floorSpec = (n: number) => specFromEvaluation(parseChatGptEvaluation(JSON.stringify({
    project_type: "Residential", archetype: "Apartment", floor: n,
    boq_allocation: `Floor ${n}`, floor_scope: `Floor ${n} private apartment`,
    spaces: [{ name: "Bathroom", qty: 2 }, { name: "Bedroom", qty: 2 }, { name: "Kitchen", qty: 1 }],
    requirements: [{ allocation: `Floor ${n}`, requirement: "WC", qty: 2, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" }],
    confidence: {}, confirmations: [],
  })));

  it("no private floor BOQ contains substructure, structure, site, building or common work", () => {
    for (const n of [1, 2, 3, 4]) {
      const lines = generateForDiscipline("civil", floorSpec(n), { area_sqft: 1500, floors: 4 });
      const templateScopes = new Set(lines.filter((l) => !l.drawing).map((l) => l.scope));
      expect([...templateScopes]).toEqual(["unit"]);   // only unit-level template work
      expect(lines.some((l) => /excavation|\bRCC M|reinforcement steel|underground water sump|water pump|overhead water|compound wall|passenger lift/i.test(l.label) && l.included !== false)).toBe(false);
    }
  });

  it("the Common/Shared BOQ is the one that owns site/substructure/building/common", () => {
    const common = alloc("Common Area");
    expect(scopes(common)).toContain("substructure");
    expect(scopes(common)).toContain("building");
    expect(scopes(common)).toContain("common");
    // and the private floor never does
    expect(scopes(alloc("Floor 1", "private apartment"))).not.toContain("substructure");
  });
});

// ---- Case B: single-floor villa -------------------------------------------
describe("Case B — single-floor villa needs no separate floor/common BOQs", () => {
  const villa = specFromEvaluation(parseChatGptEvaluation(JSON.stringify({
    project_type: "Residential", archetype: "Villa", floor: 1,
    // a villa is one BOQ — no per-floor / common split, so no allocation is set
    spaces: [{ name: "Bathroom", qty: 3 }, { name: "Bedroom", qty: 3 }, { name: "Kitchen", qty: 1 }],
    requirements: [{ allocation: "", requirement: "WC", qty: 3, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" }],
    confidence: {}, confirmations: [],
  })));

  it("is a whole-project BOQ that legitimately owns structure + substructure + site", () => {
    expect(isWholeProjectBoq(villa)).toBe(true);
    const lines = generateForDiscipline("civil", villa, { area_sqft: 2500, floors: 1 });
    expect(lines.some((l) => l.scope === "substructure")).toBe(true);   // excavation/PCC present
    expect(lines.some((l) => l.scope === "structure")).toBe(true);      // RCC present
    expect(lines.some((l) => l.scope === "unit")).toBe(true);           // fit-out present
  });
});

// ---- Case C: multi-building project ----------------------------------------
describe("Case C — building-specific drawing items do not leak between buildings", () => {
  it("a Block B drawing requirement never enters a Block A BOQ", () => {
    const e = parseChatGptEvaluation(JSON.stringify({
      project_type: "Residential", archetype: "Apartment",
      boq_allocation: "Block A", floor_scope: "Block A private apartment",
      requirements: [
        { allocation: "Block A", requirement: "WC", qty: 3, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" },
        { allocation: "Block B", requirement: "Block B lobby feature wall", qty: 1, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" },
      ],
      confidence: {}, confirmations: [],
    }));
    const spec = specFromEvaluation(e);
    const items = ((spec as Record<string, unknown>)._drawing as { items: { match: string }[] }).items;
    expect(items.some((i) => i.match === "WC")).toBe(true);
    expect(items.some((i) => /Block B/.test(i.match))).toBe(false);   // other building excluded
    expect(itemBelongsToBoq("Block B", "Block A")).toBe(false);
  });
});

// ---- Case D: common item drawn on a private-floor drawing ------------------
describe("Case D — a common item on a private-floor drawing does not override allocation", () => {
  it("a lift shown on the Floor 1 drawing is identified but kept out of the Floor 1 BOQ", () => {
    const e = parseChatGptEvaluation(JSON.stringify({
      project_type: "Residential", archetype: "Apartment", floor: 1,
      boq_allocation: "Floor 1", floor_scope: "First Floor / Floor 1 private apartment",
      requirements: [
        { allocation: "Floor 1", requirement: "WC", qty: 3, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" },
        { allocation: "Common Area", requirement: "Passenger lift", qty: 1, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" },
      ],
      confidence: {}, confirmations: [],
    }));
    // The drawing DID establish the lift exists (it is in the evaluation)…
    expect(e.requirements.some((r) => r.match === "Passenger lift")).toBe(true);
    // …but allocation keeps it out of the Floor 1 BOQ.
    const spec = specFromEvaluation(e);
    const items = ((spec as Record<string, unknown>)._drawing as { items: { match: string }[] }).items;
    expect(items.some((i) => i.match === "Passenger lift")).toBe(false);
    const lines = generateForDiscipline("civil", spec, { area_sqft: 1500, floors: 4 });
    expect(lines.some((l) => /lift/i.test(l.label))).toBe(false);
  });
});

// ---- Case E: eligible item that cannot be quantified → pending -------------
describe("Case E — an eligible-but-unquantifiable item stays visible as pending", () => {
  const spec = specFromEvaluation(parseChatGptEvaluation(JSON.stringify({
    project_type: "Residential", archetype: "Apartment", floor: 1,
    boq_allocation: "Floor 1", floor_scope: "First Floor / Floor 1 private apartment",
    spaces: [{ name: "Bedroom", qty: 3 }, { name: "Bathroom", qty: 2 }, { name: "Kitchen", qty: 1 }],
    requirements: [
      { allocation: "Floor 1", requirement: "Flooring", qty: null, unit: null, basis: "Not assessable", scope: "Works", status: "Identified — Needs detail" },
      { allocation: "Floor 1", requirement: "Electrical points", qty: null, unit: null, basis: "Not assessable", scope: "Works", status: "Identified — Needs detail" },
    ],
    confidence: {}, confirmations: [],
  })));

  it("preserves the pending items (qty null) in the drawing scope, never priced or zeroed", () => {
    const items = ((spec as Record<string, unknown>)._drawing as { items: { match: string; qty: number | null; pending?: boolean }[] }).items;
    const flooring = items.find((i) => i.match === "Flooring");
    expect(flooring?.qty).toBeNull();
    expect(flooring?.pending).toBe(true);
    // generation prices none of them (no invented quantity)
    const lines = generateForDiscipline("civil", spec, { area_sqft: 1500, floors: 4 });
    expect(lines.some((l) => l.label === "Flooring" && l.included !== false)).toBe(false);
    expect(lines.some((l) => l.label === "Electrical points" && l.included !== false)).toBe(false);
  });

  it("suppresses the generic template quantity for a category the drawing left pending", () => {
    const lines = generateForDiscipline("civil", spec, { area_sqft: 1500, floors: 4 });
    // the generic flooring / interior-paint template lines must not stand in for
    // the pending drawing scope — they are superseded, not priced.
    const genericFlooring = lines.find((l) => /flooring|anti-?skid ceramic/i.test(l.label) && !l.drawing);
    expect(genericFlooring?.included).toBe(false);
    const genericPoints = lines.find((l) => /concealed electrical wiring/i.test(l.label));
    expect(genericPoints?.included).toBe(false);
  });
});

// ---- Case F: drawing quantity differs from the catalogue -------------------
describe("Case F — drawing quantity overrides the generic catalogue quantity", () => {
  it("the drawing count wins over the template's room-count estimate", () => {
    const spec = specFromEvaluation(parseChatGptEvaluation(JSON.stringify({
      project_type: "Residential", archetype: "Apartment", floor: 1,
      boq_allocation: "Floor 1", floor_scope: "First Floor / Floor 1 private apartment",
      spaces: [{ name: "Bathroom", qty: 2 }],
      requirements: [
        { allocation: "Floor 1", requirement: "European WC", qty: 5, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" },
      ],
      confidence: {}, confirmations: [],
    })));
    const lines = generateForDiscipline("civil", spec, { area_sqft: 1500, floors: 4 });
    const wc = lines.find((l) => /\bWC\b/i.test(l.label) && l.included !== false);
    expect(wc?.qty).toBe(5);                       // drawing 5, not the 2-bath template estimate
    expect(wc?.basis).toBe("DRAWING_INPUT");
  });
});

// ---- Regression guardrails --------------------------------------------------
describe("Regression — existing behaviour preserved under the allocation model", () => {
  it("whole-project BOQ still inherits site/building infrastructure", () => {
    const lines = generateForDiscipline("plumbing", defaultSpec({ bathrooms: 2 }), { area_sqft: 1500, floors: 2 });
    expect(lines.some((l) => /underground water sump/i.test(l.label))).toBe(true);
    expect(lines.some((l) => /water pump/i.test(l.label))).toBe(true);
  });
  it("private-floor BOQ still generates a real fit-out BOQ (not stripped empty)", () => {
    const spec = specFromEvaluation(parseChatGptEvaluation(JSON.stringify({
      project_type: "Residential", archetype: "Apartment", floor: 1,
      boq_allocation: "Floor 1", floor_scope: "First Floor / Floor 1 private apartment",
      spaces: [{ name: "Bathroom", qty: 3 }, { name: "Bedroom", qty: 3 }, { name: "Kitchen", qty: 1 }],
      requirements: [], confidence: {}, confirmations: [],
    })));
    const lines = generateForDiscipline("civil", spec, { area_sqft: 1500, floors: 4 });
    const priced = lines.filter((l) => l.included !== false);
    expect(priced.length).toBeGreaterThan(4);                      // doors, windows, tiling, plumbing…
    expect(priced.every((l) => (l.scope ?? "unit") === "unit")).toBe(true);
  });
  it("the scope classifier tags the leak-prone infrastructure as non-unit", () => {
    const villa = generateForDiscipline("civil", defaultSpec(), { area_sqft: 2000, floors: 1 });
    const byLabel = (re: RegExp): BoqScope | undefined => villa.find((l) => re.test(l.label))?.scope;
    expect(byLabel(/excavation/i)).toBe("substructure");
    expect(byLabel(/rcc/i)).toBe("structure");
    expect(byLabel(/external plaster/i)).toBe("building");
  });
});

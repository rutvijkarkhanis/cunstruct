import { describe, it, expect } from "vitest";
import { boqScopeTier, lineScopeTier, withoutOutOfScopeInfra } from "./boqScope";
import { generateForDiscipline } from "./disciplines";
import { parseChatGptEvaluation, specFromEvaluation } from "./chatgptEval";
import { defaultSpec, type Spec } from "./boqSpec";
import type { GeneratedLine } from "./boqDsrGenerate";

// Scope leakage: generic site/building water infrastructure (underground sump,
// pressure pump, overhead tank) must NOT be auto-inherited into a BOQ scoped to a
// single private-apartment floor merely because the template toggle defaults on.
// It may appear ONLY when the drawing/evaluation explicitly supports it, or when
// the BOQ is a whole-project BOQ (no allocation). Structural / finishing lines and
// drawing-derived lines are never withheld; no quantity is fabricated.

const SUMP = /underground water sump/i;
const PUMP = /water pump|pressure pump/i;
const OHT = /overhead water/i;

describe("boqScopeTier", () => {
  it("no allocation / no floor scope → site (whole project, keep everything)", () => {
    expect(boqScopeTier(defaultSpec())).toBe("site");
  });
  it("private-apartment floor scope → unit", () => {
    expect(boqScopeTier({ _boq_allocation: "Floor 1", _floor_scope: "First Floor / Floor 1 private apartment" } as Spec)).toBe("unit");
  });
  it("a bare numbered-floor allocation → floor", () => {
    expect(boqScopeTier({ _boq_allocation: "Floor 2" } as Spec)).toBe("floor");
  });
  it("common-area allocation → building", () => {
    expect(boqScopeTier({ _boq_allocation: "Common Area" } as Spec)).toBe("building");
  });
});

describe("lineScopeTier — infrastructure classification", () => {
  it("classifies the broader-scope infrastructure by tier", () => {
    expect(lineScopeTier("Underground water sump with fittings")).toBe("site");
    expect(lineScopeTier("Water pump / pressure pump set")).toBe("site");
    expect(lineScopeTier("Overhead water storage tank with fittings")).toBe("building");
  });
  it("leaves ordinary private-unit / structural work as unit (kept everywhere)", () => {
    expect(lineScopeTier("RCC M25 in slabs")).toBe("unit");
    expect(lineScopeTier("TMT reinforcement steel")).toBe("unit");
    expect(lineScopeTier("European WC with seat & cistern, complete")).toBe("unit");
    expect(lineScopeTier("Geyser / water heater with points & connections")).toBe("unit");
    // 'aggregate' must not be mistaken for a 'gate'
    expect(lineScopeTier("Coarse aggregate for concrete")).toBe("unit");
  });
});

describe("withoutOutOfScopeInfra", () => {
  const lines: GeneratedLine[] = [
    { section: "RCC", code: "5.3", qty: 40, label: "RCC M25 in slabs", unit: "cum" },
    { section: "Water Supply", code: null, qty: 1, label: "Underground water sump with fittings", unit: "nos", ns: true },
    { section: "Water Supply", code: null, qty: 1, label: "Water pump / pressure pump set", unit: "nos", ns: true },
    { section: "Water Supply", code: null, qty: 1, label: "Overhead water storage tank with fittings", unit: "nos", ns: true },
  ];

  it("keeps everything for a whole-project (site) BOQ", () => {
    const out = withoutOutOfScopeInfra(lines, defaultSpec());
    expect(out).toHaveLength(4);
  });

  it("withholds site + building infrastructure from a private-apartment floor BOQ", () => {
    const spec = { _boq_allocation: "Floor 1", _floor_scope: "First Floor / Floor 1 private apartment" } as Spec;
    const out = withoutOutOfScopeInfra(lines, spec);
    expect(out.some((l) => SUMP.test(l.label))).toBe(false);
    expect(out.some((l) => PUMP.test(l.label))).toBe(false);
    expect(out.some((l) => OHT.test(l.label))).toBe(false);
    // the legitimate structural line is preserved
    expect(out.some((l) => /RCC M25/.test(l.label))).toBe(true);
  });

  it("keeps infrastructure the drawing explicitly supports", () => {
    const spec = {
      _boq_allocation: "Floor 1", _floor_scope: "First Floor / Floor 1 private apartment",
      _drawing: { items: [{ match: "Underground sump", qty: 1, unit: "nos", basis: "Counted" }] },
    } as unknown as Spec;
    const out = withoutOutOfScopeInfra(lines, spec);
    expect(out.some((l) => SUMP.test(l.label))).toBe(true);   // drawing supports the sump → kept
    expect(out.some((l) => PUMP.test(l.label))).toBe(false);  // pump not in the drawing → still withheld
  });

  it("never fabricates or mutates a quantity — pure filter", () => {
    const spec = { _boq_allocation: "Floor 1", _floor_scope: "private apartment" } as Spec;
    const out = withoutOutOfScopeInfra(lines, spec);
    const rcc = out.find((l) => /RCC M25/.test(l.label));
    expect(rcc?.qty).toBe(40);   // untouched
  });
});

describe("no scope leakage into a generated Floor 1 private-apartment BOQ", () => {
  // A Floor 1 private-apartment evaluation with plumbing scope but NO sump/pump/tank.
  function floor1Json(): string {
    return JSON.stringify({
      project_type: "Residential", archetype: "Apartment", floor: 1,
      boq_allocation: "Floor 1", floor_scope: "First Floor / Floor 1 private apartment",
      area: null, area_type: null,
      spaces: [
        { name: "Master Bedroom", qty: 1 }, { name: "Bedroom", qty: 2 },
        { name: "Bathroom", qty: 3 }, { name: "Kitchen", qty: 1 }, { name: "Living", qty: 1 },
      ],
      disciplines: { identified: ["Architectural", "Electrical", "Plumbing"], not_assessable: ["Fire"] },
      measurements: [],
      requirements: [
        { allocation: "Floor 1", requirement: "WC", qty: 3, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" },
        { allocation: "Floor 1", requirement: "Wash basin", qty: 3, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" },
      ],
      category_summary: {}, confidence: { archetype: "High" }, confirmations: [],
    });
  }

  const spec = specFromEvaluation(parseChatGptEvaluation(floor1Json()));

  it("the leak-prone toggles are ON by default (so filtering, not the toggle, is what withholds them)", () => {
    expect(spec.sump).toBe(true);
    expect(spec.pump).toBe(true);
    expect(spec.oht).toBe(true);
  });

  it("civil generation does not emit underground sump / water pump / overhead tank", () => {
    const lines = generateForDiscipline("civil", spec, { area_sqft: 1800, floors: 1 });
    expect(lines.some((l) => SUMP.test(l.label))).toBe(false);
    expect(lines.some((l) => PUMP.test(l.label))).toBe(false);
    expect(lines.some((l) => OHT.test(l.label))).toBe(false);
  });

  it("plumbing generation does not emit underground sump / water pump / overhead tank", () => {
    const lines = generateForDiscipline("plumbing", spec, { area_sqft: 1800, floors: 1 });
    expect(lines.some((l) => SUMP.test(l.label))).toBe(false);
    expect(lines.some((l) => PUMP.test(l.label))).toBe(false);
    expect(lines.some((l) => OHT.test(l.label))).toBe(false);
    // legitimate private-unit plumbing (scheduled WC) is preserved
    expect(lines.some((l) => l.code === "17.2.1")).toBe(true);
  });

  it("still generates a real structural BOQ (structural items not stripped)", () => {
    const lines = generateForDiscipline("civil", spec, { area_sqft: 1800, floors: 1 });
    expect(lines.length).toBeGreaterThan(10);
    expect(lines.some((l) => l.code === "5.3")).toBe(true);   // RCC preserved
  });

  it("keeps sump/pump when the drawing explicitly itemises them (drawing is authoritative)", () => {
    const withSump = specFromEvaluation(parseChatGptEvaluation(JSON.stringify({
      project_type: "Residential", archetype: "Apartment", floor: 1,
      boq_allocation: "Floor 1", floor_scope: "First Floor / Floor 1 private apartment",
      spaces: [{ name: "Bathroom", qty: 3 }],
      requirements: [
        { allocation: "Floor 1", requirement: "Underground sump", qty: 1, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" },
      ],
      confidence: {}, confirmations: [],
    })));
    const lines = generateForDiscipline("plumbing", withSump, { area_sqft: 1800, floors: 1 });
    // the drawing-derived sump survives; the generic template pump is still withheld
    expect(lines.some((l) => /sump/i.test(l.label))).toBe(true);
    expect(lines.some((l) => PUMP.test(l.label))).toBe(false);
  });
});

describe("whole-project BOQ still inherits site infrastructure (no regression)", () => {
  it("a plain archetype/questionnaire BOQ keeps sump/pump/tank", () => {
    const lines = generateForDiscipline("plumbing", defaultSpec({ bathrooms: 2 }), { area_sqft: 1500, floors: 2 });
    expect(lines.some((l) => SUMP.test(l.label))).toBe(true);
    expect(lines.some((l) => PUMP.test(l.label))).toBe(true);
    expect(lines.some((l) => OHT.test(l.label))).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { assessableDisciplines, disciplineOf, disciplineState, withAssessableDisciplines } from "./boqDiscipline";
import { generateForDiscipline } from "./disciplines";
import { parseChatGptEvaluation, specFromEvaluation } from "./chatgptEval";
import { defaultSpec, type Spec } from "./boqSpec";
import type { GeneratedLine } from "./boqDsrGenerate";

// Discipline evidence gate: a discipline generates scope ONLY when it has
// evidence in the supplied drawing set. The existence of a project type (or a
// multi-floor building) must never by itself activate a discipline's generic
// template — no structural drawing means no invented RCC/excavation/masonry.

// A drawing evaluation with architectural + electrical + plumbing evidence, but
// NO structural/civil drawing (the current Srikakulam situation).
function evalJson(opts: { disciplines: string[]; requirements?: unknown[]; allocation?: string; scope?: string }): string {
  return JSON.stringify({
    project_type: "Residential", archetype: "Apartment", floor: 1,
    boq_allocation: opts.allocation ?? "", floor_scope: opts.scope ?? "",
    spaces: [{ name: "Bedroom", qty: 3 }, { name: "Bathroom", qty: 3 }, { name: "Kitchen", qty: 1 }, { name: "Living", qty: 1 }],
    disciplines: { identified: opts.disciplines, not_assessable: [] },
    requirements: opts.requirements ?? [],
    confidence: {}, confirmations: [],
  });
}
const spec = (opts: Parameters<typeof evalJson>[0]) => specFromEvaluation(parseChatGptEvaluation(evalJson(opts)));
const STRUCTURAL = /excavation|pcc|\bRCC\b|reinforcement|shuttering|centering|masonry/i;

describe("disciplineOf — label → engineering discipline", () => {
  it("separates structural (RCC/framing/masonry) from architectural finishes", () => {
    expect(disciplineOf("RCC M-20 (slabs, beams, columns)")).toBe("structural");
    expect(disciplineOf("TMT reinforcement steel")).toBe("structural");
    expect(disciplineOf("230mm brick masonry CM 1:6")).toBe("structural");
    expect(disciplineOf("Excavation in foundation")).toBe("structural");
    expect(disciplineOf("Living/bedroom flooring")).toBe("architectural");
    expect(disciplineOf("Flush door shutters")).toBe("architectural");
    expect(disciplineOf("Feature wall")).toBe("architectural");
  });
  it("reads the MEP disciplines, including bare discipline-category words", () => {
    expect(disciplineOf("Electrical points")).toBe("electrical");
    expect(disciplineOf("MCB distribution board with MCBs/RCCB, complete")).toBe("electrical");
    expect(disciplineOf("European WC (pan, seat, cistern)")).toBe("plumbing");
    expect(disciplineOf("HVAC / AC points")).toBe("hvac");
    expect(disciplineOf("Split air-conditioning units")).toBe("hvac");
    expect(disciplineOf("Fire alarm control panel with hooter")).toBe("fire");
  });
});

describe("assessableDisciplines — evidence from the supplied drawing set", () => {
  it("is null (no gate) for a pure questionnaire/archetype BOQ (no drawing)", () => {
    expect(assessableDisciplines(defaultSpec())).toBeNull();
  });
  it("reflects the drawing's identified disciplines (structural absent → not assessable)", () => {
    const a = assessableDisciplines(spec({ disciplines: ["Architectural", "Electrical", "Plumbing"] }));
    expect([...(a ?? [])].sort()).toEqual(["architectural", "electrical", "plumbing"]);
    expect(a?.has("structural")).toBe(false);
  });
  it("adds a discipline that has an actual drawing item even if not in the identified list", () => {
    const a = assessableDisciplines(spec({
      disciplines: ["Architectural"],
      requirements: [{ allocation: "", requirement: "AC point", qty: 3, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" }],
    }));
    expect(a?.has("electrical")).toBe(true);   // "AC point" → electrical evidence
  });
  it("recognises a structural drawing when one IS supplied (identified Civil)", () => {
    expect(assessableDisciplines(spec({ disciplines: ["Civil", "Architectural"] }))?.has("structural")).toBe(true);
  });
});

// ---- The core rule: no structural drawing → no invented structural scope -----
describe("no structural drawing → structural scope is withheld from the priced BOQ", () => {
  it("withholds excavation / RCC / reinforcement / masonry when no structural evidence", () => {
    // whole-project allocation (owns every layer) so ONLY the discipline gate can
    // remove structural — proving it is evidence, not allocation, doing the work.
    const s = spec({ disciplines: ["Architectural", "Electrical", "Plumbing"] });
    const lines = generateForDiscipline("civil", s, { area_sqft: 2000, floors: 1 });
    expect(lines.some((l) => STRUCTURAL.test(l.label) && l.included !== false)).toBe(false);
    // architectural + plumbing scope is still generated (those disciplines ARE evidenced)
    expect(lines.some((l) => /flooring|plaster|door|window/i.test(l.label))).toBe(true);
    expect(lines.some((l) => /supply pipe|soil pipe|wash basin|WC/i.test(l.label))).toBe(true);
  });

  it("does NOT zero the structural items — they are simply absent, never qty 0", () => {
    const s = spec({ disciplines: ["Architectural", "Electrical", "Plumbing"] });
    const lines = generateForDiscipline("civil", s, { area_sqft: 2000, floors: 1 });
    expect(lines.some((l) => STRUCTURAL.test(l.label))).toBe(false);   // absent, not present-as-zero
  });

  it("incorporates structural scope once a structural drawing IS supplied", () => {
    const s = spec({ disciplines: ["Civil", "Architectural", "Electrical", "Plumbing"] });
    const lines = generateForDiscipline("civil", s, { area_sqft: 2000, floors: 1 });
    expect(lines.some((l) => /\bRCC\b/i.test(l.label))).toBe(true);
    expect(lines.some((l) => /reinforcement/i.test(l.label))).toBe(true);
    expect(lines.some((l) => /excavation/i.test(l.label))).toBe(true);
  });

  it("the project type alone never activates structural (multi-floor building, no structural drawing)", () => {
    const s = spec({ disciplines: ["Architectural"], allocation: "Floor 2", scope: "Floor 2" });  // bare floor owns structure by allocation
    const lines = generateForDiscipline("civil", s, { area_sqft: 2000, floors: 4 });
    // allocation would allow structure, but there is no structural drawing → withheld
    expect(lines.some((l) => STRUCTURAL.test(l.label) && l.included !== false)).toBe(false);
  });
});

// ---- Generalised across every discipline -----------------------------------
describe("the same rule applies to Electrical, Plumbing, HVAC and Fire", () => {
  it("a discipline with no drawing evidence generates an empty (not_assessable) BOQ", () => {
    const s = spec({ disciplines: ["Architectural"] });   // only architectural evidenced
    expect(generateForDiscipline("electrical", s, { area_sqft: 2000, floors: 1 })).toHaveLength(0);
    expect(generateForDiscipline("plumbing", s, { area_sqft: 2000, floors: 1 })).toHaveLength(0);
    expect(generateForDiscipline("hvac", s, { area_sqft: 2000, floors: 1 })).toHaveLength(0);
    expect(generateForDiscipline("fire", s, { area_sqft: 2000, floors: 1 })).toHaveLength(0);
  });
  it("a discipline WITH drawing evidence generates its scope", () => {
    const s = spec({ disciplines: ["Electrical", "Plumbing", "HVAC", "Fire"] });
    expect(generateForDiscipline("electrical", s, { area_sqft: 2000, floors: 1 }).length).toBeGreaterThan(0);
    expect(generateForDiscipline("plumbing", s, { area_sqft: 2000, floors: 1 }).length).toBeGreaterThan(0);
    expect(generateForDiscipline("hvac", s, { area_sqft: 2000, floors: 1 }).length).toBeGreaterThan(0);
    expect(generateForDiscipline("fire", s, { area_sqft: 2000, floors: 1 }).length).toBeGreaterThan(0);
  });
});

// ---- Three distinct states --------------------------------------------------
describe("distinguishes not_assessable vs present vs pending vs not_drawing_driven", () => {
  const s = spec({
    disciplines: ["Architectural", "Plumbing"],
    requirements: [
      { allocation: "", requirement: "WC", qty: 4, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" },       // plumbing present
      { allocation: "", requirement: "HVAC / AC points", qty: null, unit: null, basis: "Not assessable", scope: "Works", status: "Identified — Needs detail" }, // hvac pending
    ],
  });
  it("discipline not supplied → not_assessable", () => {
    expect(disciplineState(s, "structural")).toBe("not_assessable");
    expect(disciplineState(s, "fire")).toBe("not_assessable");
  });
  it("discipline supplied and item quantified → present", () => {
    expect(disciplineState(s, "plumbing")).toBe("present");
  });
  it("discipline supplied but item not measurable → pending", () => {
    expect(disciplineState(s, "hvac")).toBe("pending");   // evidenced only by a qty-null AC point
  });
  it("a pure questionnaire BOQ is not_drawing_driven (gate does not apply)", () => {
    expect(disciplineState(defaultSpec(), "structural")).toBe("not_drawing_driven");
  });
});

// ---- Guardrails -------------------------------------------------------------
describe("regression — the gate only touches drawing-driven BOQs", () => {
  it("a pure questionnaire BOQ still generates every discipline (structure included)", () => {
    const civil = generateForDiscipline("civil", defaultSpec(), { area_sqft: 2000, floors: 1 });
    expect(civil.some((l) => STRUCTURAL.test(l.label))).toBe(true);
    expect(generateForDiscipline("hvac", defaultSpec({ bedrooms: 3, living: 1 }), { area_sqft: 2000, floors: 1 }).length).toBeGreaterThan(0);
  });
  it("withAssessableDisciplines never withholds a drawing-derived line", () => {
    const s = spec({ disciplines: ["Architectural"] });
    const drawingLine: GeneratedLine = { section: "Structure", code: null, qty: 1, label: "RCC slab", unit: "cum", scope: "structure", drawing: { basis: "Counted", scope: "works" } };
    const out = withAssessableDisciplines([drawingLine], s as Spec);
    expect(out).toHaveLength(1);   // drawing evidence itself is never gated out
  });
});

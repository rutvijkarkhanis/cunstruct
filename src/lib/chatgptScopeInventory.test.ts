import { describe, it, expect } from "vitest";
import { buildChatGptPrompt, parseChatGptEvaluation } from "./chatgptEval";
import { applyDrawing, parseDrawingSummary } from "./boqDrawing";

// The project-scope-inventory refinement: ChatGPT must inventory the WHOLE scope
// (architectural / interior / joinery included), retain clearly-identified-but-
// unquantified items as scope ("Identified — Needs detail") instead of dropping
// them, keep fixed joinery as Works and loose items as Equipment, keep dimensions
// and specifications out of the quantity field, and never invent a quantity.

const REQ_HEADER = `## DRAWING-SPECIFIC REQUIREMENTS
Requirement | Qty | Unit | Basis | Location / Note | Scope | Status
--- | --- | --- | --- | --- | --- | ---`;

describe("Scope inventory — identified-but-unquantified items are retained, not dropped", () => {
  it("1. an unquantified feature wall is retained as scope and never priced", () => {
    const e = parseChatGptEvaluation(`${REQ_HEADER}
Feature wall |  |  | Not assessable | Living, behind sofa | Works | Identified — Needs detail`);
    const fw = e.needsDetail.find((d) => /feature wall/i.test(d.match));
    expect(fw).toBeTruthy();
    expect(fw?.qty).toBe(0);                                   // retained, but no invented quantity
    expect(e.requirements.some((r) => /feature wall/i.test(r.match))).toBe(false);
    expect(e.notAssessable).not.toContain("Feature wall");     // NOT dropped into "can't assess"
    // qty 0 → the priced Drawing engine never emits a line for it
    expect(applyDrawing([], { items: e.needsDetail }).length).toBe(0);
  });

  it("2. an entrance feature with a 'Not assessable' basis is still retained (Status wins)", () => {
    const e = parseChatGptEvaluation(`${REQ_HEADER}
Entrance feature |  |  | Not assessable | Entrance / foyer | Works | Identified — Needs detail`);
    const ef = e.needsDetail.find((d) => /entrance feature/i.test(d.match));
    expect(ef).toMatchObject({ qty: 0, note: "Entrance / foyer", equipment: false });
    expect(e.notAssessable).not.toContain("Entrance feature");
  });

  it("3. a wardrobe run identified without a size is retained as Works scope", () => {
    const e = parseChatGptEvaluation(`${REQ_HEADER}
Wardrobe |  |  | Not assessable | Master bedroom | Works | Identified — Needs detail`);
    const w = e.needsDetail.find((d) => /wardrobe/i.test(d.match));
    expect(w).toBeTruthy();
    expect(w?.equipment).toBe(false);                          // fixed joinery = Works, not equipment
    expect(e.requirements.some((r) => /wardrobe/i.test(r.match))).toBe(false);
  });

  it("4. loose client equipment stays equipment (not contractor works)", () => {
    const e = parseChatGptEvaluation(`${REQ_HEADER}
55" TV | 1 | nos | Counted | Living / TV area | Equipment | Quantified
TV unit |  |  | Not assessable | Living / TV area | Works | Identified — Needs detail`);
    expect(e.requirements.find((r) => r.match === '55" TV')?.equipment).toBe(true);
    expect(e.needsDetail.find((d) => /tv unit/i.test(d.match))?.equipment).toBe(false);  // joinery = Works
    const lines = applyDrawing([], { items: e.requirements });
    expect(lines.find((l) => l.label === '55" TV')?.included).toBe(false);               // equipment excluded from total
  });

  it("5. a dimension stays a measurement — it never becomes a requirement quantity", () => {
    const e = parseChatGptEvaluation(`## DRAWING-SPECIFIC MEASUREMENTS
- TV size — 55"
- Switchboard height — 51"
${REQ_HEADER}
TV point | 1 | nos | Counted | Living | Works | Quantified`);
    expect(e.measurements.map((m) => m.label)).toEqual(expect.arrayContaining(["TV size", "Switchboard height"]));
    expect(e.requirements.some((r) => /55"|51"|switchboard height/i.test(r.match))).toBe(false);
    expect(e.requirements.find((r) => /tv point/i.test(r.match))?.qty).toBe(1);
  });

  it("6. a specification (laminate/veneer/16A) stays in the item text, never a quantity", () => {
    const e = parseChatGptEvaluation(`${REQ_HEADER}
16A socket | 6 | nos | Counted | Kitchen — matte laminate finish | Works | Quantified`);
    const s = e.requirements.find((r) => /16A socket/i.test(r.match));
    expect(s?.qty).toBe(6);                     // qty is 6, not 16
    expect(s?.match).toBe("16A socket");        // spec stays in the requirement text
    expect(s?.note).toContain("laminate");      // the finish spec is kept as a note, not a quantity
  });

  it("7. an unclear symbol is Not assessable — never an Assumed quantity", () => {
    const e = parseChatGptEvaluation(`${REQ_HEADER}
Floor trap |  |  | Not assessable | symbols not legible | Works | Not assessable
Ambiguous point | 3 | nos | Not assessable | could be data or power | Works | Not assessable`);
    expect(e.notAssessable).toEqual(expect.arrayContaining(["Floor trap", "Ambiguous point"]));
    // nothing was invented, and no row carries an "Assumed" basis
    expect(e.requirements.length).toBe(0);
    expect([...e.requirements, ...e.needsDetail].some((r) => r.basis === "Assumed")).toBe(false);
    expect(applyDrawing([], { items: e.requirements }).length).toBe(0);
  });

  it("8. the prompt forbids referencing external documents (never instructs consulting them)", () => {
    const p = buildChatGptPrompt();
    expect(p).toMatch(/ONLY use the drawing supplied/i);
    expect(p).toMatch(/Do not reference[^]*architectural schedules/i);
    expect(p).toMatch(/Never ask me to (obtain|check)/i);
    expect(p).not.toMatch(/refer to the (architectural|electrical|plumbing) (schedule|drawing)/i);
  });

  it("9. the location / note is preserved on a needs-detail item", () => {
    const e = parseChatGptEvaluation(`${REQ_HEADER}
Wine rack |  |  | Not assessable | Dining, feature niche | Works | Identified — Needs detail`);
    expect(e.needsDetail.find((d) => /wine rack/i.test(d.match))?.note).toBe("Dining, feature niche");
  });

  it("10a. the existing free-text Drawing Summary parser is unchanged", () => {
    const items = parseDrawingSummary("Living room has 8 6A sockets, 2 16A sockets and one TV point");
    expect(items.find((i) => /6a/i.test(i.match))?.qty).toBe(8);
    expect(items.find((i) => /16a/i.test(i.match))?.qty).toBe(2);
    expect(items.find((i) => /tv/i.test(i.match))?.qty).toBe(1);
  });

  it("loose 'not assessable' prose yields clean item names — no boilerplate/fragments", () => {
    const e = parseChatGptEvaluation(`## DRAWING-SPECIFIC REQUIREMENTS
- Grills — Not assessable from supplied drawing
- Exact loose-furniture procurement scope is not assessable
- Not assessable from supplied drawing.
- Grills — not assessable`);
    expect(e.notAssessable).toContain("Grills");
    expect(e.notAssessable).toContain("Exact loose-furniture procurement scope");   // kept whole, not "Exact loose"
    expect(e.notAssessable).not.toContain("Not assessable from supplied drawing.");  // boilerplate dropped
    expect(e.notAssessable.filter((n) => n === "Grills")).toHaveLength(1);           // de-duplicated
  });

  it("10b. existing BOQ generation from priced requirements is unchanged", () => {
    const e = parseChatGptEvaluation(`${REQ_HEADER}
TV point | 1 | nos | Counted | Living / TV area | Works | Quantified
6A socket | 4 | nos | Counted | Bedroom 1 | Works | Quantified`);
    const lines = applyDrawing([], { items: e.requirements });
    expect(lines.find((l) => l.label === "TV point")).toMatchObject({ qty: 1, ns: true });
    expect(lines.find((l) => l.label === "TV point")?.drawing).toMatchObject({ basis: "Counted", location: "Living / TV area", scope: "works" });
    expect(lines.find((l) => l.label === "6A socket")?.qty).toBe(4);
  });
});

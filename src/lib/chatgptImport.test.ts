import { describe, it, expect } from "vitest";
import { parseChatGptEvaluation, extractJson, specFromEvaluation } from "./chatgptEval";
import type { DrawingSummary } from "./boqDrawing";

// Importer robustness: a VALID structured project-information JSON pasted into the
// ChatGPT evaluation field must be recognised and parsed — as raw JSON, inside a
// ```json fence, with surrounding whitespace or explanatory prose, with Unicode (—),
// with null OR numeric quantities, and even with the raw control characters real
// ChatGPT output puts inside note/value strings (the actual cause of the
// "Couldn't identify structured project information" failure). A clear validation
// error (ok === false) is returned ONLY when the paste is genuinely malformed or has
// none of the structured-project fields.

// A realistic Floor-1 apartment evaluation object (the shape actually pasted).
const FLOOR1 = {
  project_type: "Residential",
  archetype: "Apartment",
  floor: 1,
  boq_allocation: "Floor 1",
  floor_scope: "First Floor / Floor 1 private apartment",
  area: 3960,
  area_type: "built-up",
  spaces: [
    { name: "Master Bedroom", qty: 1 }, { name: "Bedroom", qty: 4 },
    { name: "Bathroom", qty: 4 }, { name: "Kitchen", qty: 1 }, { name: "Living", qty: 1 },
  ],
  disciplines: { identified: ["Architectural", "Electrical", "Plumbing"], not_assessable: ["Fire"] },
  measurements: [{ name: "Room dimension", value: "10'-8\" x 12'-4\"", location: "Master Bedroom" }],
  requirements: [
    { allocation: "Floor 1", requirement: "WC", qty: 5, unit: "nos", basis: "Counted", note: "", scope: "Works", status: "Quantified" },
    { allocation: "Floor 1", requirement: "5A socket points", qty: 18, unit: "nos", basis: "Counted", note: "rating not established", scope: "Works", status: "Identified — Needs detail" },
    { allocation: "Floor 1", requirement: "15A socket points", qty: 25, unit: "nos", basis: "Counted", note: "", scope: "Works", status: "Quantified" },
    { allocation: "Floor 1", requirement: "Switchboards", qty: 14, unit: "nos", basis: "Counted", note: "", scope: "Works", status: "Quantified" },
    { allocation: "Floor 1", requirement: "Ceiling lamp points", qty: 22, unit: "nos", basis: "Counted", note: "", scope: "Works", status: "Quantified" },
    { allocation: "Floor 1", requirement: "Ceiling fan points", qty: 6, unit: "nos", basis: "Counted", note: "", scope: "Works", status: "Quantified" },
    { allocation: "Floor 1", requirement: "Tube light points", qty: 9, unit: "nos", basis: "Counted", note: "", scope: "Works", status: "Quantified" },
    { allocation: "Floor 1", requirement: "Floor points", qty: null, unit: null, basis: "Not assessable", note: "illegible", scope: "Works", status: "Identified — Needs detail" },
  ],
  category_summary: { Electrical: { status: "Identified", items: [] } },
  confidence: { archetype: "High", floor: "High" },
  confirmations: [],
};
const RAW = JSON.stringify(FLOOR1, null, 2);
const qtyOf = (text: string, match: string) => parseChatGptEvaluation(text).requirements.find((r) => r.match === match)?.qty;

describe("importer accepts every real paste shape of a valid structured-project JSON", () => {
  it("raw pretty-printed JSON", () => {
    const e = parseChatGptEvaluation(RAW);
    expect(e.ok).toBe(true);
    expect(e.projectType).toBe("Residential");
    expect(e.requirements.length + e.needsDetail.length).toBe(8);
  });

  it("JSON inside a ```json fence", () => {
    expect(parseChatGptEvaluation("```json\n" + RAW + "\n```").ok).toBe(true);
  });

  it("JSON inside a bare ``` fence (no language tag)", () => {
    expect(parseChatGptEvaluation("```\n" + RAW + "\n```").ok).toBe(true);
  });

  it("JSON with leading/trailing whitespace and newlines", () => {
    expect(parseChatGptEvaluation("\n\n   " + RAW + "   \n\n").ok).toBe(true);
  });

  it("JSON embedded in surrounding explanatory ChatGPT text", () => {
    const e = parseChatGptEvaluation("Sure — here is the structured evaluation:\n\n" + RAW + "\n\nLet me know if you'd like changes!");
    expect(e.ok).toBe(true);
    expect(e.projectType).toBe("Residential");
  });

  it("prose that also contains a stray {brace} before the real object", () => {
    const e = parseChatGptEvaluation("Totals for the panel {SB1, SB2} are below.\n\n" + RAW);
    expect(e.ok).toBe(true);
    expect(e.boqAllocation).toBe("Floor 1");
  });

  it("Unicode em-dash (—) in a status value does not break parsing", () => {
    expect(RAW).toContain("Identified — Needs detail");
    expect(parseChatGptEvaluation(RAW).ok).toBe(true);
  });

  it("RAW control characters (literal newline/tab) inside a note string still parse", () => {
    // real ChatGPT output frequently emits multi-line notes with literal newlines —
    // invalid JSON that used to make the whole object unparseable. This is the bug.
    const withNewline = RAW.replace('"rating not established"', '"rating not established;\n\tlegend incomplete"');
    const e = parseChatGptEvaluation(withNewline);
    expect(e.ok).toBe(true);
    expect(e.requirements.length + e.needsDetail.length).toBe(8);
  });

  it("unescaped inch-mark quotes inside a measurement string still parse", () => {
    const withInch = JSON.stringify(FLOOR1).replace('10\'-8\\" x 12\'-4\\"', '10\'-8" x 12\'-4"');
    expect(parseChatGptEvaluation(withInch).ok).toBe(true);
  });

  it("both an inch-mark quote AND a raw newline in the same paste still parse", () => {
    let text = JSON.stringify(FLOOR1).replace('10\'-8\\" x 12\'-4\\"', '10\'-8" x 12\'-4"');
    text = text.replace('"rating not established"', '"rating not established;\nsee legend"');
    expect(parseChatGptEvaluation(text).ok).toBe(true);
  });
});

describe("importer preserves the structured content faithfully", () => {
  const e = parseChatGptEvaluation(RAW);
  const spec = specFromEvaluation(e);
  const items = ((spec as Record<string, unknown>)._drawing as DrawingSummary).items ?? [];

  it("preserves null qty (Floor points stays pending, not rejected)", () => {
    const fp = items.find((i) => i.match === "Floor points");
    expect(fp?.qty).toBeNull();
    expect(fp?.pending).toBe(true);
  });

  it("preserves numeric qty even when status is 'Identified — Needs detail' (counting fix, no regression)", () => {
    expect(qtyOf(RAW, "5A socket points")).toBe(18);   // spec gap under Needs detail → still counted
  });

  it("preserves every quantified Floor-1 quantity (WC=5, 15A=25, switchboards=14, lamps=22, fans=6, tubes=9)", () => {
    expect(qtyOf(RAW, "WC")).toBe(5);
    expect(qtyOf(RAW, "15A socket points")).toBe(25);
    expect(qtyOf(RAW, "Switchboards")).toBe(14);
    expect(qtyOf(RAW, "Ceiling lamp points")).toBe(22);
    expect(qtyOf(RAW, "Ceiling fan points")).toBe(6);
    expect(qtyOf(RAW, "Tube light points")).toBe(9);
  });

  it("preserves spaces[], measurements[], disciplines, category_summary, confidence, confirmations", () => {
    expect(e.spaces.map((s) => s.name)).toContain("Kitchen");
    expect(e.measurements.find((m) => m.label === "Room dimension")?.value).toContain("10'-8");
    expect(e.disciplines).toEqual(expect.arrayContaining(["Architectural", "Electrical", "Plumbing"]));
    expect(e.keyInfo).toBeDefined();                     // category_summary → key info reminders
    expect(e.confidence.archetype).toBe("High");
    expect(Array.isArray(e.confirmations)).toBe(true);
  });

  it("extracts an object, never an array — and the object carries the eval keys", () => {
    const o = extractJson(RAW);
    expect(o).not.toBeNull();
    expect(Array.isArray(o)).toBe(false);
    expect(o).toHaveProperty("project_type");
    expect(o).toHaveProperty("requirements");
  });

  it("picks the structured-project object out of a top-level ARRAY wrapper", () => {
    // a single JSON array wrapping the object is still recovered as an OBJECT
    const o = extractJson("[" + RAW + "]");
    expect(Array.isArray(o)).toBe(false);
    expect(o).toHaveProperty("project_type");
  });

  it("does NOT mistake a nested fragment (a spaces entry) for the evaluation", () => {
    // if the root ever failed, the old code returned the first nested {name,qty} object;
    // now a fragment without eval keys is skipped in favour of the real object.
    const o = extractJson(RAW);
    expect(o).toHaveProperty("spaces");     // the root, not a single {name, qty}
  });
});

describe("importer returns a validation error ONLY when genuinely malformed / missing fields", () => {
  it("plain prose with no JSON → not ok", () => {
    expect(parseChatGptEvaluation("Here are some thoughts about the drawing, no structured data.").ok).toBe(false);
  });
  it("empty string → not ok", () => {
    expect(parseChatGptEvaluation("").ok).toBe(false);
  });
  it("a JSON object with none of the structured-project keys → not ok", () => {
    expect(parseChatGptEvaluation('{"foo": 1, "bar": [2, 3]}').ok).toBe(false);
  });
  it("a bare JSON array → not ok (an array is not the evaluation object)", () => {
    expect(parseChatGptEvaluation("[1, 2, 3]").ok).toBe(false);
  });
});

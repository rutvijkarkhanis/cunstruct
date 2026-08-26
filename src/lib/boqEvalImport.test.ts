import { describe, it, expect } from "vitest";
import { parseChatGptEvaluation, specFromEvaluation, extractJson } from "./chatgptEval";
import type { DrawingSummary } from "./boqDrawing";

// Importer robustness: the evaluation JSON is generated correctly, but the raw
// pasted text is rarely byte-perfect (trailing commas, // or /* */ comments, smart
// quotes, prose/braces around the object, and — most commonly for this drawing eval
// — an unescaped inch-mark quote inside a dimension string). extractJson must
// normalise all of these into the SAME internal ChatGptEval so the UI stops showing
// "Couldn't identify structured project information". The evaluation data is not
// changed; qty:null is never coerced; Common Area stays out of the Floor 1 BOQ.

// The exact shape the user reported (numeric qty, qty:null, allocation, the three
// scope values and the three status values, Common Area allocation).
const EVAL = {
  project_type: "Residential",
  archetype: "Apartment",
  floor: 1,
  boq_allocation: "Floor 1",
  floor_scope: "First Floor / Floor 1 private apartment",
  area: 3960,
  area_type: "built-up",
  spaces: [{ name: "Master Bedroom", qty: 1 }, { name: "Bathroom", qty: 4 }],
  disciplines: { identified: ["Architectural", "Electrical", "Plumbing"], not_assessable: ["Fire"] },
  measurements: [{ name: "Room dimension", value: "10'-8\" x 12'-4\"", location: "Master Bedroom" }],
  requirements: [
    { allocation: "Floor 1", requirement: "WC", qty: 4, unit: "nos", basis: "Counted", location: "Bathrooms", note: "", scope: "Works", status: "Quantified" },
    { allocation: "Floor 1", requirement: "Wardrobe", qty: null, unit: null, basis: "Not assessable", location: "Master Bedroom", note: "", scope: "Needs confirmation", status: "Identified — Needs detail" },
    { allocation: "Floor 1", requirement: "55\" TV", qty: 1, unit: "nos", basis: "Counted", location: "Living", note: "", scope: "Equipment", status: "Quantified" },
    { allocation: "Floor 1", requirement: "Floor trap", qty: null, unit: null, basis: "Not assessable", location: "unclear", note: "", scope: "Works", status: "Not assessable" },
    { allocation: "Common Area", requirement: "Passenger lift", qty: 2, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" },
  ],
  category_summary: {},
  confidence: { project_type: "High", archetype: "High", floor: "High" },
  confirmations: [],
};
const CLEAN = JSON.stringify(EVAL, null, 2);

describe("evaluation importer accepts the exact reported JSON shape", () => {
  const e = parseChatGptEvaluation(CLEAN);
  it("parses successfully (ok=true) — no 'couldn't identify' rejection", () => {
    expect(e.ok).toBe(true);
    expect(e.projectType).toBe("Residential");
    expect(e.archetype).toBe("Apartment");
    expect(e.floor).toBe(1);
    expect(e.boqAllocation).toBe("Floor 1");
    expect(e.area).toEqual({ value: 3960, type: "built-up", raw: "3960" });
  });
  it("accepts numeric qty and preserves qty:null (never coerced to 0)", () => {
    expect(e.requirements.find((r) => r.match === "WC")?.qty).toBe(4);
    const wardrobe = e.needsDetail.find((r) => r.match === "Wardrobe");
    expect(wardrobe?.qty).toBeNull();
    expect(wardrobe?.pending).toBe(true);
    expect(e.needsDetail.some((r) => r.qty === 0)).toBe(false);
  });
  it("reads the Works / Equipment / Needs-confirmation scope values", () => {
    expect(e.requirements.find((r) => r.match === "WC")?.equipment).toBe(false);      // Works
    expect(e.requirements.find((r) => r.match === '55" TV')?.equipment).toBe(true);   // Equipment
    expect(e.needsDetail.find((r) => r.match === "Wardrobe")?.scope).toBe("needs_confirmation");
  });
  it("reads the Quantified / Identified—Needs detail / Not assessable status values", () => {
    expect(e.requirements.map((r) => r.match)).toContain("WC");            // Quantified → priced-eligible
    expect(e.needsDetail.map((r) => r.match)).toContain("Wardrobe");        // Identified — Needs detail → pending
    expect(e.notAssessable).toContain("Floor trap");                       // Not assessable → recorded, not priced
  });
  it("keeps Common Area out of the Floor 1 BOQ but retains it for audit", () => {
    const spec = specFromEvaluation(e);
    const items = ((spec as Record<string, unknown>)._drawing as DrawingSummary).items ?? [];
    expect(items.some((i) => /passenger lift/i.test(i.match))).toBe(false);
    const excluded = ((spec as Record<string, unknown>)._excluded as DrawingSummary).items ?? [];
    expect(excluded.some((i) => /passenger lift/i.test(i.match))).toBe(true);
  });
});

describe("importer normalises real-world JSON noise into the same evaluation", () => {
  const expectSame = (label: string, text: string) => {
    it(label, () => {
      const e = parseChatGptEvaluation(text);
      expect(e.ok, `${label} should parse ok`).toBe(true);
      expect(e.area?.value).toBe(3960);
      expect(e.requirements.find((r) => r.match === "WC")?.qty).toBe(4);
      expect(e.needsDetail.find((r) => r.match === "Wardrobe")?.qty).toBeNull();   // pending survives
      expect(extractJson(text)).not.toBeNull();
    });
  };
  expectSame("trailing comma", CLEAN.replace('"confirmations": []', '"confirmations": [],'));
  expectSame("prose + ```json fence + stray brace", "Here is the assessment:\n```json\n" + CLEAN + "\n```\nConfirm SB {71}.");
  expectSame("trailing prose containing braces", CLEAN + "\n\nNote: confirm whether {SB1} and {SB2} are separate.");
  expectSame("leading prose containing braces", "Use the values in {curly} braces.\n\n" + CLEAN);
  expectSame("smart quotes", CLEAN.replace(/"Residential"/, "“Residential”"));
  expectSame("unescaped inch marks in a dimension string", CLEAN.replace('"10\'-8\\" x 12\'-4\\""', '"10\'-8" x 12\'-4""'));
  expectSame("// line comment", CLEAN.replace('"area": 3960,', '"area": 3960, // built-up sqft'));
  expectSame("/* block comment */", CLEAN.replace('"requirements":', '/* scope items */ "requirements":'));
});

describe("importer still rejects genuinely unstructured text", () => {
  it("plain prose with no JSON object → ok=false (falls back, not a false positive)", () => {
    expect(parseChatGptEvaluation("Sorry, I couldn't read that drawing image.").ok).toBe(false);
    expect(extractJson("no object here, just text")).toBeNull();
  });
});

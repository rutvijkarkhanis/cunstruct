import { describe, it, expect } from "vitest";
import { parseBoqEvalJson, pendingCount, evalLinesToRows, PENDING_BASIS, extractJson } from "./boqEvalJson";
import * as fs from "node:fs";
import * as path from "node:path";

// The exact contract shape the drawing evaluation produces (numeric qty, qty:null,
// allocation, the three scope values and status values).
const EVAL = {
  project_type: "Residential",
  boq_allocation: "Floor 1",
  requirements: [
    { allocation: "Floor 1", requirement: "WC", qty: 4, unit: "nos", basis: "Counted", location: "Bathrooms", note: "", scope: "Works", status: "Quantified" },
    { allocation: "Floor 1", requirement: "Wardrobe", qty: null, unit: null, basis: "Not assessable", location: "Master Bedroom", note: "run length TBC", scope: "Needs confirmation", status: "Identified — Needs detail" },
    { allocation: "Floor 1", requirement: "55\" TV", qty: 1, unit: "nos", basis: "Counted", location: "Living", note: "", scope: "Equipment", status: "Quantified" },
    { allocation: "Floor 1", requirement: "Vitrified flooring", qty: 78.97, unit: "sqm", basis: "Derived", location: "Living", measurement_method: "derived", calculation: "8.9 x 8.87", scope: "Works", status: "Quantified" },
  ],
};
const CLEAN = JSON.stringify(EVAL, null, 2);

describe("parseBoqEvalJson — 1. valid JSON → BOQ lines", () => {
  it("converts every named requirement into a line", () => {
    const r = parseBoqEvalJson(CLEAN);
    expect(r.ok).toBe(true);
    expect(r.lines).toHaveLength(4);
    expect(r.lines.map((l) => l.description)).toEqual(["WC", "Wardrobe", '55" TV', "Vitrified flooring"]);
  });

  it("accepts a bare requirements array and the `items` alias with `description`", () => {
    const bare = parseBoqEvalJson(JSON.stringify([{ requirement: "WC", qty: 2, unit: "nos" }]));
    expect(bare.ok).toBe(true);
    expect(bare.lines[0]).toMatchObject({ description: "WC", qty: 2, unit: "nos" });
    const items = parseBoqEvalJson(JSON.stringify({ items: [{ description: "RCC columns", quantity: 9.29, unit: "cum" }] }));
    expect(items.ok).toBe(true);
    expect(items.lines[0]).toMatchObject({ description: "RCC columns", qty: 9.29, unit: "cum" });
  });

  it("strips a ```json code fence around the object", () => {
    const r = parseBoqEvalJson("```json\n" + CLEAN + "\n```");
    expect(r.ok).toBe(true);
    expect(r.lines).toHaveLength(4);
  });
});

describe("parseBoqEvalJson — 2. numeric quantities preserved exactly", () => {
  it("keeps integer and decimal quantities verbatim (no rounding)", () => {
    const r = parseBoqEvalJson(CLEAN);
    expect(r.lines.find((l) => l.description === "WC")?.qty).toBe(4);
    expect(r.lines.find((l) => l.description === "Vitrified flooring")?.qty).toBe(78.97);
  });
  it("accepts a numeric string quantity", () => {
    const r = parseBoqEvalJson(JSON.stringify({ requirements: [{ requirement: "Steel", qty: "3530.29", unit: "kg" }] }));
    expect(r.lines[0].qty).toBe(3530.29);
  });
});

describe("parseBoqEvalJson — 3. null quantities become quantity-pending", () => {
  it("keeps qty:null as null (never coerced to 0)", () => {
    const r = parseBoqEvalJson(CLEAN);
    const wardrobe = r.lines.find((l) => l.description === "Wardrobe");
    expect(wardrobe?.qty).toBeNull();
    expect(r.lines.some((l) => l.qty === 0)).toBe(false);
    expect(pendingCount(r.lines)).toBe(1);
  });
  it("an absent qty key is pending, not zero", () => {
    const r = parseBoqEvalJson(JSON.stringify({ requirements: [{ requirement: "Feature wall", unit: "sqft" }] }));
    expect(r.lines[0].qty).toBeNull();
  });
  it("a non-numeric qty is imported as pending with a warning (never fabricated)", () => {
    const r = parseBoqEvalJson(JSON.stringify({ requirements: [{ requirement: "Railing", qty: "TBC", unit: "rft" }] }));
    expect(r.lines[0].qty).toBeNull();
    expect(r.warnings.some((w) => /quantity/i.test(w))).toBe(true);
  });
});

describe("parseBoqEvalJson — 4. notes / measurements / scope / status preserved", () => {
  it("preserves location, note, status and measurement metadata in the note", () => {
    const r = parseBoqEvalJson(CLEAN);
    const flooring = r.lines.find((l) => l.description === "Vitrified flooring");
    expect(flooring?.note).toContain("Living");
    expect(flooring?.note).toContain("calc: 8.9 x 8.87");
    expect(flooring?.measurement_method).toBe("derived");
    const wardrobe = r.lines.find((l) => l.description === "Wardrobe");
    expect(wardrobe?.note).toContain("run length TBC");
    expect(wardrobe?.note).toContain("Identified — Needs detail");
  });
  it("normalises the three scope values and keeps allocation + unit", () => {
    const r = parseBoqEvalJson(CLEAN);
    expect(r.lines.find((l) => l.description === "WC")?.scope).toBe("works");
    expect(r.lines.find((l) => l.description === '55" TV')?.scope).toBe("equipment");
    expect(r.lines.find((l) => l.description === "Wardrobe")?.scope).toBe("needs_confirmation");
    expect(r.lines.find((l) => l.description === "WC")?.allocation).toBe("Floor 1");
    expect(r.lines.find((l) => l.description === "WC")?.basis).toBe("Counted");
  });
});

describe("parseBoqEvalJson — 5. invalid JSON / schema rejected", () => {
  it("rejects malformed JSON with an error and imports nothing", () => {
    const r = parseBoqEvalJson('{ "requirements": [ { "requirement": "WC", qty: 4 } ] }'); // unquoted key
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/invalid json/i);
    expect(r.lines).toHaveLength(0);
  });
  it("rejects JSON with no requirements/items array (schema error)", () => {
    const r = parseBoqEvalJson(JSON.stringify({ project_type: "Residential", spaces: [] }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/schema/i);
  });
  it("rejects an empty requirements array", () => {
    const r = parseBoqEvalJson(JSON.stringify({ requirements: [] }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/empty/i);
  });
  it("rejects empty input", () => {
    expect(parseBoqEvalJson("").ok).toBe(false);
    expect(parseBoqEvalJson("   ").ok).toBe(false);
  });
  it("skips a requirement with no name but keeps the rest", () => {
    const r = parseBoqEvalJson(JSON.stringify({ requirements: [{ qty: 4, unit: "nos" }, { requirement: "WC", qty: 2 }] }));
    expect(r.ok).toBe(true);
    expect(r.lines).toHaveLength(1);
    expect(r.warnings.some((w) => /no requirement/i.test(w))).toBe(true);
  });
});

describe("robust extraction of pasted ChatGPT output", () => {
  const names = (text: string) => parseBoqEvalJson(text).lines.map((l) => l.description);
  const EXPECTED = ["WC", "Wardrobe", '55" TV', "Vitrified flooring"];

  it("accepts raw JSON", () => {
    const r = parseBoqEvalJson(CLEAN);
    expect(r.ok).toBe(true);
    expect(names(CLEAN)).toEqual(EXPECTED);
  });

  it("accepts JSON inside a ```json fence (with surrounding prose)", () => {
    const text = "Here is the evaluation you asked for:\n\n```json\n" + CLEAN + "\n```\n\nLet me know if you need changes.";
    const r = parseBoqEvalJson(text);
    expect(r.ok).toBe(true);
    expect(names(text)).toEqual(EXPECTED);
  });

  it("accepts JSON inside a bare ``` fence", () => {
    const text = "```\n" + CLEAN + "\n```";
    expect(parseBoqEvalJson(text).ok).toBe(true);
  });

  it("accepts leading/trailing whitespace and blank lines", () => {
    const text = "\n\n   \n" + CLEAN + "\n\n   \t\n";
    expect(parseBoqEvalJson(text).ok).toBe(true);
    expect(names(text)).toEqual(EXPECTED);
  });

  it("extracts a JSON object surrounded by explanatory prose (leading and trailing)", () => {
    const text = "Sure! Based on the drawing, here is the BOQ scope inventory. " + CLEAN + " Please confirm the wardrobe run length before pricing.";
    const r = parseBoqEvalJson(text);
    expect(r.ok).toBe(true);
    expect(names(text)).toEqual(EXPECTED);
  });

  it("extracts the JSON even when the prose contains stray braces", () => {
    const text = "Confirm switchboard {SB1} and {SB2}.\n\n" + CLEAN + "\n\nNote: verify {panel} location.";
    const r = parseBoqEvalJson(text);
    expect(r.ok).toBe(true);
    expect(names(text)).toEqual(EXPECTED);
  });

  it("still rejects genuinely invalid JSON (malformed object)", () => {
    const r = parseBoqEvalJson('{ "requirements": [ { "requirement": "WC", qty: 4 } ] }'); // unquoted key
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/invalid json/i);
    expect(r.lines).toHaveLength(0);
  });

  it("still rejects prose with no JSON at all", () => {
    const r = parseBoqEvalJson("I couldn't read the drawing clearly, please re-send it.");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/invalid json/i);
  });

  it("extractJson: same parsed value from raw, fenced, and prose-wrapped forms", () => {
    const raw = extractJson(CLEAN);
    expect(extractJson("```json\n" + CLEAN + "\n```")).toEqual(raw);
    expect(extractJson("intro text " + CLEAN + " outro text")).toEqual(raw);
    expect(extractJson("   " + CLEAN + "   ")).toEqual(raw);
    expect(extractJson("no json here")).toBeUndefined();
    expect(extractJson("")).toBeUndefined();
  });
});

describe("evalLinesToRows — deterministic mapping to boq_line rows", () => {
  const rows = evalLinesToRows("boq-1", parseBoqEvalJson(CLEAN).lines);
  it("preserves a numeric qty and its basis, marks the line as works/manual", () => {
    const wc = rows.find((r) => r.description === "WC")!;
    expect(wc).toMatchObject({ boq_id: "boq-1", qty: 4, unit: "nos", basis: "Counted", included: true, source: "manual", dsr_code: null });
  });
  it("stores a pending line as qty 0 with basis PENDING (count never fabricated)", () => {
    const wardrobe = rows.find((r) => r.description === "Wardrobe")!;
    expect(wardrobe.qty).toBe(0);
    expect(wardrobe.basis).toBe(PENDING_BASIS);
    expect(wardrobe.basis_note).toContain("run length TBC");
  });
  it("adds client equipment but leaves it out of the priced total (included:false)", () => {
    const tv = rows.find((r) => r.description === '55" TV')!;
    expect(tv.included).toBe(false);
    expect(tv.basis_note).toContain("Client equipment");
  });
  it("uses allocation as the sub-head and numbers sort from the given offset", () => {
    expect(rows.every((r) => r.section === "Floor 1")).toBe(true);
    expect(evalLinesToRows("b", parseBoqEvalJson(CLEAN).lines, 10)[0].sort).toBe(10);
  });
});

describe("parseBoqEvalJson — 6. no AI / network / API dependency", () => {
  it("the module source imports nothing and calls no network/AI API", () => {
    const src = fs.readFileSync(path.join(__dirname, "boqEvalJson.ts"), "utf8");
    // Strip comments so explanatory text (which may mention external tools) is not
    // mistaken for a dependency — we are checking the CODE, not the prose.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    // No imports and no require() — the module is self-contained.
    expect(/^\s*import\s|\brequire\s*\(/m.test(code)).toBe(false);
    // No network or client calls of any kind.
    expect(/\bfetch\s*\(|XMLHttpRequest|\baxios\b|\.(get|post|put|patch)\s*\(/i.test(code)).toBe(false);
    expect(/\bopenai\b|\banthropic\b|\bsupabase\b/i.test(code)).toBe(false);
  });
  it("is a pure function — same input yields the same output, no side effects", () => {
    const a = parseBoqEvalJson(CLEAN);
    const b = parseBoqEvalJson(CLEAN);
    expect(a).toEqual(b);
  });
});

// Proves parseAnalysisV1()'s calculationDataDroppedCount — the exact field
// the ai-analysis "generate" response's calculationDataDroppedCount comes
// from — is computed via an EXPLICIT, machine-readable classification set
// directly at the point a calculation_data claim is dropped (see
// analysisSchemaV1.ts's parseCalculationData / CalculationDataParseResult),
// never by scanning warning text for a substring.
//
// The earlier implementation computed this count as
// `warnings.filter((w) => w.includes("calculation_data")).length` — fragile,
// because any unrelated warning whose text happens to contain that literal
// substring (e.g. one driven by an attacker/user-controlled item NAME, not
// by calculation_data at all) would silently inflate the count. This file's
// "false positive under substring matching" tests construct exactly that
// scenario and prove the real count is unaffected by it.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { parseAnalysisV1 } from "./analysisSchemaV1";

describe("parseAnalysisV1().calculationDataDroppedCount — explicit classification, not text-scanning", () => {
  it("a single malformed calculation_data increments the count by exactly 1", () => {
    const parsed = parseAnalysisV1(JSON.stringify({ items: [
      { item: "W1", quantity: 18, unit: "sqm", calculation_data: { formula: "NOT_A_REAL_FORMULA", inputs: [] } },
    ] }));
    expect(parsed.ok).toBe(true);
    expect(parsed.calculationDataDroppedCount).toBe(1);
  });

  it("missing calculation_data does not increment the count", () => {
    const parsed = parseAnalysisV1(JSON.stringify({ items: [{ item: "Plain", quantity: 1, unit: "nos" }] }));
    expect(parsed.ok).toBe(true);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.calculationDataDroppedCount).toBe(0);
  });

  it("an explicit null calculation_data (the common, schema-conformant case) does not increment the count", () => {
    const parsed = parseAnalysisV1(JSON.stringify({ items: [
      { item: "Plain", quantity: 1, unit: "nos", calculation_data: null },
    ] }));
    expect(parsed.calculationDataDroppedCount).toBe(0);
  });

  it("multiple dropped calculation-data fields, across different items and different malformations, aggregate correctly", () => {
    const parsed = parseAnalysisV1(JSON.stringify({ items: [
      { item: "W1", quantity: 18, unit: "sqm", calculation_data: { formula: "NOT_A_REAL_FORMULA", inputs: [] } },
      { item: "W2", quantity: 12, unit: "sqm", calculation_data: { formula: "UNIT_CONVERSION", inputs: "not an array" } },
      { item: "W3", quantity: 3, unit: "nos" }, // no calculation_data at all — must not be counted
      { item: "W4", quantity: 7, unit: "sqm", calculation_data: { formula: "UNIT_CONVERSION", inputs: [{ name: "x", value: 1 }] } },
    ] }));
    expect(parsed.ok).toBe(true);
    expect(parsed.calculationDataDroppedCount).toBe(3);
  });

  it("unrelated analysis warnings (non-numeric quantity, percent confidence, conflicting candidates) do not increment the count", () => {
    const parsed = parseAnalysisV1(JSON.stringify({ items: [
      { item: "A", quantity: "lots" }, // non-numeric quantity warning
      { item: "B", quantity: 1, unit: "nos", confidence: 94 }, // percent-confidence warning
      { item: "C", quantity: 5, status: "MEASURED", candidates: [{ value: 1, basis: "x" }, { value: 2, basis: "y" }] }, // conflicting-candidates warning
      { item: "D", quantity: 18, unit: "sqm", calculation_data: { formula: "NOT_A_REAL_FORMULA", inputs: [] } }, // the one real problem
    ] }));
    expect(parsed.ok).toBe(true);
    expect(parsed.warnings.length).toBeGreaterThan(1); // sanity: unrelated warnings genuinely exist here
    expect(parsed.calculationDataDroppedCount).toBe(1);
  });

  // ── The actual regression: proves the OLD substring-matching approach was
  // wrong, using a scenario the new explicit classification is immune to. ──
  describe("false positive under the old substring-matching approach — the new mechanism is immune", () => {
    it("an item NAMED with the literal text 'calculation_data', with an unrelated warning and NO real calculation_data field, does not increment the count", () => {
      // This item has no `calculation_data` field at all. Its chosen NAME
      // (fully attacker/user-controlled, already part of the existing
      // contract) happens to contain the literal substring "calculation_data",
      // and it also triggers an unrelated, legitimate warning (non-numeric
      // quantity) whose text embeds that name verbatim — exactly the kind of
      // warning `warnings.filter(w => w.includes("calculation_data"))` would
      // have falsely counted.
      const parsed = parseAnalysisV1(JSON.stringify({
        items: [{ item: "Window referencing calculation_data in its own label", quantity: "not a number" }],
      }));
      expect(parsed.ok).toBe(true);
      // Confirm the adversarial premise: a warning mentioning the literal
      // substring really was produced, purely from the item's own name.
      expect(parsed.warnings.some((w) => w.includes("calculation_data"))).toBe(true);
      // The OLD implementation would have returned 1 here. The real,
      // explicit classification correctly returns 0 — no calculation_data
      // field was ever present on this item, so nothing was dropped.
      expect(parsed.calculationDataDroppedCount).toBe(0);
    });

    it("multiple such adversarial unrelated warnings, plus one real drop, still count only the real drop", () => {
      const parsed = parseAnalysisV1(JSON.stringify({
        items: [
          { item: "calculation_data mention one", quantity: "oops" },
          { item: "calculation_data mention two", confidence: 94, quantity: 1, unit: "nos" },
          { item: "Real drop", quantity: 18, unit: "sqm", calculation_data: { formula: "NOT_A_REAL_FORMULA", inputs: [] } },
        ],
      }));
      expect(parsed.ok).toBe(true);
      const adversarialMatches = parsed.warnings.filter((w) => w.includes("calculation_data")).length;
      // Confirm the OLD approach would have over-counted: 3 warnings contain
      // the substring (2 adversarial + 1 real), but only 1 is a real drop.
      expect(adversarialMatches).toBeGreaterThan(1);
      expect(parsed.calculationDataDroppedCount).toBe(1);
    });
  });

  it("the count is independent of warning wording, item labels, and punctuation — only the drop event itself matters", () => {
    const withUnusualPunctuation = parseAnalysisV1(JSON.stringify({ items: [
      { item: `W1 — "quoted" & punctuated!`, quantity: 18, unit: "sqm", calculation_data: { formula: "NOT_A_REAL_FORMULA", inputs: [] } },
    ] }));
    expect(withUnusualPunctuation.calculationDataDroppedCount).toBe(1);
  });

  it("does not mutate the parsed warnings array merely by computing the count", () => {
    const parsed = parseAnalysisV1(JSON.stringify({ items: [
      { item: "W1", quantity: 18, unit: "sqm", calculation_data: { formula: "NOT_A_REAL_FORMULA", inputs: [] } },
    ] }));
    const snapshot = [...parsed.warnings];
    expect(parsed.calculationDataDroppedCount).toBe(1); // already computed above; re-reading changes nothing
    expect(parsed.warnings).toEqual(snapshot);
  });
});

describe("ai-analysis/index.ts — the generate response reads the explicit count directly, never by scanning warning text", () => {
  const src = readFileSync(path.resolve(process.cwd(), "supabase/functions/ai-analysis/index.ts"), "utf8");

  it("reads parsedAnalysis.calculationDataDroppedCount directly — no .filter(/.includes(\"calculation_data\") text-scanning anywhere in the file", () => {
    expect(src).toMatch(/calculationDataDroppedCount\s*=\s*parsedAnalysis\.calculationDataDroppedCount/);
    expect(src).not.toMatch(/includes\(\s*["']calculation_data["']\s*\)/);
  });

  it("no longer imports the removed calculationDataDiagnostics module", () => {
    expect(src).not.toMatch(/calculationDataDiagnostics/);
  });

  it("parsedAnalysis.warnings (the BOQ-generate parser's warnings) is never referenced in the file — the count comes from the parser's own field, not from warnings at all", () => {
    expect(src).not.toMatch(/parsedAnalysis\.warnings/);
  });

  it("the generate response never returns a raw warnings array or the full parsedAnalysis object", () => {
    // The only `warnings:` key anywhere in the file belongs to the separate,
    // pre-existing Click-to-Identify action's own (unrelated) response —
    // never the BOQ generate response this task touches.
    const warningsKeyLines = src.split("\n").filter((l) => /\bwarnings\s*:/.test(l));
    expect(warningsKeyLines).toHaveLength(1);
    expect(warningsKeyLines[0]).toMatch(/parsedIdentify\.warnings/);
  });
});

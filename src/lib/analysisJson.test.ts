import { describe, it, expect } from "vitest";
import {
  parseAnalysisJson,
  normalizeMethod,
  normalizeStatus,
  unitMatchesMethod,
  analysisPendingCount,
} from "./analysisJson";

describe("normalizeMethod / normalizeStatus", () => {
  it("accepts canonical values and common aliases", () => {
    expect(normalizeMethod("AREA")).toBe("AREA");
    expect(normalizeMethod("sqft")).toBe("AREA");
    expect(normalizeMethod("running length")).toBe("LENGTH");
    expect(normalizeMethod("cum")).toBe("VOLUME");
    expect(normalizeMethod("kg")).toBe("WEIGHT");
    expect(normalizeMethod("counted")).toBe("COUNT");
    expect(normalizeMethod("nonsense")).toBeNull();
  });
  it("maps status text to the canonical status", () => {
    expect(normalizeStatus("Measured")).toBe("MEASURED");
    expect(normalizeStatus("quantity pending")).toBe("PENDING");
    expect(normalizeStatus("N/A")).toBe("NOT_APPLICABLE");
    expect(normalizeStatus("estimated")).toBe("ESTIMATED");
  });
});

describe("unitMatchesMethod", () => {
  it("flags an incompatible unit but passes a blank unit", () => {
    expect(unitMatchesMethod("nos", "COUNT")).toBe(true);
    expect(unitMatchesMethod("sqft", "AREA")).toBe(true);
    expect(unitMatchesMethod("kg", "AREA")).toBe(false);
    expect(unitMatchesMethod("", "AREA")).toBe(true);
    expect(unitMatchesMethod("bag", "COVERAGE")).toBe(true); // coverage isn't policed
  });
});

describe("parseAnalysisJson — valid input", () => {
  it("parses items, project type, methodology and status", () => {
    const json = JSON.stringify({
      project: { project_type: "Residential" },
      items: [
        { scope: "Finishes", category: "Flooring", item: "Floor finish", location: "First Floor", quantity: 1200, unit: "sqft", measurement_method: "AREA", status: "MEASURED", external_key: "FF-FLR-01" },
        { item: "Kitchen counter", quantity: null, measurement_method: "LENGTH", status: "PENDING" },
      ],
    });
    const r = parseAnalysisJson(json);
    expect(r.ok).toBe(true);
    expect(r.project?.projectType).toBe("Residential");
    expect(r.items).toHaveLength(2);
    expect(r.items[0].method).toBe("AREA");
    expect(r.items[0].status).toBe("MEASURED");
    expect(r.items[0].externalKey).toBe("FF-FLR-01");
    expect(r.items[1].status).toBe("PENDING");
    expect(analysisPendingCount(r.items)).toBe(1);
  });

  it("classifies methodology from the item name when none is supplied", () => {
    const r = parseAnalysisJson(JSON.stringify({ items: [{ item: "Wardrobe", location: "Bedroom 2" }] }));
    expect(r.ok).toBe(true);
    expect(r.items[0].method).toBe("LENGTH");
    // No quantity → PENDING, never fabricated.
    expect(r.items[0].quantity).toBeNull();
    expect(r.items[0].status).toBe("PENDING");
  });

  it("NEVER fabricates a quantity — a null qty stays PENDING even if status claims otherwise", () => {
    const r = parseAnalysisJson(JSON.stringify({ items: [{ item: "WC", quantity: null, status: "COUNTED" }] }));
    expect(r.items[0].quantity).toBeNull();
    expect(r.items[0].status).toBe("PENDING");
  });

  it("accepts the legacy requirements/qty aliases and fenced/smart-quoted paste", () => {
    const pasted = "```json\n{ “requirements”: [ { “requirement”: “WC”, “qty”: 4, “unit”: “nos” } ] }\n```";
    const r = parseAnalysisJson(pasted);
    expect(r.ok).toBe(true);
    expect(r.items[0].item).toBe("WC");
    expect(r.items[0].quantity).toBe(4);
    expect(r.items[0].method).toBe("COUNT");
  });

  it("warns on an incompatible unit and on duplicates", () => {
    const r = parseAnalysisJson(JSON.stringify({ items: [
      { item: "Flooring", category: "Floor", quantity: 100, unit: "kg", measurement_method: "AREA" },
      { item: "Flooring", category: "Floor", quantity: 100, unit: "sqft", measurement_method: "AREA" },
    ] }));
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => /inconsistent with method/i.test(w))).toBe(true);
    expect(r.warnings.some((w) => /duplicate/i.test(w))).toBe(true);
    expect(r.items[1].duplicate).toBe(true);
  });
});

describe("parseAnalysisJson — invalid input", () => {
  it("rejects malformed JSON", () => {
    const r = parseAnalysisJson("{ not json ");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/invalid json/i);
  });
  it("rejects a missing items array", () => {
    const r = parseAnalysisJson(JSON.stringify({ project: { project_type: "Residential" } }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/items.*array/i);
  });
  it("rejects an empty items array", () => {
    const r = parseAnalysisJson(JSON.stringify({ items: [] }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/empty/i);
  });
  it("rejects empty input", () => {
    expect(parseAnalysisJson("").ok).toBe(false);
  });
});

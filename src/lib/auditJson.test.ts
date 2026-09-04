import { describe, it, expect } from "vitest";
import { parseAuditJson, summariseFindings } from "./auditJson";

describe("parseAuditJson — valid input", () => {
  it("parses a PASS audit with no findings", () => {
    const r = parseAuditJson(JSON.stringify({ audit: { status: "PASS", findings: [] } }));
    expect(r.ok).toBe(true);
    expect(r.status).toBe("PASS");
    expect(r.findings).toHaveLength(0);
  });

  it("parses findings with types, actions and recommendations", () => {
    const json = JSON.stringify({
      audit: {
        status: "ISSUES_FOUND",
        findings: [
          { finding_type: "MISSING_ITEM", action: "ADD", scope: "Finishes", category: "Flooring", item: "Floor finish", location: "First Floor", evidence: "First Floor Plan" },
          { finding_type: "METHODOLOGY_ERROR", action: "CHANGE_METHOD", item: "Kitchen Counter", current_value: "1 nos", recommended_method: "LENGTH", recommended_unit: "rft" },
          { finding_type: "QUANTITY_PENDING", action: "MARK_PENDING", item: "Wardrobe", location: "Bedroom 2", reason: "Running length unavailable" },
        ],
      },
    });
    const r = parseAuditJson(json);
    expect(r.ok).toBe(true);
    expect(r.status).toBe("ISSUES_FOUND");
    expect(r.findings).toHaveLength(3);
    expect(r.findings[0].findingType).toBe("MISSING_ITEM");
    expect(r.findings[0].action).toBe("ADD");
    expect(r.findings[1].recommendedMethod).toBe("LENGTH");
    expect(r.findings[1].recommendedUnit).toBe("rft");
  });

  it("downgrades an unknown finding_type to OTHER with a warning (not rejected)", () => {
    const r = parseAuditJson(JSON.stringify({ audit: { status: "ISSUES_FOUND", findings: [{ finding_type: "WEIRD_THING", item: "x" }] } }));
    expect(r.ok).toBe(true);
    expect(r.findings[0].findingType).toBe("OTHER");
    expect(r.warnings.some((w) => /unknown finding_type/i.test(w))).toBe(true);
  });

  it("accepts a bare findings array and infers status", () => {
    const r = parseAuditJson(JSON.stringify([{ finding_type: "DUPLICATE_ITEM", item: "y" }]));
    expect(r.ok).toBe(true);
    expect(r.status).toBe("ISSUES_FOUND");
  });

  it("summarises findings by type", () => {
    const r = parseAuditJson(JSON.stringify({ audit: { findings: [
      { finding_type: "MISSING_ITEM", item: "a" },
      { finding_type: "MISSING_ITEM", item: "b" },
      { finding_type: "UNIT_ERROR", item: "c" },
    ] } }));
    const s = summariseFindings(r.findings);
    expect(s.MISSING_ITEM).toBe(2);
    expect(s.UNIT_ERROR).toBe(1);
    expect(s.OTHER).toBe(0);
  });
});

describe("parseAuditJson — invalid input", () => {
  it("rejects malformed JSON", () => {
    const r = parseAuditJson("not json at all {");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/invalid json/i);
  });
  it("rejects a payload with no findings array", () => {
    const r = parseAuditJson(JSON.stringify({ audit: { status: "PASS" } }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/findings.*array/i);
  });
  it("rejects empty input", () => {
    expect(parseAuditJson("").ok).toBe(false);
  });
});

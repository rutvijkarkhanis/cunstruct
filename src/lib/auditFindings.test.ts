import { describe, it, expect } from "vitest";
import {
  matchFindingToLine,
  linkFindings,
  reviewSummary,
  type BoqLineRef,
} from "./auditFindings";
import type { AuditFinding } from "./auditJson";

const LINES: BoqLineRef[] = [
  { id: "l1", section: "Finishes", description: "Vitrified floor finish", unit: "sqft", location: "First Floor", externalKey: "FF-FLR-01" },
  { id: "l2", section: "Joinery", description: "Kitchen counter", unit: "nos", location: "Kitchen" },
  { id: "l3", section: "Joinery", description: "Wardrobe", unit: "nos", location: "Bedroom 2" },
];

describe("matchFindingToLine", () => {
  it("matches by explicit boq_line_id first", () => {
    expect(matchFindingToLine({ findingType: "OTHER", boqLineId: "l2" }, LINES)).toBe("l2");
  });
  it("matches by external_key", () => {
    expect(matchFindingToLine({ findingType: "MISSING_SPECIFICATION", externalKey: "FF-FLR-01" }, LINES)).toBe("l1");
  });
  it("matches by exact item + location", () => {
    expect(matchFindingToLine({ findingType: "METHODOLOGY_ERROR", item: "Kitchen counter", location: "Kitchen" }, LINES)).toBe("l2");
  });
  it("does not attach to the wrong line when ambiguous → returns null", () => {
    // A MISSING_ITEM the BOQ doesn't have should not be force-matched.
    expect(matchFindingToLine({ findingType: "MISSING_ITEM", item: "Balcony waterproofing", location: "Terrace" }, LINES)).toBeNull();
  });
  it("respects a mismatched location", () => {
    expect(matchFindingToLine({ findingType: "OTHER", item: "Wardrobe", location: "Bedroom 5" }, LINES)).toBeNull();
  });
});

describe("linkFindings", () => {
  it("marks matched vs unmatched findings", () => {
    const findings: AuditFinding[] = [
      { findingType: "METHODOLOGY_ERROR", item: "Kitchen counter", location: "Kitchen" },
      { findingType: "MISSING_ITEM", item: "Terrace deck", location: "Terrace" },
    ];
    const linked = linkFindings(findings, LINES);
    expect(linked[0].matched).toBe(true);
    expect(linked[0].boqLineId).toBe("l2");
    expect(linked[1].matched).toBe(false);
  });
});

describe("reviewSummary", () => {
  const findings: AuditFinding[] = [
    { findingType: "MISSING_ITEM", item: "a" },
    { findingType: "MISSING_SCOPE", item: "b" },
    { findingType: "QUANTITY_PENDING", item: "c" },
    { findingType: "METHODOLOGY_ERROR", item: "d" },
    { findingType: "UNIT_ERROR", item: "e" },
    { findingType: "MISSING_SPECIFICATION", item: "f" },
    { findingType: "DUPLICATE_ITEM", item: "g" },
    { findingType: "INSUFFICIENT_EVIDENCE", item: "h" },
  ];

  it("buckets findings the way the dashboard displays them", () => {
    const s = reviewSummary(findings, 142);
    expect(s.covered).toBe(142);
    expect(s.missing).toBe(2);
    expect(s.pending).toBe(1);
    expect(s.methodologyIssues).toBe(2);
    expect(s.specificationIssues).toBe(1);
    expect(s.duplicateOrProblematic).toBe(1);
    expect(s.other).toBe(1);
  });

  it("drops findings that are dismissed or resolved from the issue buckets", () => {
    const states = { 0: "DISMISSED" as const, 2: "RESOLVED" as const };
    const s = reviewSummary(findings, 100, states);
    expect(s.missing).toBe(1); // one MISSING_ITEM dismissed
    expect(s.pending).toBe(0); // the QUANTITY_PENDING resolved
  });
});

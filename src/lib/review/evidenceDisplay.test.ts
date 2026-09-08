// Pure-function tests for the Review Workstation evidence-display helpers.
// Fixtures are entirely synthetic (generic item keys, no specific drawing).

import { describe, it, expect } from "vitest";
import { claimLabel, formatClaimValue, resolveEvidenceLabel, sheetPositionLabel, summarizeClaimEvidence } from "./evidenceDisplay";
import type { EvidenceBox } from "./analysisSchemaV1";

describe("sheetPositionLabel", () => {
  it("formats the reviewer's position in the drawing set", () => {
    expect(sheetPositionLabel(8, 9)).toBe("Sheet 8 of 9");
  });
  it("works for the first and last page", () => {
    expect(sheetPositionLabel(1, 9)).toBe("Sheet 1 of 9");
    expect(sheetPositionLabel(9, 9)).toBe("Sheet 9 of 9");
  });
  it("works for a single-page document", () => {
    expect(sheetPositionLabel(1, 1)).toBe("Sheet 1 of 1");
  });
});

describe("claimLabel", () => {
  it("maps every claim type to its display label", () => {
    expect(claimLabel("quantity")).toBe("Quantity");
    expect(claimLabel("dimension")).toBe("Dimension");
    expect(claimLabel("specification")).toBe("Specification");
    expect(claimLabel("location")).toBe("Location");
    expect(claimLabel("general")).toBe("General");
  });
});

describe("formatClaimValue", () => {
  const ai = { item: "D1", quantity: 7, unit: "nos", dimension: "6' x 6'9\"", specification: "UPVC", location: "Ground Floor" };

  it("formats quantity with its unit", () => {
    expect(formatClaimValue(ai, "quantity")).toBe("7 nos");
  });
  it("formats a null quantity as an em dash, never 0 or 1", () => {
    expect(formatClaimValue({ ...ai, quantity: null }, "quantity")).toBe("—");
  });
  it("formats dimension/specification/location verbatim", () => {
    expect(formatClaimValue(ai, "dimension")).toBe("6' x 6'9\"");
    expect(formatClaimValue(ai, "specification")).toBe("UPVC");
    expect(formatClaimValue(ai, "location")).toBe("Ground Floor");
  });
  it("falls back to an em dash when a field is absent", () => {
    expect(formatClaimValue({ ...ai, dimension: undefined }, "dimension")).toBe("—");
  });
});

describe("resolveEvidenceLabel", () => {
  it("prefers the evidence region's own label over the document name", () => {
    const regions: EvidenceBox[] = [{ bbox: [0, 0, 1, 1], label: "Ground Floor Door & Window Schedule" }];
    expect(resolveEvidenceLabel(regions, "generic-drawing.pdf")).toBe("Ground Floor Door & Window Schedule");
  });
  it("falls back to the document name when no region has a label", () => {
    const regions: EvidenceBox[] = [{ bbox: [0, 0, 1, 1] }];
    expect(resolveEvidenceLabel(regions, "generic-drawing.pdf")).toBe("generic-drawing.pdf");
  });
  it("returns null (never a guessed name) when neither is available", () => {
    const regions: EvidenceBox[] = [{ bbox: [0, 0, 1, 1] }];
    expect(resolveEvidenceLabel(regions, null)).toBeNull();
    expect(resolveEvidenceLabel(regions, undefined)).toBeNull();
  });
});

describe("summarizeClaimEvidence", () => {
  it("reports no evidence when the claim has none", () => {
    const summary = summarizeClaimEvidence([], "quantity", 1, "generic-drawing.pdf", true);
    expect(summary).toEqual({ hasEvidence: false, text: "No evidence attached", pages: [], regionCount: 0 });
  });

  it("single region, known page, known label → full 'Evidence · label · p.N' line", () => {
    const evidence: EvidenceBox[] = [
      { page: 8, bbox: [0, 0, 1, 1], claim: "quantity", label: "Ground Floor Door & Window Schedule" },
    ];
    const summary = summarizeClaimEvidence(evidence, "quantity", 1, "generic-drawing.pdf", true);
    expect(summary.hasEvidence).toBe(true);
    expect(summary.text).toBe("Evidence · Ground Floor Door & Window Schedule · p.8");
    expect(summary.pages).toEqual([8]);
    expect(summary.regionCount).toBe(1);
  });

  it("single region with no label falls back to page only, no invented name", () => {
    const evidence: EvidenceBox[] = [{ page: 5, bbox: [0, 0, 1, 1], claim: "location" }];
    const summary = summarizeClaimEvidence(evidence, "location", 1, null, true);
    expect(summary.text).toBe("Evidence · p.5");
  });

  it("multiple regions on the SAME page → region count, not page count", () => {
    const evidence: EvidenceBox[] = [
      { page: 3, bbox: [0, 0, 1, 1], claim: "quantity", label: "Schedule" },
      { page: 3, bbox: [2, 2, 3, 3], claim: "quantity", label: "Schedule" },
      { page: 3, bbox: [4, 4, 5, 5], claim: "quantity", label: "Schedule" },
    ];
    const summary = summarizeClaimEvidence(evidence, "quantity", 1, null, true);
    expect(summary.text).toBe("Evidence · Schedule · 3 regions");
    expect(summary.regionCount).toBe(3);
    expect(summary.pages).toEqual([3]);
  });

  it("regions across MULTIPLE pages → page count, not region count", () => {
    const evidence: EvidenceBox[] = [
      { page: 2, bbox: [0, 0, 1, 1], claim: "location" },
      { page: 9, bbox: [2, 2, 3, 3], claim: "location" },
    ];
    const summary = summarizeClaimEvidence(evidence, "location", 1, null, true);
    expect(summary.text).toBe("Evidence · 2 pages");
    expect(summary.pages).toEqual([2, 9]);
  });

  it("evidence exists but the drawing can't be resolved → explicit, not silent", () => {
    const evidence: EvidenceBox[] = [{ page: 8, bbox: [0, 0, 1, 1], claim: "quantity", label: "Schedule" }];
    const summary = summarizeClaimEvidence(evidence, "quantity", 1, "generic-drawing.pdf", false);
    expect(summary.hasEvidence).toBe(true);
    expect(summary.text).toBe("Evidence · source not linked to a drawing · p.8");
  });

  it("falls back to the item's default page when a box has no page of its own", () => {
    const evidence: EvidenceBox[] = [{ bbox: [0, 0, 1, 1], claim: "general" }];
    const summary = summarizeClaimEvidence(evidence, "general", 4, null, true);
    expect(summary.text).toBe("Evidence · p.4");
    expect(summary.pages).toEqual([4]);
  });
});

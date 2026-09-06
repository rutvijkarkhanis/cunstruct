// GENERIC evidence-model coverage — deliberately NOT built around the
// Srikakulam W1 door/window-schedule shape, and NOT using the "one shared
// bbox for quantity+dimension+specification" pattern every other claim-
// evidence fixture in this repo uses. The claim-evidence schema and filtering
// logic never required a shared bbox or that particular drawing's shape —
// this file proves the general cases the architecture review flagged as
// untested: distinct per-claim regions, evidence split across pages,
// multiple regions for one claim, and a plan-style (non-tabular) region.
//
// Item keys ("D1", "P1") and coordinates below are entirely synthetic —
// illustrative fixture data, not measurements of any real drawing.

import { describe, it, expect } from "vitest";
import { parseAnalysisV1 } from "./analysisSchemaV1";
import { getEvidenceForClaim, hasEvidenceForClaim } from "./evidenceCoords";

describe("Generic evidence model — distinct per-claim regions (not a shared bbox)", () => {
  // A door schedule row where quantity, dimension, and specification each sit
  // in their own column — three genuinely different bboxes, same page.
  const doorSchedule = {
    schema_version: "cunstruct.analysis.v1",
    items: [
      {
        key: "D1",
        item: "D1 — Ground Floor Entrance Door",
        quantity: 2,
        unit: "nos",
        dimension: "3' x 7'",
        specification: "Flush, teak veneer",
        location: "Ground Floor",
        source: {
          document: "generic-drawing.pdf",
          page: 6,
          evidence: [
            { page: 6, bbox: [40, 500, 90, 520], claim: "quantity", label: "Qty column" },
            { page: 6, bbox: [100, 500, 200, 520], claim: "dimension", label: "Dimension column" },
            { page: 6, bbox: [210, 500, 340, 520], claim: "specification", label: "Specification column" },
          ],
        },
      },
    ],
  };

  it("resolves each claim to its own distinct bbox, not a shared one", () => {
    const result = parseAnalysisV1(JSON.stringify(doorSchedule));
    expect(result.ok).toBe(true);
    const evidence = result.analysis!.items[0].source!.evidence;

    const qty = getEvidenceForClaim(evidence, "quantity");
    const dim = getEvidenceForClaim(evidence, "dimension");
    const spec = getEvidenceForClaim(evidence, "specification");
    expect(qty).toHaveLength(1);
    expect(dim).toHaveLength(1);
    expect(spec).toHaveLength(1);

    // Genuinely different regions — none of the three bboxes are equal.
    expect(qty[0].bbox).toEqual([40, 500, 90, 520]);
    expect(dim[0].bbox).toEqual([100, 500, 200, 520]);
    expect(spec[0].bbox).toEqual([210, 500, 340, 520]);
    expect(qty[0].bbox).not.toEqual(dim[0].bbox);
    expect(dim[0].bbox).not.toEqual(spec[0].bbox);
  });
});

describe("Generic evidence model — claims split across different pages", () => {
  const splitAcrossPages = {
    schema_version: "cunstruct.analysis.v1",
    items: [
      {
        key: "D1",
        item: "D1",
        quantity: 4,
        source: {
          document: "generic-drawing.pdf",
          page: 1, // the item's default/plan page
          evidence: [
            { page: 1, bbox: [10, 10, 40, 40], claim: "general" },
            { page: 9, bbox: [60, 300, 260, 320], claim: "quantity" }, // a schedule on a much later page
          ],
        },
      },
    ],
  };

  it("keeps general evidence on the plan page and quantity evidence on the schedule page", () => {
    const result = parseAnalysisV1(JSON.stringify(splitAcrossPages));
    const evidence = result.analysis!.items[0].source!.evidence;

    const general = getEvidenceForClaim(evidence, "general");
    const qty = getEvidenceForClaim(evidence, "quantity");
    expect(general).toHaveLength(1);
    expect(general[0].page).toBe(1);
    expect(qty).toHaveLength(1);
    expect(qty[0].page).toBe(9);
  });
});

describe("Generic evidence model — multiple regions supporting one claim", () => {
  const multiRegionQuantity = {
    schema_version: "cunstruct.analysis.v1",
    items: [
      {
        key: "D1",
        item: "D1",
        quantity: 5,
        source: {
          document: "generic-drawing.pdf",
          evidence: [
            // A quantity confirmed by a plan count AND a separate schedule total —
            // two independent regions, two different pages, same claim.
            { page: 2, bbox: [30, 30, 60, 60], claim: "quantity", label: "Plan count mark" },
            { page: 9, bbox: [60, 300, 260, 320], claim: "quantity", label: "Schedule total" },
          ],
        },
      },
    ],
  };

  it("returns every region for the claim, not just the first", () => {
    const result = parseAnalysisV1(JSON.stringify(multiRegionQuantity));
    const evidence = result.analysis!.items[0].source!.evidence;
    const qty = getEvidenceForClaim(evidence, "quantity");
    expect(qty).toHaveLength(2);
    expect(qty.map((b) => b.page)).toEqual([2, 9]);
    expect(qty.map((b) => b.label)).toEqual(["Plan count mark", "Schedule total"]);
  });
});

describe("Generic evidence model — plan-style (non-tabular) evidence", () => {
  // A panel opening evidenced purely by its geometry on a floor plan — no
  // schedule, no table row, no other claims at all. Proves the model doesn't
  // assume every item has (or needs) quantity/dimension/specification claims.
  const planStylePanel = {
    schema_version: "cunstruct.analysis.v1",
    items: [
      {
        key: "P1",
        item: "P1 — Partition Panel",
        quantity: 1,
        location: "Second Floor",
        source: {
          document: "generic-floor-plan.pdf",
          page: 2,
          evidence: [
            { page: 2, bbox: [412, 88, 460, 210], claim: "general", label: "Panel outline on plan" },
          ],
        },
      },
    ],
  };

  it("parses and resolves general (existence) evidence with no other claims present", () => {
    const result = parseAnalysisV1(JSON.stringify(planStylePanel));
    expect(result.ok).toBe(true);
    const evidence = result.analysis!.items[0].source!.evidence;

    expect(hasEvidenceForClaim(evidence, "general")).toBe(true);
    expect(hasEvidenceForClaim(evidence, "quantity")).toBe(false);
    expect(hasEvidenceForClaim(evidence, "dimension")).toBe(false);
    expect(hasEvidenceForClaim(evidence, "specification")).toBe(false);
    expect(hasEvidenceForClaim(evidence, "location")).toBe(false);

    const general = getEvidenceForClaim(evidence, "general");
    expect(general).toHaveLength(1);
    expect(general[0].bbox).toEqual([412, 88, 460, 210]);
  });
});

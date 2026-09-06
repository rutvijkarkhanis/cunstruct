import { describe, it, expect } from "vitest";
import { parseAnalysisV1 } from "./analysisSchemaV1";
import { getEvidenceForClaim, hasEvidenceForClaim } from "./evidenceCoords";
import type { ClaimType } from "./analysisSchemaV1";

describe("Claim-level evidence support", () => {
  // Test data: W1 with evidence supporting different claims.
  // Page 5 W1 coordinate [354, 133, 360, 173] is verified from actual Srikakulam PDF (PR #102).
  // Page 999 and 998 coordinates are synthetic test fixtures (not real PDF pages).
  const w1WithClaimedEvidence = {
    schema_version: "cunstruct.analysis.v1",
    items: [
      {
        key: "W1",
        item: "W1 — Ground Floor Upper-Right Opening",
        quantity: 7,
        unit: "nos",
        dimension: "6' × 6'9\"",
        specification: "UPVC",
        location: "Ground Floor",
        source: {
          document: "test-drawing.pdf",
          page: 5,
          pageSize: { width: 595, height: 842 },
          evidence: [
            // Verified: Page 5 W1 plan opening from actual Srikakulam PDF (PR #102 regression test)
            {
              page: 5,
              bbox: [354, 133, 360, 173],
              claim: "general",
              label: "W1 plan view",
            },
            // Synthetic: Page 999 schedule row (test fixture, not real PDF geometry)
            {
              page: 999,
              bbox: [50, 100, 450, 130],
              claim: "quantity",
              label: "Synthetic schedule row",
            },
            {
              page: 999,
              bbox: [50, 100, 450, 130],
              claim: "dimension",
              label: "Synthetic schedule row",
            },
            {
              page: 999,
              bbox: [50, 100, 450, 130],
              claim: "specification",
              label: "Synthetic schedule row",
            },
            // Synthetic: Page 998 location note (test fixture, not real PDF geometry)
            {
              page: 998,
              bbox: [100, 200, 300, 220],
              claim: "location",
              label: "Synthetic location note",
            },
          ],
        },
      },
    ],
  };

  describe("Evidence parsing and validation", () => {
    it("parses claim field and validates against known claims", () => {
      const json = JSON.stringify(w1WithClaimedEvidence);
      const result = parseAnalysisV1(json);

      expect(result.ok).toBe(true);
      expect(result.analysis).toBeDefined();
      const item = result.analysis!.items[0];
      expect(item.source?.evidence).toHaveLength(5);
      expect(item.source?.evidence[0].claim).toBe("general");
      expect(item.source?.evidence[1].claim).toBe("quantity");
      expect(item.source?.evidence[2].claim).toBe("dimension");
      expect(item.source?.evidence[3].claim).toBe("specification");
      expect(item.source?.evidence[4].claim).toBe("location");
    });

    it("treats evidence without claim field as 'general'", () => {
      const legacyEvidence = {
        schema_version: "cunstruct.analysis.v1",
        items: [
          {
            key: "W1",
            item: "W1",
            quantity: 7,
            source: {
              document: "drawing.pdf",
              evidence: [
                {
                  page: 5,
                  bbox: [100, 100, 200, 200],
                  // No claim field — should default to "general"
                },
              ],
            },
          },
        ],
      };

      const result = parseAnalysisV1(JSON.stringify(legacyEvidence));
      expect(result.ok).toBe(true);
      const evidence = result.analysis!.items[0].source!.evidence[0];
      expect(evidence.claim).toBeUndefined();
      // Helper treats undefined as "general"
      expect(hasEvidenceForClaim(result.analysis!.items[0].source!.evidence, "general")).toBe(true);
    });

    it("rejects invalid claim values", () => {
      const invalidClaim = {
        schema_version: "cunstruct.analysis.v1",
        items: [
          {
            key: "W1",
            item: "W1",
            quantity: 7,
            source: {
              document: "drawing.pdf",
              evidence: [
                {
                  page: 5,
                  bbox: [100, 100, 200, 200],
                  claim: "invalid_claim_type", // Not in known claims
                },
              ],
            },
          },
        ],
      };

      const result = parseAnalysisV1(JSON.stringify(invalidClaim));
      expect(result.ok).toBe(true);
      // Invalid claim is silently dropped (not added to the evidence object)
      const evidence = result.analysis!.items[0].source!.evidence[0];
      expect(evidence.claim).toBeUndefined();
    });
  });

  describe("Evidence filtering by claim", () => {
    it("getEvidenceForClaim returns only evidence for that claim", () => {
      const result = parseAnalysisV1(JSON.stringify(w1WithClaimedEvidence));
      const evidence = result.analysis!.items[0].source!.evidence;

      const generalEv = getEvidenceForClaim(evidence, "general");
      expect(generalEv).toHaveLength(1);
      expect(generalEv[0].bbox).toEqual([354, 133, 360, 173]);

      const qtyEv = getEvidenceForClaim(evidence, "quantity");
      expect(qtyEv).toHaveLength(1);
      expect(qtyEv[0].bbox).toEqual([50, 100, 450, 130]);

      const dimEv = getEvidenceForClaim(evidence, "dimension");
      expect(dimEv).toHaveLength(1);

      const specEv = getEvidenceForClaim(evidence, "specification");
      expect(specEv).toHaveLength(1);

      const locEv = getEvidenceForClaim(evidence, "location");
      expect(locEv).toHaveLength(1);
      expect(locEv[0].bbox).toEqual([100, 200, 300, 220]);
    });

    it("hasEvidenceForClaim returns true when claim exists", () => {
      const result = parseAnalysisV1(JSON.stringify(w1WithClaimedEvidence));
      const evidence = result.analysis!.items[0].source!.evidence;

      expect(hasEvidenceForClaim(evidence, "general")).toBe(true);
      expect(hasEvidenceForClaim(evidence, "quantity")).toBe(true);
      expect(hasEvidenceForClaim(evidence, "dimension")).toBe(true);
      expect(hasEvidenceForClaim(evidence, "specification")).toBe(true);
      expect(hasEvidenceForClaim(evidence, "location")).toBe(true);
    });

    it("hasEvidenceForClaim returns false when claim missing", () => {
      const singleEvidence = {
        schema_version: "cunstruct.analysis.v1",
        items: [
          {
            key: "W1",
            item: "W1",
            quantity: 7,
            source: {
              document: "drawing.pdf",
              evidence: [
                {
                  page: 5,
                  bbox: [100, 100, 200, 200],
                  claim: "general",
                },
              ],
            },
          },
        ],
      };

      const result = parseAnalysisV1(JSON.stringify(singleEvidence));
      const evidence = result.analysis!.items[0].source!.evidence;

      expect(hasEvidenceForClaim(evidence, "general")).toBe(true);
      expect(hasEvidenceForClaim(evidence, "quantity")).toBe(false);
      expect(hasEvidenceForClaim(evidence, "dimension")).toBe(false);
      expect(hasEvidenceForClaim(evidence, "specification")).toBe(false);
      expect(hasEvidenceForClaim(evidence, "location")).toBe(false);
    });

    it("treats evidence without claim as general for filtering purposes", () => {
      const mixedEvidence = {
        schema_version: "cunstruct.analysis.v1",
        items: [
          {
            key: "W1",
            item: "W1",
            quantity: 7,
            source: {
              document: "drawing.pdf",
              evidence: [
                {
                  page: 5,
                  bbox: [100, 100, 200, 200],
                  // No claim — legacy format
                },
                {
                  page: 8,
                  bbox: [300, 300, 400, 400],
                  claim: "quantity",
                },
              ],
            },
          },
        ],
      };

      const result = parseAnalysisV1(JSON.stringify(mixedEvidence));
      const evidence = result.analysis!.items[0].source!.evidence;

      // Legacy evidence without claim should be treated as "general"
      const generalEv = getEvidenceForClaim(evidence, "general");
      expect(generalEv).toHaveLength(1);
      expect(generalEv[0].bbox).toEqual([100, 100, 200, 200]);

      const qtyEv = getEvidenceForClaim(evidence, "quantity");
      expect(qtyEv).toHaveLength(1);
      expect(qtyEv[0].bbox).toEqual([300, 300, 400, 400]);
    });
  });

  describe("Multiple evidence boxes per claim", () => {
    it("getEvidenceForClaim returns all boxes for same claim", () => {
      const multiBoxClaim = {
        schema_version: "cunstruct.analysis.v1",
        items: [
          {
            key: "W1",
            item: "W1",
            quantity: 7,
            source: {
              document: "drawing.pdf",
              evidence: [
                // Two separate quantity evidence regions (e.g., on different pages of same row)
                {
                  page: 8,
                  bbox: [50, 420, 200, 450],
                  claim: "quantity",
                },
                {
                  page: 8,
                  bbox: [200, 420, 500, 450],
                  claim: "quantity",
                },
                {
                  page: 12,
                  bbox: [100, 300, 300, 330],
                  claim: "quantity",
                },
              ],
            },
          },
        ],
      };

      const result = parseAnalysisV1(JSON.stringify(multiBoxClaim));
      const evidence = result.analysis!.items[0].source!.evidence;

      const qtyEv = getEvidenceForClaim(evidence, "quantity");
      expect(qtyEv).toHaveLength(3);
      expect(qtyEv[0].bbox).toEqual([50, 420, 200, 450]);
      expect(qtyEv[1].bbox).toEqual([200, 420, 500, 450]);
      expect(qtyEv[2].bbox).toEqual([100, 300, 300, 330]);
    });
  });

  describe("Backwards compatibility", () => {
    it("evidence array can mix claimed and unclaimed boxes", () => {
      const mixed = {
        schema_version: "cunstruct.analysis.v1",
        items: [
          {
            key: "W1",
            item: "W1",
            quantity: 7,
            source: {
              document: "drawing.pdf",
              evidence: [
                { page: 5, bbox: [100, 100, 200, 200] }, // No claim
                { page: 8, bbox: [300, 300, 400, 400], claim: "quantity" },
                { page: 8, bbox: [400, 300, 500, 400], claim: "quantity" },
                { page: 5, bbox: [200, 200, 300, 300], claim: "location" },
              ],
            },
          },
        ],
      };

      const result = parseAnalysisV1(JSON.stringify(mixed));
      expect(result.ok).toBe(true);
      const evidence = result.analysis!.items[0].source!.evidence;
      expect(evidence).toHaveLength(4);

      // Legacy unclaimed box treated as "general"
      const generalEv = getEvidenceForClaim(evidence, "general");
      expect(generalEv).toHaveLength(1);

      // Two quantity boxes
      const qtyEv = getEvidenceForClaim(evidence, "quantity");
      expect(qtyEv).toHaveLength(2);

      // One location box
      const locEv = getEvidenceForClaim(evidence, "location");
      expect(locEv).toHaveLength(1);
    });

    it("analysis without any claims parses successfully (fully legacy)", () => {
      const legacyAnalysis = {
        schema_version: "cunstruct.analysis.v1",
        items: [
          {
            key: "W1",
            item: "W1",
            quantity: 7,
            source: {
              document: "drawing.pdf",
              evidence: [
                { page: 5, bbox: [100, 100, 200, 200] },
                { page: 8, bbox: [300, 300, 400, 400] },
              ],
            },
          },
        ],
      };

      const result = parseAnalysisV1(JSON.stringify(legacyAnalysis));
      expect(result.ok).toBe(true);
      expect(result.analysis!.items[0].source!.evidence).toHaveLength(2);
      expect(hasEvidenceForClaim(result.analysis!.items[0].source!.evidence, "general")).toBe(true);
    });
  });
});

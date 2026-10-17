import { describe, it, expect } from "vitest";
import { evidenceForLine, explainCalculation, type EvidenceItem } from "./lineEvidence";
import type { AnalysisItemV1 } from "@/lib/review/analysisSchemaV1";

const ai = (p: Partial<AnalysisItemV1> = {}): AnalysisItemV1 => ({
  key: "F1", item: "Floor area — LIVING", quantity: 14.4, unit: "sqm", confidence: 0.9, aiStatus: "MEASURED",
  source: { documentId: "doc-1", document: "GF Plan", page: 2, evidence: [{ bbox: [10, 20, 30, 40], page: 2, claim: "quantity" }], pageSize: { width: 800, height: 600 } },
  calculationData: { formula: "LENGTH_TIMES_WIDTH", inputs: [{ name: "Length", value: 3.2, unit: "m" }, { name: "Width", value: 4.5, unit: "m" }] },
  ...p,
});
const item = (p: Partial<EvidenceItem> = {}): EvidenceItem => ({ id: "ri-1", runId: "run-2", ai: ai(), reviewStatus: "VERIFIED", ...p });
const line = { external_key: "F1", qty: 14.4, unit: "sqm", source_document_id: "doc-1", source_page: "2" };

describe("evidenceForLine — by stable key only", () => {
  it("links a line to its reviewed item: document, page, region and calculation", () => {
    const e = evidenceForLine(line, [item()]);
    expect(e).toMatchObject({
      kind: "linked", reviewItemId: "ri-1", runId: "run-2", decision: "VERIFIED", changedSinceReview: false,
      documentId: "doc-1", page: 2, boxes: [{ bbox: [10, 20, 30, 40], page: 2, claim: "quantity" }], pageSize: { width: 800, height: 600 },
      documentMismatch: false,
    });
    expect(e.kind === "linked" && e.calculation?.expression).toBe("Length 3.2 m × Width 4.5 m = 14.4 sqm");
  });

  it("never links by description: no key, or no reviewed item with the key, is no evidence", () => {
    expect(evidenceForLine({ ...line, external_key: null }, [item()])).toEqual({ kind: "none", reason: "no_key" });
    expect(evidenceForLine({ ...line, external_key: "F9" }, [item()])).toEqual({ kind: "none", reason: "no_reviewed_item" });
    // Unreviewed, flagged or pending items are not the source of a BOQ quantity.
    expect(evidenceForLine(line, [item({ reviewStatus: "FLAGGED" })])).toEqual({ kind: "none", reason: "no_reviewed_item" });
  });

  it("the newest run wins; several matches in that run are ambiguous unless the line's document picks one", () => {
    const older = item({ id: "ri-old", runId: "run-1" });
    expect(evidenceForLine(line, [item(), older])).toMatchObject({ reviewItemId: "ri-1" });
    const twin = item({ id: "ri-2", ai: ai({ source: { documentId: "doc-2", document: "FF Plan", page: 1, evidence: [] } }) });
    expect(evidenceForLine(line, [item(), twin])).toMatchObject({ kind: "linked", reviewItemId: "ri-1" });
    expect(evidenceForLine({ ...line, source_document_id: null }, [item(), twin])).toEqual({ kind: "ambiguous", reviewItemIds: ["ri-1", "ri-2"] });
  });

  it("keeps the original reviewed value visible after a manual change", () => {
    const e = evidenceForLine({ ...line, qty: 16 }, [item()]);
    expect(e).toMatchObject({ changedSinceReview: true, reviewed: { qty: 14.4, unit: "sqm" }, extracted: { qty: 14.4, unit: "sqm" } });
  });

  it("a corrected item reports both the extracted and the corrected value", () => {
    const e = evidenceForLine({ ...line, qty: 15 }, [item({ reviewStatus: "EDITED", reviewer: { quantity: 15 }, reviewNote: "Includes the alcove" })]);
    expect(e).toMatchObject({ decision: "EDITED", extracted: { qty: 14.4 }, corrected: { qty: 15 }, reviewed: { qty: 15 }, changedSinceReview: false, reviewNote: "Includes the alcove" });
  });

  it("flags a line that names a different document than its review item", () => {
    expect(evidenceForLine({ ...line, source_document_id: "doc-9" }, [item()])).toMatchObject({ documentMismatch: true });
  });
});

describe("explainCalculation — only what the analysis stored", () => {
  it("states the analysis's own text verbatim", () => {
    expect(explainCalculation(ai({ calculationData: undefined, calculation: "3.2 × 4.5 less 0.4 shaft" }))).toEqual({
      expression: null, statedText: "3.2 × 4.5 less 0.4 shaft", advisory: null,
    });
  });
  it("returns nothing for a quantity with no stored calculation — never a reconstructed formula", () => {
    expect(explainCalculation(ai({ calculationData: undefined, calculation: undefined }))).toBeNull();
  });
  it("adds the existing arithmetic advisory, which never claims drawing verification", () => {
    expect(explainCalculation(ai())?.advisory).toBe("Arithmetic matches — not drawing verification.");
  });
});

import { describe, it, expect } from "vitest";
import { generateCoverageSignals, type GenerateCoverageSignalsInput } from "./coverageSignals";
import type { LocationObservation } from "./locationObservations";
import type { StoredReviewItem } from "./reviewStore";

// Same minimal-fixture convention typeInstances.test.ts already establishes
// for LocationObservation — only the fields a given test actually varies
// are passed as overrides.
function obs(overrides: Partial<LocationObservation> & { id: string }): LocationObservation {
  return {
    observationType: "opening",
    mark: null,
    scopeHint: null,
    locationText: null,
    attributes: {},
    evidence: { evidence: [{ bbox: [0, 0, 1, 1] }] },
    evidenceCompleteness: "FULL",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function item(id: string, key: string): StoredReviewItem {
  return {
    id,
    ai: { key, item: key, quantity: 1, confidence: 0.9, aiStatus: "MEASURED" },
    reviewStatus: "VERIFIED",
  };
}

describe("generateCoverageSignals", () => {
  // A — schedule-only missing BOQ item
  it("A: a schedule_entry with no matching BOQ item produces one Potential Gap", () => {
    const input: GenerateCoverageSignalsInput = {
      documents: [{ documentId: "doc-A", observations: [obs({ id: "o1", mark: "D-07", observationType: "schedule_entry" })] }],
      boqs: [{ boqId: "boq-civil", items: [] }],
      boqDocumentLinks: [{ boqId: "boq-civil", documentId: "doc-A" }],
    };
    const result = generateCoverageSignals(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "POTENTIAL_GAP", boqId: "boq-civil", documentId: "doc-A",
      normalizedKey: "d-07", mark: "D-07", evidenceTypes: ["schedule_entry"], observationIds: ["o1"],
    });
  });

  // B — physical-only missing BOQ item
  it("B: a physical observation with no matching BOQ item produces one Potential Gap", () => {
    const input: GenerateCoverageSignalsInput = {
      documents: [{ documentId: "doc-A", observations: [obs({ id: "o1", mark: "W-12", observationType: "opening" })] }],
      boqs: [{ boqId: "boq-electrical", items: [] }],
      boqDocumentLinks: [{ boqId: "boq-electrical", documentId: "doc-A" }],
    };
    const result = generateCoverageSignals(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ evidenceTypes: ["physical"], normalizedKey: "w-12", mark: "W-12" });
  });

  // C — schedule + physical, same key -> one candidate, not two
  it("C: schedule_entry + physical on the same key collapse into one candidate with both evidence types", () => {
    const input: GenerateCoverageSignalsInput = {
      documents: [{
        documentId: "doc-A",
        observations: [
          obs({ id: "o1", mark: "D-07", observationType: "schedule_entry" }),
          obs({ id: "o2", mark: "D-07", observationType: "opening" }),
        ],
      }],
      boqs: [{ boqId: "boq-civil", items: [] }],
      boqDocumentLinks: [{ boqId: "boq-civil", documentId: "doc-A" }],
    };
    const result = generateCoverageSignals(input);
    expect(result).toHaveLength(1);
    expect(result[0].evidenceTypes).toEqual(["physical", "schedule_entry"]);
    expect(result[0].observationIds).toEqual(["o1", "o2"]);
  });

  // D — matching BOQ item -> no gap
  it("D: a BOQ item already keyed for this mark produces zero Potential Gaps", () => {
    const input: GenerateCoverageSignalsInput = {
      documents: [{ documentId: "doc-A", observations: [obs({ id: "o1", mark: "D-07", observationType: "schedule_entry" })] }],
      boqs: [{ boqId: "boq-civil", items: [item("ri-1", "D-07")] }],
      boqDocumentLinks: [{ boqId: "boq-civil", documentId: "doc-A" }],
    };
    expect(generateCoverageSignals(input)).toEqual([]);
  });

  // E — same document feeds two BOQs; mark exists only in one
  it("E: a document linked to two BOQs is evaluated independently against each", () => {
    const input: GenerateCoverageSignalsInput = {
      documents: [{ documentId: "doc-A", observations: [obs({ id: "o1", mark: "D-07", observationType: "schedule_entry" })] }],
      boqs: [
        { boqId: "boq-civil", items: [item("ri-1", "D-07")] },
        { boqId: "boq-electrical", items: [] },
      ],
      boqDocumentLinks: [
        { boqId: "boq-civil", documentId: "doc-A" },
        { boqId: "boq-electrical", documentId: "doc-A" },
      ],
    };
    const result = generateCoverageSignals(input);
    expect(result).toHaveLength(1);
    expect(result[0].boqId).toBe("boq-electrical");
  });

  // F — document isolation: same mark across two documents, different BOQs
  it("F: two documents sharing a mark stay scoped to their own BOQ — never collapsed globally", () => {
    const input: GenerateCoverageSignalsInput = {
      documents: [
        { documentId: "doc-A", observations: [obs({ id: "o1", mark: "D-07", observationType: "schedule_entry" })] },
        { documentId: "doc-B", observations: [obs({ id: "o2", mark: "D-07", observationType: "schedule_entry" })] },
      ],
      boqs: [
        { boqId: "boq-civil", items: [item("ri-1", "D-07")] },
        { boqId: "boq-electrical", items: [] },
      ],
      boqDocumentLinks: [
        { boqId: "boq-civil", documentId: "doc-A" },
        { boqId: "boq-electrical", documentId: "doc-B" },
      ],
    };
    const result = generateCoverageSignals(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ documentId: "doc-B", boqId: "boq-electrical" });
  });

  // G — no usable key -> no Potential Gap
  it("G: an observation with no mark contributes no Potential Gap, never a manufactured identity", () => {
    const input: GenerateCoverageSignalsInput = {
      documents: [{ documentId: "doc-A", observations: [obs({ id: "o1", mark: null, observationType: "schedule_entry" })] }],
      boqs: [{ boqId: "boq-civil", items: [] }],
      boqDocumentLinks: [{ boqId: "boq-civil", documentId: "doc-A" }],
    };
    expect(generateCoverageSignals(input)).toEqual([]);
  });

  it("G2: a blank/whitespace-only mark is equally unusable", () => {
    const input: GenerateCoverageSignalsInput = {
      documents: [{ documentId: "doc-A", observations: [obs({ id: "o1", mark: "   ", observationType: "opening" })] }],
      boqs: [{ boqId: "boq-civil", items: [] }],
      boqDocumentLinks: [{ boqId: "boq-civil", documentId: "doc-A" }],
    };
    expect(generateCoverageSignals(input)).toEqual([]);
  });

  // H — schedule_entry is never treated as physical evidence
  it("H: a schedule_entry alone never produces a 'physical' evidence type", () => {
    const input: GenerateCoverageSignalsInput = {
      documents: [{ documentId: "doc-A", observations: [obs({ id: "o1", mark: "D-07", observationType: "schedule_entry" })] }],
      boqs: [{ boqId: "boq-civil", items: [] }],
      boqDocumentLinks: [{ boqId: "boq-civil", documentId: "doc-A" }],
    };
    const result = generateCoverageSignals(input);
    expect(result[0].evidenceTypes).toEqual(["schedule_entry"]);
  });

  // I — deterministic duplicate collapse
  it("I: multiple identical observations of the same key collapse into one candidate", () => {
    const input: GenerateCoverageSignalsInput = {
      documents: [{
        documentId: "doc-A",
        observations: [
          obs({ id: "o1", mark: "W-12", observationType: "opening" }),
          obs({ id: "o2", mark: "W-12", observationType: "opening" }),
          obs({ id: "o3", mark: "w-12", observationType: "opening" }), // case-insensitive duplicate
        ],
      }],
      boqs: [{ boqId: "boq-electrical", items: [] }],
      boqDocumentLinks: [{ boqId: "boq-electrical", documentId: "doc-A" }],
    };
    const result = generateCoverageSignals(input);
    expect(result).toHaveLength(1);
    expect(result[0].observationIds).toEqual(["o1", "o2", "o3"]);
  });

  // J — deterministic output ordering under shuffled inputs
  it("J: shuffling every input array produces the same logical output in the same order", () => {
    const base: GenerateCoverageSignalsInput = {
      documents: [
        { documentId: "doc-A", observations: [obs({ id: "o1", mark: "D-07", observationType: "schedule_entry" }), obs({ id: "o2", mark: "W-12", observationType: "opening" })] },
        { documentId: "doc-B", observations: [obs({ id: "o3", mark: "C-01", observationType: "structural_element" })] },
      ],
      boqs: [
        { boqId: "boq-civil", items: [] },
        { boqId: "boq-electrical", items: [] },
      ],
      boqDocumentLinks: [
        { boqId: "boq-civil", documentId: "doc-A" },
        { boqId: "boq-electrical", documentId: "doc-B" },
      ],
    };
    const shuffled: GenerateCoverageSignalsInput = {
      documents: [
        { documentId: "doc-B", observations: [obs({ id: "o3", mark: "C-01", observationType: "structural_element" })] },
        { documentId: "doc-A", observations: [obs({ id: "o2", mark: "W-12", observationType: "opening" }), obs({ id: "o1", mark: "D-07", observationType: "schedule_entry" })] },
      ],
      boqs: [
        { boqId: "boq-electrical", items: [] },
        { boqId: "boq-civil", items: [] },
      ],
      boqDocumentLinks: [
        { boqId: "boq-electrical", documentId: "doc-B" },
        { boqId: "boq-civil", documentId: "doc-A" },
      ],
    };
    expect(generateCoverageSignals(shuffled)).toEqual(generateCoverageSignals(base));
  });

  // K — unrelated BOQ never receives a signal
  it("K: a BOQ not linked to the evidence document never receives a signal, even if it also lacks the mark", () => {
    const input: GenerateCoverageSignalsInput = {
      documents: [{ documentId: "doc-A", observations: [obs({ id: "o1", mark: "D-07", observationType: "schedule_entry" })] }],
      boqs: [
        { boqId: "boq-civil", items: [] },
        { boqId: "boq-unrelated", items: [] },
      ],
      boqDocumentLinks: [{ boqId: "boq-civil", documentId: "doc-A" }], // boq-unrelated is NOT linked
    };
    const result = generateCoverageSignals(input);
    expect(result).toHaveLength(1);
    expect(result.every((s) => s.boqId === "boq-civil")).toBe(true);
  });

  // L — multiple documents / same mark, scope stays document-specific
  it("L: two documents with the same mark but different BOQ assignments keep independent scope", () => {
    const input: GenerateCoverageSignalsInput = {
      documents: [
        { documentId: "doc-A", observations: [obs({ id: "o1", mark: "D-07", observationType: "schedule_entry" })] },
        { documentId: "doc-B", observations: [obs({ id: "o2", mark: "D-07", observationType: "schedule_entry" })] },
      ],
      boqs: [
        { boqId: "boq-civil", items: [] },
        { boqId: "boq-plumbing", items: [] },
      ],
      boqDocumentLinks: [
        { boqId: "boq-civil", documentId: "doc-A" },
        { boqId: "boq-plumbing", documentId: "doc-B" },
      ],
    };
    const result = generateCoverageSignals(input);
    expect(result).toHaveLength(2);
    expect(result.find((s) => s.documentId === "doc-A")?.boqId).toBe("boq-civil");
    expect(result.find((s) => s.documentId === "doc-B")?.boqId).toBe("boq-plumbing");
  });

  // M — input immutability
  it("M: never mutates any input array or object", () => {
    const observation = Object.freeze(obs({ id: "o1", mark: "D-07", observationType: "schedule_entry" }));
    const documentsGroup = Object.freeze({ documentId: "doc-A", observations: Object.freeze([observation]) });
    const boqItem = Object.freeze(item("ri-1", "X-99"));
    const boqGroup = Object.freeze({ boqId: "boq-civil", items: Object.freeze([boqItem]) });
    const link = Object.freeze({ boqId: "boq-civil", documentId: "doc-A" });
    const input: GenerateCoverageSignalsInput = Object.freeze({
      documents: Object.freeze([documentsGroup]),
      boqs: Object.freeze([boqGroup]),
      boqDocumentLinks: Object.freeze([link]),
    }) as unknown as GenerateCoverageSignalsInput;

    expect(() => generateCoverageSignals(input)).not.toThrow();
    expect(generateCoverageSignals(input)).toHaveLength(1); // X-99 doesn't match D-07 — unaffected by the freeze
  });

  // N — stable signal identity under reordered evidence
  it("N: the same logical candidate keeps the same signalKey regardless of evidence order", () => {
    const order1 = generateCoverageSignals({
      documents: [{
        documentId: "doc-A",
        observations: [
          obs({ id: "o1", mark: "D-07", observationType: "schedule_entry" }),
          obs({ id: "o2", mark: "D-07", observationType: "opening" }),
        ],
      }],
      boqs: [{ boqId: "boq-civil", items: [] }],
      boqDocumentLinks: [{ boqId: "boq-civil", documentId: "doc-A" }],
    });
    const order2 = generateCoverageSignals({
      documents: [{
        documentId: "doc-A",
        observations: [
          obs({ id: "o2", mark: "D-07", observationType: "opening" }),
          obs({ id: "o1", mark: "D-07", observationType: "schedule_entry" }),
        ],
      }],
      boqs: [{ boqId: "boq-civil", items: [] }],
      boqDocumentLinks: [{ boqId: "boq-civil", documentId: "doc-A" }],
    });
    expect(order1[0].signalKey).toBe(order2[0].signalKey);
    expect(order1).toEqual(order2);
  });

  // Defensive edge cases beyond the lettered matrix:

  it("no boq_document mapping for the document -> no candidate, even though the BOQ lacks the mark", () => {
    const input: GenerateCoverageSignalsInput = {
      documents: [{ documentId: "doc-orphan", observations: [obs({ id: "o1", mark: "D-07", observationType: "schedule_entry" })] }],
      boqs: [{ boqId: "boq-civil", items: [] }],
      boqDocumentLinks: [], // doc-orphan is linked to nothing
    };
    expect(generateCoverageSignals(input)).toEqual([]);
  });

  it("an empty documentId never manufactures scope", () => {
    const input: GenerateCoverageSignalsInput = {
      documents: [{ documentId: "", observations: [obs({ id: "o1", mark: "D-07", observationType: "schedule_entry" })] }],
      boqs: [{ boqId: "boq-civil", items: [] }],
      boqDocumentLinks: [{ boqId: "boq-civil", documentId: "" }],
    };
    expect(generateCoverageSignals(input)).toEqual([]);
  });

  it("dimension_annotation and level_annotation are unsupported observation types and are ignored, never broadening physical evidence", () => {
    const input: GenerateCoverageSignalsInput = {
      documents: [{
        documentId: "doc-A",
        observations: [
          obs({ id: "o1", mark: "D-07", observationType: "dimension_annotation" }),
          obs({ id: "o2", mark: "D-07", observationType: "level_annotation" }),
        ],
      }],
      boqs: [{ boqId: "boq-civil", items: [] }],
      boqDocumentLinks: [{ boqId: "boq-civil", documentId: "doc-A" }],
    };
    expect(generateCoverageSignals(input)).toEqual([]);
  });

  it("an item whose own key has no usable normalization never counts as coverage for a real mark", () => {
    const input: GenerateCoverageSignalsInput = {
      documents: [{ documentId: "doc-A", observations: [obs({ id: "o1", mark: "D-07", observationType: "schedule_entry" })] }],
      boqs: [{ boqId: "boq-civil", items: [item("ri-1", "")] }], // blank key — never matches anything
      boqDocumentLinks: [{ boqId: "boq-civil", documentId: "doc-A" }],
    };
    expect(generateCoverageSignals(input)).toHaveLength(1);
  });
});

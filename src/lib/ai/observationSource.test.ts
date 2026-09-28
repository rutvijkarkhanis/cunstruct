// Contract tests for resolveObservationSource — Phase 4's document/revision
// pinning (Layer B). Imported from its actual location
// (supabase/functions/_shared/) via a relative, explicit-extension path — the
// same way the edge function imports it — so this exercises the real module,
// not a copy (mirrors preflight.test.ts / claiming.test.ts). Pure, synthetic
// fixtures; the adversarial mismatched-document case lives here, never in the
// Srikakulam ground-truth file (which holds only real-drawing-derived facts).
// Never resolves by guessing in a MULTI-file batch: an ambiguous or
// unattributed reference there is rejected, not defaulted. A single-file
// batch is the one deliberate exception — see the "single-file override"
// section below and observationSource.ts's header comment.

import { describe, it, expect } from "vitest";
import { resolveObservationSource, type ClaimedFile } from "../../../supabase/functions/_shared/observationSource.ts";

const files: ClaimedFile[] = [
  { documentId: "doc-ground", documentRevisionId: "rev-ground-1", filename: "Ground Floor Plan.pdf" },
  { documentId: "doc-stilt", documentRevisionId: "rev-stilt-1", filename: "Stilt Floor Plan.pdf" },
];

describe("resolveObservationSource — resolves by documentId", () => {
  it("resolves to the exact claimed file when documentId matches", () => {
    const r = resolveObservationSource({ documentId: "doc-ground" }, files);
    expect(r).toEqual({ documentId: "doc-ground", revisionId: "rev-ground-1" });
  });

  it("REJECTS when documentId names a document outside the claimed batch (the adversarial/mismatched case)", () => {
    const r = resolveObservationSource({ documentId: "doc-not-in-this-batch" }, files);
    expect(r).toBeNull();
  });
});

describe("resolveObservationSource — resolves by filename when no documentId is given", () => {
  it("resolves to the exact claimed file by filename", () => {
    const r = resolveObservationSource({ document: "Stilt Floor Plan.pdf" }, files);
    expect(r).toEqual({ documentId: "doc-stilt", revisionId: "rev-stilt-1" });
  });

  it("REJECTS an unresolvable filename", () => {
    const r = resolveObservationSource({ document: "Nonexistent.pdf" }, files);
    expect(r).toBeNull();
  });

  it("REJECTS when the filename is ambiguous (two claimed files share it)", () => {
    const dupFiles: ClaimedFile[] = [
      { documentId: "doc-a", documentRevisionId: "rev-a", filename: "Plan.pdf" },
      { documentId: "doc-b", documentRevisionId: "rev-b", filename: "Plan.pdf" },
    ];
    const r = resolveObservationSource({ document: "Plan.pdf" }, dupFiles);
    expect(r).toBeNull();
  });
});

describe("resolveObservationSource — no document reference given at all", () => {
  it("1. defaults to the single claimed file when the batch has exactly one", () => {
    const r = resolveObservationSource({}, [files[0]]);
    expect(r).toEqual({ documentId: "doc-ground", revisionId: "rev-ground-1" });
  });

  it("REJECTS (never guesses) when the batch has more than one claimed file", () => {
    const r = resolveObservationSource({}, files);
    expect(r).toBeNull();
  });

  it("REJECTS when the batch is empty", () => {
    const r = resolveObservationSource({}, []);
    expect(r).toBeNull();
  });
});

// ── Single-file override (the production fix) ────────────────────────────
// DocumentLocationExtraction always requests exactly one documentId, so a
// LOCATION generate call claims exactly one file. The model is never told
// Cunstruct's internal document_id (only filename + bytes are uploaded — see
// generateAnalysisViaOpenAI), so its source.documentId/document can be
// absent, wrong, or an invented placeholder — but there was only ever ONE
// candidate document, so none of that is a genuine ambiguity. See
// observationSource.ts's header comment for the full rationale.
describe("resolveObservationSource — single-file override: the claimed file is authoritative regardless of the model's source", () => {
  it("2. an UNKNOWN/wrong documentId still resolves to the single claimed file, never rejected", () => {
    const r = resolveObservationSource({ documentId: "doc-not-in-this-batch" }, [files[0]]);
    expect(r).toEqual({ documentId: "doc-ground", revisionId: "rev-ground-1" });
  });

  it("2b. a documentId that looks like an unfulfillable placeholder (e.g. the prompt's own example value) still resolves to the single claimed file", () => {
    const r = resolveObservationSource({ documentId: "doc-uuid" }, [files[0]]);
    expect(r).toEqual({ documentId: "doc-ground", revisionId: "rev-ground-1" });
  });

  it("3. a WRONG filename still resolves to the single claimed file, never rejected", () => {
    const r = resolveObservationSource({ document: "Some Other Plan.pdf" }, [files[0]]);
    expect(r).toEqual({ documentId: "doc-ground", revisionId: "rev-ground-1" });
  });

  it("a wrong documentId AND a wrong filename together still resolve to the single claimed file", () => {
    const r = resolveObservationSource({ documentId: "doc-not-in-this-batch", document: "Some Other Plan.pdf" }, [files[0]]);
    expect(r).toEqual({ documentId: "doc-ground", revisionId: "rev-ground-1" });
  });

  it("5. does NOT extend to a multi-file batch — an unknown documentId with two claimed files is still rejected (the genuine ambiguity case)", () => {
    const r = resolveObservationSource({ documentId: "doc-not-in-this-batch" }, files);
    expect(r).toBeNull();
  });
});

describe("resolveObservationSource — documentId takes priority over filename", () => {
  it("uses documentId even when a (possibly stale) document/filename is also present", () => {
    const r = resolveObservationSource({ documentId: "doc-stilt", document: "Ground Floor Plan.pdf" }, files);
    expect(r).toEqual({ documentId: "doc-stilt", revisionId: "rev-stilt-1" });
  });
});

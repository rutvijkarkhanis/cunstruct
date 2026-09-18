// Contract tests for resolveObservationSource — Phase 4's document/revision
// pinning (Layer B). Imported from its actual location
// (supabase/functions/_shared/) via a relative, explicit-extension path — the
// same way the edge function imports it — so this exercises the real module,
// not a copy (mirrors preflight.test.ts / claiming.test.ts). Pure, synthetic
// fixtures; the adversarial mismatched-document case lives here, never in the
// Srikakulam ground-truth file (which holds only real-drawing-derived facts).
// Never resolves by guessing: an ambiguous or unattributed reference in a
// multi-file batch is rejected, not defaulted.

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
  it("defaults to the single claimed file when the batch has exactly one", () => {
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

describe("resolveObservationSource — documentId takes priority over filename", () => {
  it("uses documentId even when a (possibly stale) document/filename is also present", () => {
    const r = resolveObservationSource({ documentId: "doc-stilt", document: "Ground Floor Plan.pdf" }, files);
    expect(r).toEqual({ documentId: "doc-stilt", revisionId: "rev-stilt-1" });
  });
});

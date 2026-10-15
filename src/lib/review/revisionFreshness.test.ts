// Pure classification and evidence-viewer selection for revisionFreshness.ts.

import { describe, it, expect } from "vitest";
import {
  AnalysisRevisionBlockedError, assertApplyAllowed, classifyRunFreshness, drawingsAsAnalyzed, evidenceProvenanceNotice, observationsForDisplayedRevision, provenanceConfirmedCurrent,
  type ClaimRow, type DocumentRow, type RevisionRow,
} from "./revisionFreshness";
import type { StoredDrawing } from "./documentResolve";
import type { LocationObservation } from "./locationObservations";

const docs: DocumentRow[] = [
  { id: "doc-a", name: "Plan A", current_revision_id: "rev-a1" },
  { id: "doc-b", name: "Plan B", current_revision_id: "rev-b2" },
  { id: "doc-c", name: "Plan C", current_revision_id: "rev-c1" },
];
const revs: RevisionRow[] = [
  { id: "rev-a1", document_id: "doc-a", label: "Rev A", file_path: "p/a1.pdf", original_filename: "a1.pdf", page_count: 2, page_titles: { "1": "Ground" } },
  { id: "rev-b1", document_id: "doc-b", label: "Rev A", file_path: "p/b1.pdf", original_filename: "b1.pdf", page_count: 3, page_titles: null },
  { id: "rev-b2", document_id: "doc-b", label: "Rev B", file_path: null, original_filename: null, page_count: null, page_titles: null },
  { id: "rev-c1", document_id: "doc-c", label: "Rev A", file_path: "p/c1.pdf", original_filename: "c1.pdf", page_count: 1, page_titles: null },
];
const ok = (document_id: string, document_revision_id: string | null): ClaimRow => ({ document_id, document_revision_id, status: "SUCCEEDED" });
const classify = (claims: ClaimRow[], referenced: string[] = []) =>
  classifyRunFreshness({ runId: "run-1", claims, documents: docs, revisions: revs, referencedDocumentIds: referenced });

describe("classifyRunFreshness", () => {
  it("current AI run: every claimed revision is still current", () => {
    const f = classify([ok("doc-a", "rev-a1")]);
    expect(f.applyBlocked).toBe(false);
    expect(f.sources).toMatchObject([{ documentId: "doc-a", state: "current", analyzedRevision: { id: "rev-a1" }, currentRevision: { id: "rev-a1" } }]);
  });

  it("superseded AI run: analysed and current revisions are both reported", () => {
    const f = classify([ok("doc-b", "rev-b1")]);
    expect(f.applyBlocked).toBe(true);
    expect(f.sources).toMatchObject([{ documentId: "doc-b", state: "superseded", analyzedRevision: { id: "rev-b1", label: "Rev A" }, currentRevision: { id: "rev-b2", label: "Rev B" } }]);
  });

  it("JSON import (no claims): a referenced document is unknown — never inferred from its current revision", () => {
    const f = classify([], ["doc-a"]);
    expect(f.applyBlocked).toBe(true);
    expect(f.sources).toMatchObject([{ documentId: "doc-a", state: "unknown", analyzedRevision: null, currentRevision: { id: "rev-a1" } }]);
  });

  it("no claims and no referenced documents: nothing to assess, nothing blocked", () => {
    expect(classify([], [])).toMatchObject({ sources: [], applyBlocked: false });
  });

  it("referenced ids that are not documents of this project are ignored (nothing is attributed to them)", () => {
    expect(classify([], ["doc-uuid", "not-in-project"]).sources).toEqual([]);
  });

  it("multiple documents: each assessed independently; one stale or unknown source blocks", () => {
    const f = classify([ok("doc-a", "rev-a1"), ok("doc-b", "rev-b1")], ["doc-c"]);
    expect(f.sources.map((s) => [s.documentId, s.state])).toEqual([["doc-a", "current"], ["doc-b", "superseded"], ["doc-c", "unknown"]]);
    expect(f.applyBlocked).toBe(true);
  });

  it("claims naming two different revisions are conflicting", () => {
    expect(classify([ok("doc-b", "rev-b1"), ok("doc-b", "rev-b2")]).sources[0].state).toBe("conflicting");
  });

  it("a claimed revision owned by another document, or a null revision, is unknown", () => {
    expect(classify([ok("doc-a", "rev-b1")]).sources[0].state).toBe("unknown");
    expect(classify([ok("doc-a", null)]).sources[0].state).toBe("unknown");
  });

  it("non-SUCCEEDED claims are ignored", () => {
    expect(classify([{ document_id: "doc-a", document_revision_id: "rev-a1", status: "FAILED" }], ["doc-a"]).sources[0].state).toBe("unknown");
  });

  it("a claimed document that no longer exists in the project is missing", () => {
    expect(classify([ok("doc-gone", "rev-x")]).sources).toMatchObject([{ documentId: "doc-gone", state: "missing" }]);
  });

  it("a document with no current revision is superseded, not current", () => {
    const f = classifyRunFreshness({
      runId: "run-1", claims: [ok("doc-a", "rev-a1")], revisions: revs, referencedDocumentIds: [],
      documents: [{ id: "doc-a", name: "Plan A", current_revision_id: null }],
    });
    expect(f.sources).toMatchObject([{ state: "superseded", currentRevision: null }]);
  });
});

describe("assertApplyAllowed", () => {
  it("passes for all-current sources with a matching snapshot", () => {
    expect(() => assertApplyAllowed(classify([ok("doc-a", "rev-a1")]), { "doc-a": "rev-a1" })).not.toThrow();
  });
  it("throws when the snapshot omits a source or names a different current revision", () => {
    const f = classify([ok("doc-a", "rev-a1")]);
    expect(() => assertApplyAllowed(f, {})).toThrow(AnalysisRevisionBlockedError);
    expect(() => assertApplyAllowed(f, { "doc-a": "rev-other" })).toThrow(/changed after this review was checked/);
  });
});

describe("evidence viewer revision selection", () => {
  const drawings: StoredDrawing[] = [
    { documentId: "doc-a", name: "Plan A", originalFilename: "a1.pdf", filePath: "p/a1.pdf", pageCount: 2, pageTitles: null },
    { documentId: "doc-b", name: "Plan B", originalFilename: null, filePath: null, pageCount: null, pageTitles: null }, // current Rev B has no file
    { documentId: "doc-c", name: "Plan C", originalFilename: "c1.pdf", filePath: "p/c1.pdf", pageCount: 1, pageTitles: null },
  ];

  it("a superseded source is drawn from the analysed revision's file, not the current one", () => {
    const f = classify([ok("doc-a", "rev-a1"), ok("doc-b", "rev-b1")], ["doc-c"]);
    const shown = drawingsAsAnalyzed(drawings, f);
    expect(shown.find((d) => d.documentId === "doc-b")).toMatchObject({ filePath: "p/b1.pdf", originalFilename: "b1.pdf", pageCount: 3 });
    expect(shown.find((d) => d.documentId === "doc-a")).toBe(drawings[0]); // current: unchanged
    expect(shown.find((d) => d.documentId === "doc-c")).toBe(drawings[2]); // unknown: unchanged, but labelled (below)
  });

  it("a superseded source whose analysed revision has no stored file shows no drawing — never the newer one", () => {
    const f = classifyRunFreshness({
      runId: "run-1", claims: [ok("doc-a", "rev-a0")], referencedDocumentIds: [],
      documents: docs, revisions: [...revs, { id: "rev-a0", document_id: "doc-a", label: "Rev 0", file_path: null }],
    });
    expect(drawingsAsAnalyzed(drawings, f).find((d) => d.documentId === "doc-a")!.filePath).toBeNull();
  });

  it("provenance notices: superseded names both revisions; unknown says so; current and unresolved say nothing", () => {
    const f = classify([ok("doc-a", "rev-a1"), ok("doc-b", "rev-b1")], ["doc-c"]);
    expect(evidenceProvenanceNotice("doc-b", f, false)).toBe("Showing Rev A, the revision this analysis read. The current revision is now Rev B.");
    expect(evidenceProvenanceNotice("doc-c", f, false)).toMatch(/^Source revision unknown\. This is the current drawing \(Rev A\)/);
    expect(evidenceProvenanceNotice("doc-a", f, false)).toBeNull();
    expect(evidenceProvenanceNotice(null, f, false)).toBeNull();
  });

  it("before the check completes, or if it failed, the drawing is not presented as the source", () => {
    expect(evidenceProvenanceNotice("doc-a", undefined, true)).toBe("Checking which revision this analysis read…");
    expect(evidenceProvenanceNotice("doc-a", undefined, false)).toBe("Source revision unknown — it could not be checked.");
  });
});

describe("provenanceConfirmedCurrent (gates LOCATION markers, Identify and Find Similar)", () => {
  const f = classify([ok("doc-a", "rev-a1"), ok("doc-b", "rev-b1"), ok("doc-x", "rev-x")], ["doc-c"]);
  it("true only for a source whose analysed revision is still current", () => {
    expect(provenanceConfirmedCurrent("doc-a", f)).toBe(true);
  });
  it("false for superseded, unknown, missing, unassessed or unresolved documents", () => {
    expect(provenanceConfirmedCurrent("doc-b", f)).toBe(false); // superseded
    expect(provenanceConfirmedCurrent("doc-c", f)).toBe(false); // unknown
    expect(provenanceConfirmedCurrent("doc-x", f)).toBe(false); // missing
    expect(provenanceConfirmedCurrent("doc-zz", f)).toBe(false); // not assessed
    expect(provenanceConfirmedCurrent(null, f)).toBe(false);
  });
  it("false for conflicting claims", () => {
    expect(provenanceConfirmedCurrent("doc-b", classify([ok("doc-b", "rev-b1"), ok("doc-b", "rev-b2")]))).toBe(false);
  });
  it("false while the check is running or after it failed (no result)", () => {
    expect(provenanceConfirmedCurrent("doc-a", undefined)).toBe(false);
  });
});

describe("observationsForDisplayedRevision (LOCATION observations pinned to the revision on screen)", () => {
  const obs = (id: string, documentId: string | null | undefined, revisionId: string | null | undefined): LocationObservation => ({
    id, observationType: "opening", mark: "W1", scopeHint: null, locationText: null, attributes: {},
    evidence: { evidence: [] }, evidenceCompleteness: "FULL", createdAt: "2026-01-01T00:00:00Z",
    ...(documentId !== undefined ? { documentId } : {}), ...(revisionId !== undefined ? { revisionId } : {}),
  });
  const all = [
    obs("same", "doc-a", "rev-a1"),
    obs("older-revision", "doc-a", "rev-a0"),
    obs("revision-deleted", "doc-a", null),
    obs("never-pinned", undefined, undefined),
    obs("other-document", "doc-b", "rev-a1"),
  ];

  it("current provenance: keeps only observations pinned to this document's displayed revision", () => {
    const f = classify([ok("doc-a", "rev-a1")]);
    expect(observationsForDisplayedRevision(all, "doc-a", f).map((o) => o.id)).toEqual(["same"]);
  });

  it("an observation from an older revision is never shown as the displayed revision's", () => {
    const f = classify([ok("doc-a", "rev-a1")]);
    expect(observationsForDisplayedRevision([obs("older", "doc-a", "rev-a0")], "doc-a", f)).toEqual([]);
  });

  it("unknown observation provenance (null or missing revision) is suppressed, never guessed", () => {
    const f = classify([ok("doc-a", "rev-a1")]);
    expect(observationsForDisplayedRevision([obs("n", "doc-a", null), obs("m", undefined, undefined)], "doc-a", f)).toEqual([]);
  });

  it("nothing for a document whose provenance is superseded, unknown, still checking or unresolved", () => {
    expect(observationsForDisplayedRevision(all, "doc-b", classify([ok("doc-b", "rev-b1")]))).toEqual([]); // superseded
    expect(observationsForDisplayedRevision(all, "doc-a", classify([], ["doc-a"]))).toEqual([]); // unknown
    expect(observationsForDisplayedRevision(all, "doc-a", undefined)).toEqual([]); // checking / failed
    expect(observationsForDisplayedRevision(all, null, classify([ok("doc-a", "rev-a1")]))).toEqual([]);
  });
});

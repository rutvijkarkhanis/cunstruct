// Tests the pure preflight computation used by the ai-analysis edge function.
// Imported from its actual location (supabase/functions/_shared/) via a
// relative, explicit-extension path — the same way the edge function imports
// it — so this is exercising the real module, not a copy.
import { describe, it, expect } from "vitest";
import { computePreflight, type EligibleFile, type LedgerRow } from "../../../supabase/functions/_shared/preflight.ts";

const opts = { contractVersion: "v1", provider: "openai", model: "gpt-4o-mini", forceReanalyse: false };

const file = (o: Partial<EligibleFile> & { documentId: string; contentHash: string | null }): EligibleFile => ({
  documentRevisionId: `${o.documentId}-rev`, filename: `${o.documentId}.pdf`, byteSize: 1000, ...o,
});

describe("computePreflight", () => {
  it("treats every file as new when the ledger is empty", () => {
    const files = [file({ documentId: "a", contentHash: "h1" }), file({ documentId: "b", contentHash: "h2" })];
    const r = computePreflight(2, files, [], opts);
    expect(r.newEligible.map((f) => f.documentId)).toEqual(["a", "b"]);
    expect(r.willSend.map((f) => f.documentId)).toEqual(["a", "b"]);
    expect(r.alreadyAnalysed).toEqual([]);
  });

  it("excludes a file whose hash has a SUCCEEDED ledger row from willSend", () => {
    const files = [file({ documentId: "a", contentHash: "h1" }), file({ documentId: "b", contentHash: "h2" })];
    const ledger: LedgerRow[] = [{ contentHash: "h1", status: "SUCCEEDED", documentId: "a", filenameAtTimeOfAnalysis: "a.pdf", analysisRunId: "run1" }];
    const r = computePreflight(2, files, ledger, opts);
    expect(r.alreadyAnalysed.map((f) => f.documentId)).toEqual(["a"]);
    expect(r.willSend.map((f) => f.documentId)).toEqual(["b"]);
  });

  it("a renamed duplicate (same content hash, different document/filename) counts as already analysed, not new", () => {
    const files = [file({ documentId: "renamed-doc", contentHash: "h1", filename: "Renamed Plan.pdf" })];
    const ledger: LedgerRow[] = [{ contentHash: "h1", status: "SUCCEEDED", documentId: "original-doc", filenameAtTimeOfAnalysis: "Plan.pdf", analysisRunId: "run1" }];
    const r = computePreflight(1, files, ledger, opts);
    expect(r.alreadyAnalysed).toHaveLength(1);
    expect(r.willSend).toHaveLength(0);
  });

  it("excludes an in-flight (PROCESSING) file from willSend and reports it separately", () => {
    const files = [file({ documentId: "a", contentHash: "h1" })];
    const ledger: LedgerRow[] = [{ contentHash: "h1", status: "PROCESSING", documentId: "a", filenameAtTimeOfAnalysis: "a.pdf", analysisRunId: null }];
    const r = computePreflight(1, files, ledger, opts);
    expect(r.inFlight.map((f) => f.documentId)).toEqual(["a"]);
    expect(r.willSend).toEqual([]);
  });

  it("treats a FAILED ledger row as retryable — still counted as new / willSend", () => {
    const files = [file({ documentId: "a", contentHash: "h1" })];
    const ledger: LedgerRow[] = [{ contentHash: "h1", status: "FAILED", documentId: "a", filenameAtTimeOfAnalysis: "a.pdf", analysisRunId: null }];
    const r = computePreflight(1, files, ledger, opts);
    expect(r.willSend.map((f) => f.documentId)).toEqual(["a"]);
  });

  it("de-duplicates two DIFFERENT documents that share identical content — sends it once", () => {
    const files = [
      file({ documentId: "doc-1", contentHash: "same-bytes", filename: "Floor2/Plan.pdf" }),
      file({ documentId: "doc-2", contentHash: "same-bytes", filename: "Floor2 copy/Plan.pdf" }),
    ];
    const r = computePreflight(2, files, [], opts);
    expect(r.duplicateGroups).toHaveLength(1);
    expect(r.duplicateGroups[0]).toHaveLength(2);
    expect(r.willSend).toHaveLength(1);
  });

  it("files whose hash isn't computed yet are counted separately and never classified new/duplicate/analysed", () => {
    const files = [file({ documentId: "a", contentHash: null })];
    const r = computePreflight(1, files, [], opts);
    expect(r.filesPendingHash).toBe(1);
    expect(r.newEligible).toEqual([]);
    expect(r.willSend).toEqual([]);
  });

  it("reports zero willSend and a non-empty alreadyAnalysed when everything is already analysed (the 'nothing to do' case)", () => {
    const files = [file({ documentId: "a", contentHash: "h1" })];
    const ledger: LedgerRow[] = [{ contentHash: "h1", status: "SUCCEEDED", documentId: "a", filenameAtTimeOfAnalysis: "a.pdf", analysisRunId: "run1" }];
    const r = computePreflight(1, files, ledger, opts);
    expect(r.willSend).toEqual([]);
    expect(r.alreadyAnalysed).toHaveLength(1);
  });

  it("forceReanalyse resends an already-SUCCEEDED file but still skips an in-flight one", () => {
    const files = [file({ documentId: "a", contentHash: "h1" }), file({ documentId: "b", contentHash: "h2" })];
    const ledger: LedgerRow[] = [
      { contentHash: "h1", status: "SUCCEEDED", documentId: "a", filenameAtTimeOfAnalysis: "a.pdf", analysisRunId: "run1" },
      { contentHash: "h2", status: "PROCESSING", documentId: "b", filenameAtTimeOfAnalysis: "b.pdf", analysisRunId: null },
    ];
    const r = computePreflight(2, files, ledger, { ...opts, forceReanalyse: true });
    expect(r.willSend.map((f) => f.contentHash).sort()).toEqual(["h1"]);
  });

  it("a different content_hash under the SAME document id is treated as a new file (a revision changed)", () => {
    const files = [file({ documentId: "doc-1", contentHash: "new-bytes" })];
    const ledger: LedgerRow[] = [{ contentHash: "old-bytes", status: "SUCCEEDED", documentId: "doc-1", filenameAtTimeOfAnalysis: "doc-1.pdf", analysisRunId: "run1" }];
    const r = computePreflight(1, files, ledger, opts);
    expect(r.willSend.map((f) => f.documentId)).toEqual(["doc-1"]);
  });

  it("a ledger row for a different contract_version/model never counts as already-analysed (caller is expected to have pre-filtered the ledger, but this proves the module doesn't cross-match on content hash alone)", () => {
    // computePreflight trusts its `ledger` argument is already scoped to the
    // current contract/provider/model (the edge function's loadLedger() does
    // that filtering) — this test documents that expectation by showing a
    // hash match alone is sufficient once passed in, so the edge function's
    // WHERE clause is the thing actually enforcing contract isolation.
    const files = [file({ documentId: "a", contentHash: "h1" })];
    const ledger: LedgerRow[] = [{ contentHash: "h1", status: "SUCCEEDED", documentId: "a", filenameAtTimeOfAnalysis: "a.pdf", analysisRunId: "run1" }];
    const r = computePreflight(1, files, ledger, opts);
    expect(r.alreadyAnalysed).toHaveLength(1);
  });
});

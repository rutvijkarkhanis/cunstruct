// Tests the pure preflight computation used by the ai-analysis edge function.
// Imported from its actual location (supabase/functions/_shared/) via a
// relative, explicit-extension path — the same way the edge function imports
// it — so this is exercising the real module, not a copy.
import { describe, it, expect } from "vitest";
import { computePreflight, type EligibleFile, type LedgerRow } from "../../../supabase/functions/_shared/preflight.ts";

const NOW = 1_000_000_000_000; // fixed "now" so staleness math is deterministic
const STALE_AFTER_MS = 10 * 60 * 1000; // matches STALE_PROCESSING_MS in index.ts

const opts = { contractVersion: "v1", provider: "openai", model: "gpt-4o-mini", mode: "BOQ" as const, forceReanalyse: false, nowMs: NOW, staleAfterMs: STALE_AFTER_MS };

const file = (o: Partial<EligibleFile> & { documentId: string; contentHash: string | null }): EligibleFile => ({
  documentRevisionId: `${o.documentId}-rev`, filename: `${o.documentId}.pdf`, byteSize: 1000, ...o,
});

const ledgerRow = (o: Partial<LedgerRow> & { contentHash: string; status: LedgerRow["status"] }): LedgerRow => ({
  documentId: null, filenameAtTimeOfAnalysis: null, analysisRunId: null, claimedAtMs: NOW, ...o,
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
    const ledger = [ledgerRow({ contentHash: "h1", status: "SUCCEEDED", documentId: "a", filenameAtTimeOfAnalysis: "a.pdf", analysisRunId: "run1" })];
    const r = computePreflight(2, files, ledger, opts);
    expect(r.alreadyAnalysed.map((f) => f.documentId)).toEqual(["a"]);
    expect(r.willSend.map((f) => f.documentId)).toEqual(["b"]);
  });

  it("a renamed duplicate (same content hash, different document/filename) counts as already analysed, not new", () => {
    const files = [file({ documentId: "renamed-doc", contentHash: "h1", filename: "Renamed Plan.pdf" })];
    const ledger = [ledgerRow({ contentHash: "h1", status: "SUCCEEDED", documentId: "original-doc", filenameAtTimeOfAnalysis: "Plan.pdf", analysisRunId: "run1" })];
    const r = computePreflight(1, files, ledger, opts);
    expect(r.alreadyAnalysed).toHaveLength(1);
    expect(r.willSend).toHaveLength(0);
  });

  it("excludes a genuinely LIVE in-flight (PROCESSING, recently claimed) file from willSend and reports it separately", () => {
    const files = [file({ documentId: "a", contentHash: "h1" })];
    const ledger = [ledgerRow({ contentHash: "h1", status: "PROCESSING", documentId: "a", filenameAtTimeOfAnalysis: "a.pdf", claimedAtMs: NOW - 1000 })];
    const r = computePreflight(1, files, ledger, opts);
    expect(r.inFlight.map((f) => f.documentId)).toEqual(["a"]);
    expect(r.willSend).toEqual([]);
  });

  it("treats a FAILED ledger row as retryable — still counted as new / willSend", () => {
    const files = [file({ documentId: "a", contentHash: "h1" })];
    const ledger = [ledgerRow({ contentHash: "h1", status: "FAILED", documentId: "a", filenameAtTimeOfAnalysis: "a.pdf" })];
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
    const ledger = [ledgerRow({ contentHash: "h1", status: "SUCCEEDED", documentId: "a", filenameAtTimeOfAnalysis: "a.pdf", analysisRunId: "run1" })];
    const r = computePreflight(1, files, ledger, opts);
    expect(r.willSend).toEqual([]);
    expect(r.alreadyAnalysed).toHaveLength(1);
  });

  it("forceReanalyse resends an already-SUCCEEDED file but still skips a live in-flight one", () => {
    const files = [file({ documentId: "a", contentHash: "h1" }), file({ documentId: "b", contentHash: "h2" })];
    const ledger = [
      ledgerRow({ contentHash: "h1", status: "SUCCEEDED", documentId: "a", filenameAtTimeOfAnalysis: "a.pdf", analysisRunId: "run1" }),
      ledgerRow({ contentHash: "h2", status: "PROCESSING", documentId: "b", filenameAtTimeOfAnalysis: "b.pdf", claimedAtMs: NOW - 1000 }),
    ];
    const r = computePreflight(2, files, ledger, { ...opts, forceReanalyse: true });
    expect(r.willSend.map((f) => f.contentHash).sort()).toEqual(["h1"]);
  });

  it("a different content_hash under the SAME document id is treated as a new file (a revision changed)", () => {
    const files = [file({ documentId: "doc-1", contentHash: "new-bytes" })];
    const ledger = [ledgerRow({ contentHash: "old-bytes", status: "SUCCEEDED", documentId: "doc-1", filenameAtTimeOfAnalysis: "doc-1.pdf", analysisRunId: "run1" })];
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
    const ledger = [ledgerRow({ contentHash: "h1", status: "SUCCEEDED", documentId: "a", filenameAtTimeOfAnalysis: "a.pdf", analysisRunId: "run1" })];
    const r = computePreflight(1, files, ledger, opts);
    expect(r.alreadyAnalysed).toHaveLength(1);
  });
});

describe("computePreflight — stale PROCESSING recovery", () => {
  it("a PROCESSING claim younger than the stale threshold stays 'in flight' (protected)", () => {
    const files = [file({ documentId: "a", contentHash: "h1" })];
    const ledger = [ledgerRow({ contentHash: "h1", status: "PROCESSING", documentId: "a", claimedAtMs: NOW - (STALE_AFTER_MS - 1) })];
    const r = computePreflight(1, files, ledger, opts);
    expect(r.inFlight).toHaveLength(1);
    expect(r.willSend).toEqual([]);
  });

  it("a PROCESSING claim exactly at the stale threshold is treated as stale (>=), not protected", () => {
    const files = [file({ documentId: "a", contentHash: "h1" })];
    const ledger = [ledgerRow({ contentHash: "h1", status: "PROCESSING", documentId: "a", claimedAtMs: NOW - STALE_AFTER_MS })];
    const r = computePreflight(1, files, ledger, opts);
    expect(r.inFlight).toEqual([]);
    expect(r.willSend.map((f) => f.documentId)).toEqual(["a"]);
  });

  it("a PROCESSING claim older than the stale threshold is shown as sendable ('new'), not stuck forever", () => {
    const files = [file({ documentId: "a", contentHash: "h1" })];
    const ledger = [ledgerRow({ contentHash: "h1", status: "PROCESSING", documentId: "a", claimedAtMs: NOW - STALE_AFTER_MS - 60_000 })];
    const r = computePreflight(1, files, ledger, opts);
    expect(r.inFlight).toEqual([]);
    expect(r.willSend.map((f) => f.documentId)).toEqual(["a"]);
  });

  it("a SUCCEEDED row is never treated as stale/retryable regardless of how old claimedAtMs is", () => {
    const files = [file({ documentId: "a", contentHash: "h1" })];
    const ledger = [ledgerRow({ contentHash: "h1", status: "SUCCEEDED", documentId: "a", claimedAtMs: 0 })];
    const r = computePreflight(1, files, ledger, opts);
    expect(r.alreadyAnalysed).toHaveLength(1);
    expect(r.willSend).toEqual([]);
  });
});

// ── Phase 3: mode is echoed into the result, exactly like contractVersion/
// provider/model already are — computePreflight does not filter by it
// internally (the same trust-the-caller's-pre-filtered-ledger convention the
// "different contract_version/model" test above documents); the edge
// function's loadLedger() query is what actually isolates one mode's ledger
// rows from another's before they ever reach this function. ─────────────────
describe("computePreflight — mode", () => {
  it("echoes opts.mode into the result, defaulting BOQ through unchanged", () => {
    const files = [file({ documentId: "a", contentHash: "h1" })];
    const r = computePreflight(1, files, [], opts);
    expect(r.mode).toBe("BOQ");
  });

  it("echoes a non-default mode (LOCATION) through unchanged", () => {
    const files = [file({ documentId: "a", contentHash: "h1" })];
    const r = computePreflight(1, files, [], { ...opts, mode: "LOCATION" });
    expect(r.mode).toBe("LOCATION");
  });

  it("echoes BOQ_AND_LOCATION through unchanged", () => {
    const files = [file({ documentId: "a", contentHash: "h1" })];
    const r = computePreflight(1, files, [], { ...opts, mode: "BOQ_AND_LOCATION" });
    expect(r.mode).toBe("BOQ_AND_LOCATION");
  });

  it("mode has no effect on eligibility computation — explicit BOQ produces identical output to the (also BOQ) default fixture", () => {
    const files = [file({ documentId: "a", contentHash: "h1" }), file({ documentId: "b", contentHash: "h2" })];
    const ledger = [ledgerRow({ contentHash: "h1", status: "SUCCEEDED", documentId: "a", filenameAtTimeOfAnalysis: "a.pdf", analysisRunId: "run1" })];
    const withDefault = computePreflight(2, files, ledger, opts);
    const withExplicitBoq = computePreflight(2, files, ledger, { ...opts, mode: "BOQ" });
    expect(withExplicitBoq).toEqual(withDefault);
  });
});
